import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { cacheFolder } from '../../src/infrastructure/workspace/files.ts';
import { portableCli } from './portable-cli.ts';

/**
 * `idempotentHint` against behavior: every mutating mode the schema publishes runs twice in one workspace. A mode
 * declared idempotent must leave every file unchanged on the identical repeat (it reports no changes or fails);
 * a mode declared non-idempotent must change the workspace again, or name why no probe can run it. The probes are
 * grouped by command family; each family runs in its own workspace and test file, so the families run in parallel
 * and a failing probe affects only the later probes of its family.
 */
type Fixture = ReturnType<typeof portableCli>;
type Args = readonly string[] | ((fixture: Fixture) => Promise<readonly string[]>);
export interface Probe { mode: string; args: Args; input?: string; prepare?: Array<[readonly string[], string?]>; lifecycle?: boolean }

const project = 'projects/web';
const base = 'plan/Backlog.base';
const backlogBase = `filters:
  and:
    - file.inFolder("plan")
    - file.ext == "md"
views:
  - type: product-backlog
    name: Backlog
    homeFolder: plan
    stateProperty: note.status
    stateValues: Open, Active, Done
    startedStates: Active
    startedDateProperty: note.started
    finishedDateProperty: note.finished
    dependsOnProperty: note.dependsOn
    iterationProperty: note.iteration
    releaseProperty: note.release
  - type: product-release
    name: Releases
    membershipProperty: note.release
    versionProperty: note.version
    releaseFolder: plan/releases
`;
const agent = '---\nname: reviewer\ndescription: Review changes\n---\n\nReview the change without modifying files.\n';
const hook = JSON.stringify({ matcher: 'Bash', hooks: [{ type: 'command', command: 'true' }] });
const workflow = 'name: web check\non:\n  pull_request:\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n';
const appendPlan = JSON.stringify({ version: 1, operations: [{ op: 'edit', path: 'notes/log.md', append: 'again' }] });

/** The revision of a file in the selected project, as `read` reports it. */
const revision = async (fixture: Fixture, path: string) => createHash('sha256').update(await readFile(join(fixture.project, project, path))).digest('hex');
const backlog = (...args: string[]) => ['backlog', ...args, '--base', base];
/** Families after the first work in the set-up project `web`, as the first family leaves it after `project open`. */
const selectedProject: Array<[readonly string[]]> = [[['setup']], [['project', 'create', 'web']], [['project', 'open', 'web']]];

