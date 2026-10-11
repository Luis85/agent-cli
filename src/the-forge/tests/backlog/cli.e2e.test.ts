import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;
const read = (path: string) => readFile(join(fixture.project, path), 'utf8');

const base = `filters:
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
    startProperty: note.start
    targetProperty: note.due
    dependsOnProperty: note.dependsOn
    iterationProperty: note.iteration
    iterationGoalProperty: note.goal
    releaseProperty: note.release
    wipLimit.active: "1"
  - type: product-release
    name: Releases
    membershipProperty: note.release
    versionProperty: note.version
    targetDateProperty: note.target-date
    releaseStatusProperty: note.status
    stateProperty: note.status
    releasedDateProperty: note.released
    releasedStatusValues: Released
    releasedTransitionValue: Released
    releaseNotesFolder: plan/release-notes
    releaseFolder: plan/releases
    dependsOnProperty: note.dependsOn
`;

describe('the backlog core plugin through the portable CLI', () => {
  it('plans, ranks, tracks and releases work in backlog-view compatible notes', async () => {
    const init = cli(['backlog', 'init', '--folder', 'plan']);
    expect(init.status, init.stdout).toBe(0);
    expect(init.body.data).toMatchObject({ path: 'plan/Product Backlog.base', folder: 'plan', view: 'Backlog' });
    expect(cli(['write', 'plan/Product Backlog.base', '--stdin', '--if-match', init.body.data.changes[0].revision], base).status).toBe(0);

    const add = (args: string[]) => { const result = cli(['backlog', 'add', ...args, '--today', '2026-10-01']); expect(result.status, result.stdout).toBe(0); return result.body.data.item; };
    expect(add(['Epic', 'Trip planning'])).toMatchObject({ path: 'plan/requirements/Trip planning.md', id: 1, order: 1000 });
    expect(add(['Feature', 'Route sharing', '--parent', 'Trip planning'])).toMatchObject({ id: 2, order: 2000, parent: 'plan/requirements/Trip planning.md' });
    add(['PBI', 'Share a link', '--parent', 'Route sharing']);
    add(['PBI', 'Export GPX', '--parent', 'Route sharing']);
    expect(add(['Task', 'Write the share dialog', '--parent', 'Share a link', '--state', 'Active'])).toMatchObject({ path: 'plan/tasks/Write the share dialog.md', id: 5, order: 3500 });
    expect(await read('plan/tasks/Write the share dialog.md')).toBe('---\npbl-id: 5\ntype: Task\nparent: "[[Share a link]]"\norder: 3500\nstatus: Active\nstarted: 2026-10-01\n---\n');

    const moved = cli(['--events', 'all', 'backlog', 'move', 'Export GPX', '--before', 'Share a link']);
    expect(moved.body.data.item).toMatchObject({ order: 2500, parent: 'plan/requirements/Route sharing.md' });
    expect(moved.body.events.map((event: { id: string }) => event.id)).toContain('backlog.item-moved');
    expect(cli(['backlog', 'tree']).body.data.roots[0].items[0].items.map((item: { title: string }) => item.title)).toEqual(['Export GPX', 'Share a link']);

    const done = cli(['--events', 'all', 'backlog', 'set', 'Write the share dialog', '--state', 'Done', '--today', '2026-10-03']);
    expect(done.status, done.stdout).toBe(0);
    expect(done.body.events.find((event: { id: string }) => event.id === 'backlog.state-changed').payload).toMatchObject({ from: 'Active', to: 'Done', finished: '2026-10-03' });
    expect(cli(['backlog', 'depend', 'Share a link', '--on', 'Export GPX']).status).toBe(0);
    expect(cli(['backlog', 'depend', 'Export GPX', '--on', 'Share a link']).body.error).toMatchObject({ code: 'BACKLOG_WRITE_REFUSED', details: { reason: 'dependency-cycle' } });

    const iteration = cli(['backlog', 'iteration', 'add', '--goal', 'Share a route', '--today', '2026-10-05']);
    expect(iteration.body.data.item).toMatchObject({ path: 'plan/iterations/1 - Iteration - Share a route.md', start: '2026-10-05', target: '2026-10-18' });
    expect(cli(['backlog', 'iteration', 'assign', 'Share a link', '1 - Iteration - Share a route']).status).toBe(0);
    expect(await read('plan/requirements/Share a link.md')).toBe('---\npbl-id: 3\ntype: PBI\nparent: "[[Route sharing]]"\norder: 3000\ndependsOn:\n  - "[[Export GPX]]"\niteration: "[[1 - Iteration - Share a route]]"\nstart: 2026-10-05\ndue: 2026-10-18\n---\n');

    expect(cli(['backlog', 'release', 'add', '1.0', '--release-version', '1.0.0', '--target-date', '2026-12-01']).body.data.item).toMatchObject({ path: 'plan/releases/1.0.md', id: 7 });
    expect(cli(['backlog', 'release', 'join', 'Export GPX', '1.0', '--today', '2026-10-05']).status).toBe(0);
    expect(cli(['backlog', 'release', 'join', 'Share a link', '1.0']).status).toBe(0);
    const readiness = cli(['backlog', 'release', 'readiness', '1.0']).body.data;
    expect(readiness).toMatchObject({ members: 2, release: { name: '1.0', members: { value: 2 }, done: { value: 0 } } });
    expect(readiness.criteria[1]).toMatchObject({ key: 'blocked', verdict: 'partly', outstandingPaths: ['plan/requirements/Share a link.md'] });
    const notes = cli(['backlog', 'release', 'notes', '1.0']);
    expect(notes.body.data).toMatchObject({ path: 'plan/release-notes/1.0 release notes.md', outcome: 'created' });
    expect(await read('plan/release-notes/1.0 release notes.md')).toContain('## PBI\n\n- Export GPX\n- Share a link\n');
    expect(cli(['backlog', 'release', 'mark-released', '1.0', '--today', '2026-12-01']).body.data.release).toEqual({ path: 'plan/releases/1.0.md', name: '1.0', status: 'Released', released: '2026-12-01' });

    const board = cli(['backlog', 'board']).body.data;
    expect(board.columns.map((column: { state: string | null; count: number }) => [column.state, column.count])).toEqual([[null, 4], ['Open', 0], ['Active', 0], ['Done', 1]]);
    const check = cli(['backlog', 'check']).body.data;
    expect(check).toMatchObject({ ok: true, counts: { items: 7, errors: 0 } });
    expect(cli(['links', 'unresolved', '--path', 'plan/**']).body.data.links).toEqual([]);
    expect(cli(['backlog', 'show', 'Nothing']).body.error.code).toBe('BACKLOG_NOT_FOUND');
  });

  it('describes itself in schema and German, and disappears with the bases service it requires', async () => {
    const schema = cli(['schema']).body.data;
    expect(JSON.stringify(schema)).toContain('BACKLOG_NO_GAP');
    expect(cli(['--lang', 'de', 'help', 'backlog']).stdout).toContain('Hierarchie, Ränge');
    expect(cli(['skills', 'show', 'forge-backlog']).body.data.content).toContain('name: forge-backlog');
  });
});
