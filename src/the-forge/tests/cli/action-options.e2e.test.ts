import { beforeAll, describe, expect, it } from 'vitest';
import type { ValidateFunction } from 'ajv/dist/2020.js';
import { portableCli } from '../support/portable-cli.ts';
import { strictAjv } from '../support/contract.ts';

/**
 * Each action declares exactly the options it accepts, so the published input schema and the parser agree: an option
 * of another action fails with UNKNOWN_OPTION before the command runs, and the schema rejects the same invocation.
 */
const { cli } = portableCli();
const ajv = strictAjv();
const validators = new Map<string, ValidateFunction>();

/** The CLI tokens of an invocation and the `{args, options}` value the command's input schema describes. */
type Case = [tokens: string[], args: string[], options: Record<string, string | boolean>];
const foreign: Case[] = [
  [['backlog', 'list', '--goal', 'x'], ['list'], { goal: 'x' }],
  [['backlog', 'iteration', 'assign', 'Item', 'Sprint', '--goal', 'x'], ['iteration', 'assign', 'Item', 'Sprint'], { goal: 'x' }],
  [['backlog', 'sync', 'resolve', 'Item', '--take', 'local', '--direction', 'pull'], ['sync', 'resolve', 'Item'], { take: 'local', direction: 'pull' }],
  [['agents', 'list', '--model', 'x'], ['list'], { model: 'x' }],
  [['claude', 'agents', 'list', '--metadata', '{}'], ['agents', 'list'], { metadata: '{}' }],
  [['claude', 'plugins', 'create', 'team', '--scope', 'user'], ['plugins', 'create', 'team'], { scope: 'user' }],
  [['claude', 'runtime', 'version', '--metadata', '{}'], ['runtime', 'version'], { metadata: '{}' }],
  [['bases', 'list', '--view', 'Open'], ['list'], { view: 'Open' }],
  [['components', 'export', '--from', 'incoming'], ['export'], { from: 'incoming' }],
  [['data-sources', 'list', '--kind', 'rest'], ['list'], { kind: 'rest' }],
  [['skills', 'show', 'forge-vault', '--out', 'skills'], ['show', 'forge-vault'], { out: 'skills' }],
  [['links', 'back', 'a.md', '--path', '**'], ['back', 'a.md'], { path: '**' }],
  [['project', 'list', '--kind', 'domain'], ['list'], { kind: 'domain' }],
  [['workflows', 'list', '--check'], ['list'], { check: true }],
];

beforeAll(async () => {
  for (const id of new Set(foreign.map(([tokens]) => tokens[0]!))) {
    const contract = (await cli(['schema', id])).body.data.commands[0] as { inputSchema: object };
    validators.set(id, ajv.compile(contract.inputSchema));
  }
});

describe('action-scoped options', () => {
  it.each(foreign)('refuses %j with UNKNOWN_OPTION, as the published input schema does', async (tokens, args, options) => {
    const result = await cli(tokens);
    expect(result.status, result.stdout).toBe(2);
    expect(result.body.error.code).toBe('UNKNOWN_OPTION');
    expect(validators.get(tokens[0]!)!({ args, options })).toBe(false);
    // Without the foreign option the same invocation is one the schema describes.
    const own = Object.fromEntries(Object.entries(options).filter(([key]) => !result.body.error.message.includes(`--${key}`)));
    expect(validators.get(tokens[0]!)!({ args, options: own }), JSON.stringify(validators.get(tokens[0]!)!.errors)).toBe(true);
  });

  it('finds the action when its own options precede the action words', async () => {
    const before = await cli(['backlog', '--context', 'list']);
    expect(before.body.error.code).toBe('BACKLOG_NOT_FOUND');
    const sub = await cli(['backlog', 'iteration', '--goal', 'Ship', 'add']);
    expect(sub.body.error.code).toBe('BACKLOG_NOT_FOUND');
    const agents = await cli(['agents', '--from-template', 'basic', 'create', 'helper', '--dry-run']);
    expect(agents.body.error, agents.stdout).toBeUndefined();
    expect(agents.body.data.changes).toEqual([expect.objectContaining({ path: expect.stringMatching(/helper\.yaml$/) })]);
  });

  it('reports an unknown action before the options it would not take', async () => {
    for (const tokens of [['backlog', 'lst', '--context'], ['backlog', 'iteration', 'remove', '--goal', 'x'], ['agents', 'make', '--model', 'x']]) {
      const result = await cli(tokens);
      expect(result.body.error.code, tokens.join(' ')).toBe('INVALID_ARGUMENT');
    }
  });
});