/** Ordered probes by family, one per mutating mode; a probe may prepare its state with ordinary invocations first. */
export const families: Record<string, { preamble?: Array<[readonly string[]]>; probes: Probe[] }> = {
  workspace: { probes: [
    { mode: 'setup', args: ['setup'] },
    { mode: 'server start', args: ['server', 'start'], lifecycle: true },
    { mode: 'server stop', args: ['server', 'stop'], prepare: [[['server', 'start']]], lifecycle: true },
    { mode: 'project create', args: ['project', 'create', 'web'] },
    { mode: 'project open', args: ['project', 'open', 'web'] },
    { mode: 'project component', args: ['project', 'component', 'web', 'Billing'] },
    { mode: 'workflows sync', args: ['workflows', 'sync'], prepare: [[['create', 'src/infrastructure/workflows/check/check.yml', '--content', workflow]]] },
    { mode: 'webview publish', args: ['webview', 'publish'], prepare: [
      [['project', 'create', 'repeat-view', '--type', 'webview']],
      [['project', 'open', 'repeat-view']],
      [['create', 'dist/index.html', '--content', '<h1>Repeatable prototype</h1>']],
      [['create', 'dist/manifest.json', '--content', '{"id":"repeat-view","name":"Repeatable prototype","entry":"index.html"}']],
    ] },
    { mode: 'project close', args: ['project', 'close'] },
  ] },
  files: { preamble: selectedProject, probes: [
    { mode: 'create', args: ['create', 'notes/a.md', '--content', '# A\n'] },
    { mode: 'write', args: ['write', 'notes/b.md', '--content', '# B\n'] },
    { mode: 'edit', args: async fixture => ['edit', 'notes/a.md', '--if-match', await revision(fixture, 'notes/a.md'), '--append', '--content', 'more'] },
    { mode: 'properties', args: async fixture => ['properties', 'notes/a.md', '--set', '{"status":"draft"}', '--if-match', await revision(fixture, 'notes/a.md')] },
    { mode: 'patch', prepare: [[['create', 'board.canvas']]], args: async fixture => ['patch', 'board.canvas', '--pointer', '/nodes/-', '--value', '{"id":"n","type":"text","text":"Hi","x":0,"y":0,"width":100,"height":50}', '--if-match', await revision(fixture, 'board.canvas')] },
    { mode: 'move', args: async fixture => ['move', 'notes/b.md', 'notes/c.md', '--if-match', await revision(fixture, 'notes/b.md')] },
    { mode: 'rename', args: async fixture => ['rename', 'notes/c.md', 'd.md', '--if-match', await revision(fixture, 'notes/c.md')] },
    { mode: 'delete', args: async fixture => ['delete', 'notes/d.md', '--if-match', await revision(fixture, 'notes/d.md')] },
    { mode: 'apply', args: ['apply', '-'], input: appendPlan, prepare: [[['create', 'notes/log.md', '--content', 'start\n']]] },
  ] },
  generators: { preamble: selectedProject, probes: [
    { mode: 'templates install', args: ['templates', 'install'] },
    { mode: 'make document', args: ['make', 'document', 'Entity note', '--template', 'entity.md', '--date', '2026-10-01'] },
    { mode: 'make form', args: ['make', 'form', 'Signup'] },
    { mode: 'make entity', args: ['make', 'entity', 'Order', '--out', 'src/domain/orders'] },
    { mode: 'make value-object', args: ['make', 'value-object', 'Money', '--out', 'src/domain/orders'] },
    { mode: 'make use-case', args: ['make', 'use-case', 'PlaceOrder', '--out', 'src/application/orders'] },
    { mode: 'make event', args: ['make', 'event', 'OrderPlaced', '--out', 'src/domain/orders'] },
    { mode: 'make plugin', args: ['make', 'plugin', 'MyTools'] },
    { mode: 'skills install', args: ['skills', 'install'] },
  ] },
  libraries: { preamble: selectedProject, probes: [
    ...(['components', 'interactions', 'data-sources'] as const).flatMap(library => [
      { mode: `${library} init`, args: [library, 'init'] },
      { mode: `${library} create`, args: [library, 'create', 'probe'] },
      { mode: `${library} export`, args: [library, 'export', '--out', `exported-${library}`] },
      { mode: `${library} import`, args: [library, 'import', '--from', `incoming-${library}`], prepare: [[[library, 'create', 'imported', '--library', `incoming-${library}`]]] as Array<[readonly string[]]> },
    ]),
    { mode: 'make ui', args: ['make', 'ui', 'alert'] },
    { mode: 'make stories', args: ['make', 'stories', 'alert'] },
    { mode: 'make data-source', args: ['make', 'data-source', 'example-rest'] },
  ] },
  agents: { preamble: selectedProject, probes: [
    { mode: 'agents create', args: ['agents', 'create', 'helper', '--from-template', 'basic'] },
    { mode: 'agents generate', args: ['agents', 'generate', '--target', 'claude', '--settings'] },
    { mode: 'claude hooks', args: async fixture => ['claude', 'hooks', 'add', 'PreToolUse', '--if-match', await revision(fixture, '.claude/settings.json'), '--stdin'], input: hook },
    { mode: 'claude agents', args: ['claude', 'agents', 'create', 'reviewer', '--stdin'], input: agent },
    { mode: 'agents import', args: ['agents', 'import', 'reviewer', '--from', 'claude'] },
  ] },
  backlog: { preamble: selectedProject, probes: [
    { mode: 'backlog init', args: ['backlog', 'init', '--folder', 'scratch'] },
    { mode: 'backlog add', args: backlog('add', 'PBI', 'Alpha'), prepare: [[['create', base, '--content', backlogBase]], [backlog('add', 'PBI', 'Beta')]] },
    { mode: 'backlog set', args: backlog('set', 'Beta', '--state', 'Active', '--today', '2026-10-01') },
    { mode: 'backlog move', args: backlog('move', 'Beta', '--before', 'Alpha') },
    { mode: 'backlog depend', args: backlog('depend', 'Beta', '--on', 'Alpha') },
    { mode: 'backlog undepend', args: backlog('undepend', 'Beta', '--on', 'Alpha') },
    { mode: 'backlog ranks', args: backlog('ranks', 'respace') },
    { mode: 'backlog iteration', args: backlog('iteration', 'add', '--today', '2026-10-01') },
    { mode: 'backlog release', args: backlog('release', 'add', '2.0') },
  ] },
};

/** Mutating modes no probe runs, and why their repeat is not provably free of effects. */
export const unprobed: Record<string, string> = {
  'backlog sync': 'reads and writes a remote work tracker whose state changes independently',
  'claude plugins': 'runs the installed Claude Code CLI',
  'claude marketplaces': 'runs the installed Claude Code CLI',
  'claude runtime': 'runs the installed Claude Code CLI',
};

