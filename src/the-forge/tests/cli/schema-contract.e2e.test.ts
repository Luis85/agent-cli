import { beforeAll, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { publishedSchemas, responseValidator, strictAjv, type SchemaDocument } from '../support/contract.ts';

const fixture = portableCli();
const cli = fixture.cli;
let document: SchemaDocument;
let validator: ReturnType<typeof responseValidator>;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

beforeAll(async () => {
  const project = fixture.project;
  for (const [path, content] of [
    ['Home.md', '---\nstatus: draft\ntags: [plan]\n---\n# Home\nSee [[Projects/Alpha]], [[Missing]] and ![[assets/pixel.png]].\n'],
    ['Projects/Alpha.md', 'Back to [[Home]].\n'],
    ['Lonely.md', 'No links here.\n'],
    ['board.canvas', '{"nodes":[{"id":"a","type":"file","file":"Home.md","x":0,"y":0,"width":200,"height":100}],"edges":[]}\n'],
    ['tasks.base', 'views:\n  - type: table\n    name: Table\n'],
    ['src/index.ts', 'export const answer = 42;\n'],
    ['plan.json', JSON.stringify({ version: 1, operations: [
      { op: 'write', path: 'Inbox/New.md', content: '# New\n' },
      { op: 'frontmatter', path: 'Home.md', set: { status: 'active' } },
      { op: 'move', from: 'Projects/Alpha.md', to: 'Archive/Alpha.md' },
      { op: 'edit', path: 'Archive/Alpha.md', edits: [{ find: 'Back', replace: 'Return' }] },
      { op: 'delete', path: 'Lonely.md' },
    ] })],
  ] as const) {
    await mkdir(join(project, path, '..'), { recursive: true });
    await writeFile(join(project, path), content);
  }
  await mkdir(join(project, 'assets'), { recursive: true });
  await writeFile(join(project, 'assets/pixel.png'), png);
  await writeFile(join(project, 'src/latin1.ts'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  await mkdir(join(project, 'projects/demo/.forge'), { recursive: true });
  await writeFile(join(project, 'projects/demo/.forge/project.json'), JSON.stringify({ schemaVersion: 1, name: 'demo', type: 'library' }));
  const schema = cli(['schema']);
  expect(schema.status).toBe(0);
  document = schema.body.data;
  validator = responseValidator(document);
});

describe('the published schema contract', () => {
  it('publishes only documents that the JSON Schema 2020-12 meta-schema accepts and that compile in strict mode', () => {
    const schemas = publishedSchemas(document);
    expect(schemas.length).toBeGreaterThan(document.commands.length + 10);
    const ajv = strictAjv();
    for (const [where, schema] of schemas) {
      expect(ajv.validateSchema(schema), `${where}: ${ajv.errorsText(ajv.errors)}`).toBe(true);
      expect(schema, where).toMatchObject({ $schema: 'https://json-schema.org/draft/2020-12/schema', title: expect.any(String) });
      expect(() => strictAjv().compile(schema), where).not.toThrow();
    }
    expect(validator.output(['schema'], document)).toEqual([]);
  });

  it('derives behavior annotations for every command from its metadata', () => {
    const annotations = Object.fromEntries(document.commands.map(command => [command.id, command.annotations as Record<string, unknown>]));
    for (const [id, value] of Object.entries(annotations)) {
      expect(value, id).toMatchObject({ scope: expect.stringMatching(/^(workspace|project)$/), readOnlyHint: expect.any(Boolean), destructiveHint: expect.any(Boolean), idempotentHint: expect.any(Boolean) });
      if (value.readOnlyHint) expect(value, id).toMatchObject({ mutating: false, destructiveHint: false, idempotentHint: true });
    }
    expect(annotations.read).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    expect(annotations.create).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    for (const id of ['write', 'edit', 'properties', 'patch', 'delete', 'move', 'rename']) expect(annotations[id], id).toMatchObject({ destructiveHint: true, idempotentHint: true });
    expect(annotations.make).toMatchObject({ destructiveHint: true, idempotentHint: false });
    expect(annotations.apply).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
    expect(annotations.vault).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, defaultAction: 'check' });
    expect(annotations.project).toMatchObject({ mutating: true, destructiveHint: false, actions: { current: { readOnlyHint: true }, open: { destructiveHint: false, idempotentHint: true } } });
  });

  it('describes one command with its contract and the error codes it can report', () => {
    const one = cli(['schema', 'read']);
    expect(one.status).toBe(0);
    expect(validator.output(['schema', 'read'], one.body.data)).toEqual([]);
    expect(one.body.data.commands.map((command: { id: string }) => command.id)).toEqual(['read']);
    expect(one.body.data.commands[0]).toEqual(document.commands.find(command => command.id === 'read'));
    const codes = one.body.data.errors.map((entry: { code: string }) => entry.code);
    expect(codes).toEqual(expect.arrayContaining(['NOT_FOUND', 'INVALID_FRONTMATTER', 'UNKNOWN_OPTION', 'WORKSPACE_BUSY']));
    expect(codes).not.toContain('CLAUDE_NOT_INSTALLED');
    const unknown = cli(['schema', 'nonsense']);
    expect(unknown.body.error.code).toBe('UNKNOWN_COMMAND');
    expect(validator.envelope(unknown.body)).toEqual([]);
  });

  it.each([
    ['read', 'Home.md'], ['read', 'Home.md', '--parts', 'body'], ['read', 'board.canvas'], ['read', 'tasks.base'],
    ['read', 'src/index.ts'], ['read', 'src/latin1.ts'], ['read', 'assets/pixel.png'],
    ['list'], ['list', '--kind', 'markdown', '--limit', '2'], ['validate', 'board.canvas'], ['validate', 'src/index.ts'],
    ['search', 'Home', '--context', '1'], ['search', 'status', '--in', 'frontmatter'],
    ['links', 'out', 'Home.md'], ['links', 'back', 'Home.md'], ['links', 'unresolved'], ['links', 'orphans'], ['links', 'deadends'],
    ['project', 'current'], ['project', 'list'], ['project'], ['config'], ['schema'], ['schema', 'links'],
    ['vault'], ['vault', 'check', '--rule', 'unresolved-link'], ['vault', 'tags', '--sort', 'count'], ['vault', 'properties'], ['vault', 'properties', '--name', 'status'],
    ['apply', 'plan.json', '--dry-run'],
  ])('validates the real output of %s against its declared output schema', (...args) => {
    const result = cli(args);
    expect(result.status, result.stdout).toBe(0);
    expect(validator.envelope(result.body)).toEqual([]);
    expect(validator.output(args, result.body.data)).toEqual([]);
  });

  it('validates the dry-run output of a precise edit against its declared output schema', () => {
    const revision = cli(['read', 'Home.md']).body.data.revision;
    for (const args of [['edit', 'Home.md', '--section', 'Home', '--append', '--content', 'More.'], ['edit', 'Home.md', '--edits', '[{"find":"See","replace":"Visit"}]']]) {
      const result = cli([...args, '--if-match', revision, '--dry-run']);
      expect(result.status, result.stdout).toBe(0);
      expect(result.body.data.changes[0].diff).toContain('+');
      expect(validator.output(args, result.body.data)).toEqual([]);
    }
    expect(cli(['read', 'Home.md']).body.data.revision).toBe(revision);
  });

  it('validates the selected project, failures and version output against the envelope schema', () => {
    expect(cli(['project', 'open', 'demo']).status).toBe(0);
    try {
      const current = cli(['project', 'current']);
      expect(current.body.data.project).toMatchObject({ name: 'demo', directory: 'projects/demo' });
      expect(validator.output(['project', 'current'], current.body.data)).toEqual([]);
      const scoped = cli(['list']);
      expect(scoped.body.context.project).toMatchObject({ name: 'demo' });
      expect(validator.envelope(scoped.body)).toEqual([]);
    } finally { expect(cli(['project', 'close']).status).toBe(0); }
    for (const args of [['read', 'missing.md'], ['nonsense'], ['read', 'Home.md', '--typo'], ['--version'], ['--events', 'all', 'read', 'Home.md']]) {
      const result = cli(args);
      expect(validator.envelope(result.body), args.join(' ')).toEqual([]);
    }
  });
});
