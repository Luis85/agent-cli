import { beforeAll, describe, expect, it } from 'vitest';
import { portableCli } from '../support/portable-cli.ts';
import { responseValidator, type SchemaDocument } from '../support/contract.ts';

/**
 * Mutating commands publish the shape of what they return: the shared guarded-batch result `{dryRun, changes}` with
 * each command's own fields, and the move and delete results. Real responses, committed and dry runs, must match.
 */
const fixture = portableCli();
const cli = fixture.cli;
let validator: ReturnType<typeof responseValidator>;
const backlogBase = 'filters:\n  and:\n    - file.inFolder("plan")\nviews:\n  - type: product-backlog\n    name: Backlog\n    homeFolder: plan\n';

beforeAll(async () => {
  expect((await cli(['setup'])).status).toBe(0);
  const schema = await cli(['schema']);
  expect(schema.status).toBe(0);
  validator = responseValidator(schema.body.data as SchemaDocument);
});

/** Runs a command that must succeed and checks its `data` against the published output schema. */
async function conforms(args: string[], input?: string) {
  const result = await cli(args, input);
  expect(result.status, result.stdout).toBe(0);
  expect(validator.output(args, result.body.data), args.join(' ')).toEqual([]);
  return result.body.data;
}
const revision = async (path: string) => (await cli(['stat', path])).body.data.revision as string;

describe('output schemas of mutating commands', () => {
  it('describe the file writes, moves and deletions', async () => {
    await conforms(['create', 'notes/a.md', '--content', '# A\n', '--dry-run']);
    await conforms(['create', 'notes/a.md', '--content', '# A\n']);
    await conforms(['write', 'notes/a.md', '--content', '# A2\n', '--if-match', await revision('notes/a.md')]);
    await conforms(['properties', 'notes/a.md', '--set', '{"status":"draft"}', '--if-match', await revision('notes/a.md')]);
    await conforms(['create', 'board.canvas']);
    await conforms(['patch', 'board.canvas', '--pointer', '/nodes/-', '--value', '{"id":"n","type":"text","text":"Hi","x":0,"y":0,"width":10,"height":10}', '--if-match', await revision('board.canvas')]);
    await conforms(['move', 'notes/a.md', 'archive/a.md', '--dry-run']);
    expect(await conforms(['move', 'notes/a.md', 'archive/a.md', '--if-match', await revision('notes/a.md')])).toMatchObject({ from: 'notes/a.md', to: 'archive/a.md', kind: 'file' });
    await conforms(['rename', 'archive/a.md', 'b.md', '--if-match', await revision('archive/a.md')]);
    expect(await conforms(['delete', 'archive/b.md', '--if-match', await revision('archive/b.md')])).toMatchObject({ permanent: false, trashPath: '.trash/archive/b.md' });
    await conforms(['delete', 'archive', '--recursive', '--permanent', '--dry-run']);
  });

  it('describe generators, projects and plugin writes', async () => {
    expect(await conforms(['make', 'entity', 'Order', '--out', 'src/domain/orders', '--dry-run'])).toMatchObject({ generator: 'entity', preview: [expect.objectContaining({ path: 'src/domain/orders/order.ts' })] });
    await conforms(['make', 'document', 'Plan', '--template', 'entity.md', '--date', '2026-10-01']);
    await conforms(['project', 'create', 'web']);
    await conforms(['project', 'component', 'web', 'Billing', '--dry-run']);
    await conforms(['project', 'open', 'web']);
    await conforms(['project', 'close']);
    await conforms(['templates', 'install', '--dry-run']);
    await conforms(['skills', 'install', '--out', 'tools/skills', '--dry-run']);
    await conforms(['components', 'init', '--dry-run']);
    await conforms(['create', 'plan/Backlog.base', '--content', backlogBase]);
    await conforms(['backlog', 'add', 'Epic', 'Launch']);
    await conforms(['backlog', 'iteration', 'add', '--name', 'Sprint', '--today', '2026-10-01']);
    await conforms(['backlog', 'ranks', 'respace']);
  });
});