/** Browser modes require explicit opt-in runtime setup; never download a browser in this general CLI suite.
 * The browser acceptance suite checks screenshot/tutorial repeats; runtime adapter tests cover installation.
 */
// Update repetition is tested with a local release source in tests/updates; never contact GitHub here.
export const browserProbes = ['browser install', 'browser screenshot', 'browser tutorial', 'update apply'];

interface Annotations { mutating: boolean; idempotentHint: boolean; actions?: Record<string, { mutating: boolean; idempotentHint: boolean }> }
/** Every mutating mode of published annotations with its declared idempotentHint: `command` or `command action`. */
export function mutatingModes(commands: ReadonlyArray<{ id: string; annotations: Annotations }>): Map<string, boolean> {
  const modes = new Map<string, boolean>();
  for (const { id, annotations } of commands) {
    const actions = Object.entries(annotations.actions ?? {});
    if (actions.length === 0 && annotations.mutating) modes.set(id, annotations.idempotentHint);
    for (const [action, mode] of actions) if (mode.mutating) modes.set(`${id} ${action}`, mode.idempotentHint);
  }
  return modes;
}

/**
 * Every workspace file with its digest. The derived metadata cache is left out, as `list`, revisions and events leave
 * it out: it records parse results of what a command read, not a change the command made, in either direction.
 */
async function snapshot(root: string, directory = root, files: Record<string, string> = {}): Promise<Record<string, string>> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && relative(root, path).split('\\').join('/') === cacheFolder) continue;
    if (entry.isDirectory()) await snapshot(root, path, files);
    else files[relative(root, path)] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  return files;
}

/** Run one family's probes in order in a fresh portable workspace, each against the hint the schema declares. */
export function probeFamily(name: string): void {
  const fixture = portableCli();
  const cli = fixture.cli;
  const { preamble = [], probes } = families[name]!;
  describe(`idempotentHint agrees with a repeated invocation: ${name}`, () => {
    let declared: Map<string, boolean>;
    beforeAll(async () => {
      declared = mutatingModes((await cli(['schema', '--all'])).body.data.commands);
      for (const [args] of preamble) { const prepared = await cli([...args]); expect(prepared.status, prepared.stdout).toBe(0); }
    });

    for (const probe of probes) {
      it(`${probe.mode}: the repeat matches the declared hint`, async () => {
        try {
          for (const [args, input] of probe.prepare ?? []) { const prepared = await cli([...args], input); expect(prepared.status, prepared.stdout).toBe(0); }
          const args = typeof probe.args === 'function' ? await probe.args(fixture) : probe.args;
          const first = await cli([...args], probe.input);
          expect(first.status, first.stdout).toBe(0);
          const before = await snapshot(fixture.project);
          const repeat = await cli([...args], probe.input);
          const after = await snapshot(fixture.project);
          if (declared.get(probe.mode)) {
            expect(after, repeat.stdout).toEqual(before);
            if (repeat.status === 0) expect(repeat.body.data.changes ?? [], repeat.stdout).toEqual([]);
          } else {
            expect(repeat.status, repeat.stdout).toBe(0);
            expect(after, repeat.stdout).not.toEqual(before);
          }
          if (probe.lifecycle) {
            expect(repeat.status, repeat.stdout).toBe(0);
            expect(first.body.data.changed).toBe(true);
            expect(repeat.body.data.changed).toBe(false);
            const status = await cli(['server', 'status']);
            expect(status.status, status.stdout).toBe(0);
            if (probe.mode === 'server start') {
              // File stability alone cannot prove that startup reused the same live process.
              const identity = { pid: first.body.data.server.pid, port: first.body.data.server.port, startedAt: first.body.data.server.startedAt };
              expect(first.body.data.running).toBe(true);
              expect(repeat.body.data).toMatchObject({ running: true, server: identity, url: first.body.data.url });
              expect(status.body.data).toMatchObject({ running: true, stale: false, server: identity });
            } else {
              expect(first.body.data).toMatchObject({ running: false, server: null });
              expect(repeat.body.data).toMatchObject({ running: false, server: null });
              expect(status.body.data).toMatchObject({ running: false, stale: false, server: null });
            }
          }
        } finally {
          if (probe.lifecycle) {
            const stopped = await cli(['server', 'stop']);
            expect(stopped.status, stopped.stdout).toBe(0);
            expect(stopped.body.data.running).toBe(false);
          }
        }
      });
    }
  });
}
