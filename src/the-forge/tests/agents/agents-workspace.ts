import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { testHost } from '../support/core-plugins.ts';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { EventBus, type EventRecord } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { Registry, type CommandContext } from '../../src/application/plugins/registry.ts';
import { registerCorePlugins, registrySkills } from '../../src/application/plugins/core-plugins.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { agentsPlugin } from '../../src/plugins/agents/plugin.ts';
import { scopeServices } from '../support/metadata.ts';

/** The pinned docker-agent examples copied by scripts/vendor-docker-agent.mjs. */
export const dockerAgentExamples = join(import.meta.dirname, 'fixtures/docker-agent/examples');
export const example = (name: string) => readFile(join(dockerAgentExamples, name), 'utf8');

/** A temporary scope with the agents core plugin registered like the composition root. */
export async function agentsWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'forge-agents-'));
  const put = async (path: string, content: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  };
  const read = (path: string) => readFile(join(root, path), 'utf8');
  /** Runs `agents <args>` with `flags`; `settings` is plugins.settings, `dryRun` the invocation mode. */
  async function run(args: string[], flags: Record<string, string | boolean> = {}, options: { settings?: Record<string, unknown>; dryRun?: boolean } = {}) {
    const registry = new Registry(), events = new EventBus(new NodeEventScope());
    registerHostEvents(events);
    registerCorePlugins(registry, events, [agentsPlugin], testHost({ skills: registrySkills(registry), fileDates: () => { throw new Error('agents reads no file dates'); } }), []);
    registry.settings.configure(options.settings ?? {}, new Set(registry.origins.keys()));
    const workspace = new Workspace(await NodeFiles.at(root), new ObsidianDocuments(), events, options.dryRun ?? false);
    const context = { workspace, events, root, workspaceRoot: root, project: null, input: async () => new Uint8Array(), ...scopeServices(workspace, events) } as unknown as CommandContext;
    const data = await registry.commands.get('agents')!.run(args, flags, context) as Record<string, unknown>;
    return { data, events: events.history as EventRecord[] };
  }
  return { root, put, read, run, dispose: () => rm(root, { recursive: true, force: true }) };
}
export type AgentsWorkspace = Awaited<ReturnType<typeof agentsWorkspace>>;
