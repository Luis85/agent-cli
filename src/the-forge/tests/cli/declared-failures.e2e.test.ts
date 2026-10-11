import { beforeAll, describe, expect, it } from 'vitest';
import { portableCli } from '../support/portable-cli.ts';

/**
 * `tests/cli/command-errors.integration.test.ts` attributes the codes a plugin raises in its own source. A plugin
 * command also fails with codes the kernel ports it calls raise, such as NOT_FOUND from a file read. These failing
 * invocations each reach such a code, which `schema <command>` must publish in the command's `errors` or in
 * `commonErrors`.
 */
const { cli } = portableCli();
const probes: ReadonlyArray<readonly [code: string, args: readonly string[]]> = [
  ['NOT_FOUND', ['bases', 'query', 'nope.base']],
  ['NOT_FOUND', ['bases', 'inspect', 'nope.base']],
  ['NOT_FOUND', ['links', 'out', 'nope.md']],
  ['NOT_FOUND', ['links', 'back', 'nope.md']],
  ['NOT_FOUND', ['agents', 'inspect', 'nope.yaml']],
  ['NOT_FOUND', ['agents', 'generate', '--target', 'claude', '--file', 'nope.yaml']],
  ['NOT_FOUND', ['templates', 'inspect', 'nope.md']],
  ['NOT_FOUND', ['make', 'document', 'T', '--template', 'nope.md', '--dry-run']],
  ['NOT_FOUND', ['claude', 'agents', 'inspect', 'nope']],
  ['NOT_FOUND', ['read', 'nope.md']],
  ['NOT_FOUND', ['move', 'nope.md', 'x.md', '--if-match', 'abc']],
  ['INVALID_TEMPLATE_DATE', ['make', 'document', 'T', '--template', 'entity.md', '--date', '2026-13-45', '--dry-run']],
  ['INVALID_CLAUDE_OPTION', ['claude', 'plugins', 'create', 'x', '--scope', 'user']],
];

beforeAll(async () => {
  expect((await cli(['setup'])).status).toBe(0);
});

describe('failures a command reaches through kernel ports', () => {
  it.each(probes)('publishes %s for %j', async (code, args) => {
    const failure = await cli([...args]);
    expect(failure.body.ok, JSON.stringify(failure.body.data ?? null)).toBe(false);
    expect(failure.body.error.code).toBe(code);
    const schema = (await cli(['schema', args[0]!])).body.data as { commands: Array<{ errors?: string[] }>; commonErrors: string[] };
    expect([...schema.commonErrors, ...schema.commands[0]!.errors ?? []]).toContain(code);
  });
});
