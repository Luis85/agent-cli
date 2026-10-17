import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { offlineHost, testHost } from './core-plugins.ts';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { Registry, type CommandContext } from '../../src/application/plugins/registry.ts';
import { registerCorePlugins, registrySkills } from '../../src/application/plugins/core-plugins.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { nodeFileDates } from '../../src/infrastructure/workspace/file-dates.ts';
import { basesPlugin } from '../../src/plugins/bases/plugin.ts';
import { backlogPlugin } from '../../src/plugins/backlog/plugin.ts';
import { scopeServices } from './metadata.ts';
import { closestDestination, linkIndex, resolveLinkpath } from '../../src/domain/metadata/link-resolution.ts';
import { stringReferences } from '../../src/infrastructure/metadata/markdown-references.ts';
import type { FrontmatterLink, NoteSource } from '../../src/plugins/backlog/domain/items.ts';
import { skillFrontmatter } from '../../src/infrastructure/plugins/skill-frontmatter.ts';
import { forgeVersion } from './workspace.ts';

/** The copied backlog-view conformance vault (`tests/backlog/fixtures/vault`). */
export const backlogFixtures = resolve('tests/backlog/fixtures');

/** A temporary vault: the copied plugin fixtures, or the given files only. */
export async function backlogVault(files?: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'forge-backlog-'));
  if (files === undefined) await cp(join(backlogFixtures, 'vault'), root, { recursive: true });
  else for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content); }
  return {
    root,
    read: (path: string) => readFile(join(root, path), 'utf8'),
    write: async (path: string, content: string) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content); },
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

/**
 * Runs `backlog` like the composition root does, with the bases and backlog core plugins, in a fresh invocation
 * per call (fresh metadata cache and event bus). Returns the result and the recorded events.
 */
export async function runBacklog(root: string, args: string[], flags: Record<string, string | boolean> = {}, options: { dryRun?: boolean; settings?: Record<string, unknown> } = {}) {
  const registry = new Registry(skillFrontmatter, forgeVersion), events = new EventBus(new NodeEventScope());
  registerHostEvents(events);
  registerCorePlugins(registry, events, [basesPlugin, backlogPlugin], testHost({ skills: registrySkills(registry), fileDates: nodeFileDates, ...offlineHost }), []);
  registry.settings.configure({ backlog: options.settings ?? {} }, new Set(registry.origins.keys()));
  const workspace = new Workspace(await NodeFiles.at(root), new ObsidianDocuments(), events, options.dryRun === true);
  const context = { workspace, events, root, workspaceRoot: root, project: null, input: async () => new Uint8Array(), ...scopeServices(workspace, events) } as unknown as CommandContext;
  const data = await registry.commands.get('backlog')!.run(args, flags, context) as Record<string, any>;
  return { data, events: events.history.filter(record => record.id.startsWith('backlog.')) };
}

/**
 * A backlog `NoteSource` over in-memory frontmatter with the metadata cache's semantics, as the backlog session reads
 * it: frontmatter links of every string value, keyed `key`, `key.<index>` for list items and `key.<name>` for nested
 * values, and link resolution like `getClosestLinkpathDest` over the note paths. A note whose frontmatter is
 * undefined has no cache entry. `links` replaces the derived links of a note, for link texts a parsed note cannot
 * produce. `tests/backlog/note-source.unit.test.ts` compares it with the real metadata cache.
 */
export function noteSource(notes: Record<string, Record<string, unknown> | undefined>, links: Record<string, FrontmatterLink[]> = {}): NoteSource {
  const index = linkIndex(Object.keys(notes));
  const derived = (path: string) => {
    const found: FrontmatterLink[] = [];
    const visit = (value: unknown, key: string) => {
      if (typeof value === 'string') for (const reference of stringReferences(value)) found.push({ key, link: reference.link });
      else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) visit(item, key ? `${key}.${name}` : name);
    };
    visit(notes[path] ?? {}, '');
    return found;
  };
  return {
    frontmatter: path => notes[path],
    frontmatterLinks: path => links[path] ?? derived(path),
    resolve: (linkpath, sourcePath) => closestDestination(resolveLinkpath(index, linkpath, sourcePath), sourcePath),
  };
}
