import { beforeAll, describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

/**
 * Each `claude` section declares the `--scope` values it accepts, so the host's enum check never refuses a scope the
 * section supports (`plugins update --scope managed`) and refuses the others before the section runs.
 */
const fixture = portableCli();
let root: string, claude: (args: string[]) => ReturnType<typeof fixture.cli>;

beforeAll(async () => {
  root = join(fixture.project, 'scopes');
  await mkdir(join(root, 'plugin-root'), { recursive: true });
  claude = args => fixture.cli(['claude', ...args], undefined, { root });
});

/** The native arguments a dry run of an installed-CLI command plans. */
async function planned(args: string[]) {
  const result = await claude([...args, '--claude-bin', join(root, 'claude'), '--dry-run']);
  expect(result.body.error, args.join(' ')).toBeUndefined();
  return result.body.data.plan.args as string[];
}

describe('claude --scope per section', () => {
  it('passes every documented scope of the installed-CLI plugin and marketplace commands', async () => {
    for (const scope of ['user', 'project', 'local', 'managed']) expect(await planned(['plugins', 'update', 'demo@market', '--scope', scope])).toEqual(['plugin', 'update', 'demo@market', '--scope', scope, '--json']);
    for (const action of ['install', 'uninstall', 'enable', 'disable']) {
      for (const scope of ['user', 'project', 'local']) expect(await planned(['plugins', action, 'demo@market', '--scope', scope])).toContain(scope);
    }
    for (const scope of ['user', 'project', 'local']) {
      expect(await planned(['plugins', 'prune', '--scope', scope])).toEqual(['plugin', 'prune', '--scope', scope]);
      expect(await planned(['marketplaces', 'add', 'owner/repo', '--scope', scope])).toEqual(['plugin', 'marketplace', 'add', 'owner/repo', '--scope', scope]);
      expect(await planned(['marketplaces', 'remove', 'market', '--scope', scope])).toEqual(['plugin', 'marketplace', 'remove', 'market', '--scope', scope]);
    }
  });

  it('keeps managed to plugins update and refuses scopes a section does not declare', async () => {
    expect((await claude(['plugins', 'install', 'demo@market', '--scope', 'managed', '--dry-run'])).body.error).toMatchObject({ code: 'INVALID_CLAUDE_SCOPE' });
    expect((await claude(['marketplaces', 'add', 'owner/repo', '--scope', 'managed', '--dry-run'])).body.error)
      .toMatchObject({ code: 'INVALID_OPTION_VALUE', details: { option: 'scope', value: 'managed', allowed: ['project', 'local', 'user'] } });
    expect((await claude(['agents', 'list', '--scope', 'local'])).body.error)
      .toMatchObject({ code: 'INVALID_OPTION_VALUE', details: { option: 'scope', value: 'local', allowed: ['project', 'user', 'plugin'] } });
    expect((await claude(['runtime', 'version', '--scope', 'user', '--dry-run'])).body.error).toMatchObject({ code: 'UNKNOWN_OPTION' });
  });

  it('refuses --scope with INVALID_CLAUDE_OPTION on every plugins action that has no scope', async () => {
    // Authoring actions run in Forge, validate and list run the installed CLI: both report the same code.
    for (const args of [['plugins', 'create', 'demo', '--directory', 'plugin-root'], ['plugins', 'validate', './plugin-root'], ['marketplaces', 'list']]) {
      const refused = await claude([...args, '--scope', 'user', '--claude-bin', join(root, 'claude'), '--dry-run']);
      expect(refused.body.error, args.join(' ')).toMatchObject({ code: 'INVALID_CLAUDE_OPTION', message: expect.stringContaining('--scope') });
    }
  });

  it('accepts every scope of native agents and hooks', async () => {
    const claudeDir = join(root, 'claude-home');
    const scoped = { project: [], user: ['--claude-dir', claudeDir], plugin: ['--directory', 'plugin-root'] } as Record<string, string[]>;
    for (const scope of ['project', 'user', 'plugin']) {
      const agents = await claude(['agents', 'list', '--scope', scope, ...scoped[scope]!]);
      expect(agents.body.error, `agents --scope ${scope}`).toBeUndefined();
      expect(agents.body.data.target.scope).toBe(scope);
    }
    for (const scope of ['project', 'local', 'user', 'plugin']) {
      const hooks = await claude(['hooks', 'inspect', '--scope', scope, ...scoped[scope] ?? []]);
      expect(hooks.body.error, `hooks --scope ${scope}`).toBeUndefined();
      expect(hooks.body.data.target.scope).toBe(scope);
    }
  });

  it('publishes the scopes of each section in its action options', async () => {
    const { options, annotations } = (await fixture.cli(['schema', 'claude'])).body.data.commands[0];
    expect(options.scope).toBeUndefined();
    const scopes = Object.fromEntries(Object.entries(annotations.actions as Record<string, { options?: { scope?: { enum: string[] } } }>).map(([id, action]) => [id, action.options?.scope?.enum ?? null]));
    expect(scopes).toEqual({ capabilities: null, agents: ['project', 'user', 'plugin'], hooks: ['project', 'local', 'user', 'plugin'], plugins: ['project', 'local', 'user', 'managed'], marketplaces: ['project', 'local', 'user'], runtime: null });
  });
});
