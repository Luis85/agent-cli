import { describe, expect, it } from 'vitest';
import { buildClaudeRuntimeArgs, claudeRuntimeNeedsInput, claudeRuntimeOptions, claudeRuntimeOutput } from '../../src/presentation/claude-runtime-commands.ts';

describe('Claude runtime command plans', () => {
  it.each(['install', 'update', 'uninstall', 'enable', 'disable'])('plans plugin %s at explicit project scope by default', action => {
    expect(buildClaudeRuntimeArgs('plugins', [action, 'formatter@team'], { 'dry-run': true }))
      .toEqual(['plugin', action, 'formatter@team', '--scope', 'project', '--json']);
  });

  it.each(['user', 'project', 'local'])('honors an explicit plugin scope %s', scope => {
    expect(buildClaudeRuntimeArgs('plugins', ['install', 'formatter@team'], { scope }))
      .toEqual(['plugin', 'install', 'formatter@team', '--scope', scope, '--json']);
  });

  it('permits managed scope only for updates', () => {
    expect(buildClaudeRuntimeArgs('plugins', ['update', 'formatter@team'], { scope: 'managed' }))
      .toEqual(['plugin', 'update', 'formatter@team', '--scope', 'managed', '--json']);
    expect(() => buildClaudeRuntimeArgs('plugins', ['install', 'formatter@team'], { scope: 'managed' }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_CLAUDE_SCOPE' }));
  });

  it('requests machine-readable lists and validation without forwarding Forge output or execution options', () => {
    expect(buildClaudeRuntimeArgs('plugins', ['list'], { available: true, json: true, 'claude-bin': '/opt/claude', timeout: '5000' }))
      .toEqual(['plugin', 'list', '--json', '--available']);
    expect(buildClaudeRuntimeArgs('plugins', ['validate', 'plugins/team helper'], { strict: true, 'no-json': true }))
      .toEqual(['plugin', 'validate', 'plugins/team helper', '--json', '--strict']);
    expect(buildClaudeRuntimeArgs('marketplaces', ['list'], {})).toEqual(['plugin', 'marketplace', 'list', '--json']);
  });

  it('selects the documented stdout protocol without guessing from output text', () => {
    expect(claudeRuntimeOutput('plugins', ['list'], {})).toBe('json');
    expect(claudeRuntimeOutput('marketplaces', ['list'], {})).toBe('json');
    expect(claudeRuntimeOutput('plugins', ['validate', '.'], {})).toBe('json');
    expect(claudeRuntimeOutput('plugins', ['configure', 'review@team'], {})).toBe('json');
    for (const action of ['install', 'update', 'enable', 'disable', 'uninstall']) {
      expect(claudeRuntimeOutput('plugins', [action, 'review@team'], {})).toBe('json-last-line');
    }
    expect(claudeRuntimeOutput('plugins', ['details', 'review'], {})).toBe('text');
    expect(claudeRuntimeOutput('runtime', ['version'], {})).toBe('text');
    expect(() => claudeRuntimeOutput('plugins', ['constructor'], {})).toThrow(/Unknown Claude/);
  });

  it('keeps uninstall pruning in text mode because native prune and JSON cannot combine', () => {
    const flags = { prune: true, yes: true, json: true };
    expect(buildClaudeRuntimeArgs('plugins', ['uninstall', 'review@team'], flags))
      .toEqual(['plugin', 'uninstall', 'review@team', '--scope', 'project', '--prune', '--yes']);
    expect(claudeRuntimeOutput('plugins', ['uninstall', 'review@team'], flags)).toBe('text');
    expect(claudeRuntimeOutput('plugins', ['uninstall', 'review@team'], { prune: false })).toBe('json-last-line');
  });

  it('always scopes marketplace add/remove, avoiding native removal from every scope', () => {
    expect(buildClaudeRuntimeArgs('marketplaces', ['add', 'team/marketplace'], {}))
      .toEqual(['plugin', 'marketplace', 'add', 'team/marketplace', '--scope', 'project']);
    expect(buildClaudeRuntimeArgs('marketplaces', ['remove', 'team'], {}))
      .toEqual(['plugin', 'marketplace', 'remove', 'team', '--scope', 'project']);
    expect(buildClaudeRuntimeArgs('marketplaces', ['remove', 'team'], { scope: 'local' }))
      .toEqual(['plugin', 'marketplace', 'remove', 'team', '--scope', 'local']);
  });

  it('plans native marketplace refresh with an optional name and no unsupported scope flag', () => {
    expect(buildClaudeRuntimeArgs('marketplaces', ['update'], {})).toEqual(['plugin', 'marketplace', 'update']);
    expect(buildClaudeRuntimeArgs('marketplaces', ['update', 'team'], {})).toEqual(['plugin', 'marketplace', 'update', 'team']);
    expect(() => buildClaudeRuntimeArgs('marketplaces', ['update'], { scope: 'project' })).toThrow(/--scope is not supported/);
  });

  it('plans runtime diagnostics without entering an interactive Claude session', () => {
    expect(buildClaudeRuntimeArgs('runtime', ['version'], {})).toEqual(['--version']);
    expect(buildClaudeRuntimeArgs('runtime', ['doctor'], {})).toEqual(['doctor']);
    expect(() => buildClaudeRuntimeArgs('runtime', [], {})).toThrow(/Unknown Claude/);
    expect(buildClaudeRuntimeArgs('runtime', ['install', 'stable'], {})).toEqual(['install', 'stable']);
    expect(buildClaudeRuntimeArgs('runtime', ['update'], {})).toEqual(['update']);
  });

  it.each(['', ' ', '--help', '--scope=user', '\0bad'])('rejects ambiguous or option-like operands %j', operand => {
    expect(() => buildClaudeRuntimeArgs('plugins', ['install', operand], {}))
      .toThrowError(expect.objectContaining({ code: 'INVALID_CLAUDE_ARGUMENT' }));
  });

  it('keeps metacharacters literal and forwards installer acceptance only when explicit', () => {
    expect(buildClaudeRuntimeArgs('marketplaces', ['add', './plugin;$(command)'], {}))
      .toEqual(['plugin', 'marketplace', 'add', './plugin;$(command)', '--scope', 'project']);
    expect(buildClaudeRuntimeArgs('plugins', ['install', 'name'], { yes: true })).toEqual(['plugin', 'install', 'name', '--scope', 'project', '--json', '--yes']);
    expect(() => buildClaudeRuntimeArgs('plugins', ['install', 'name'], { 'accept-command': 'digest' })).toThrow(/SHA-256/);
    const hash = 'a'.repeat(64);
    expect(buildClaudeRuntimeArgs('plugins', ['update', 'name'], { 'accept-command': hash })).toEqual(['plugin', 'update', 'name', '--scope', 'project', '--json', '--accept-command', hash]);
    expect(() => buildClaudeRuntimeArgs('plugins', ['install', 'name'], { yes: true, 'accept-command': hash })).toThrow(/not both/);
  });

  it('plans details, configuration reads, and stdin writes without exposing values in argv', () => {
    expect(buildClaudeRuntimeArgs('plugins', ['details', 'review@team'], {})).toEqual(['plugin', 'details', 'review@team']);
    expect(buildClaudeRuntimeArgs('plugins', ['configure', 'review@team'], {})).toEqual(['plugin', 'configure', 'review@team', '--json']);
    const flags = { 'values-stdin': true, content: '{"token":"never-in-argv"}' };
    expect(buildClaudeRuntimeArgs('plugins', ['configure', 'review@team'], flags)).toEqual(['plugin', 'configure', 'review@team', '--json', '--values-stdin']);
    expect(claudeRuntimeNeedsInput('plugins', ['configure', 'review@team'], flags)).toBe(true);
    expect(claudeRuntimeNeedsInput('plugins', ['configure', 'review@team'], {})).toBe(false);
    expect(() => buildClaudeRuntimeArgs('plugins', ['configure', 'review'], {})).toThrow(/name@marketplace/);
    expect(() => buildClaudeRuntimeArgs('plugins', ['configure', 'review@team'], { content: '{}' })).toThrow(/--content is not supported/);
    expect(() => buildClaudeRuntimeArgs('plugins', ['configure', 'review@team'], { scope: 'user' })).toThrow(/--scope is not supported/);
  });

  it('plans prune and release maintenance without adding confirmation or publication flags', () => {
    expect(buildClaudeRuntimeArgs('plugins', ['prune'], {})).toEqual(['plugin', 'prune', '--scope', 'project']);
    expect(buildClaudeRuntimeArgs('plugins', ['prune'], { yes: true, scope: 'user' })).toEqual(['plugin', 'prune', '--scope', 'user', '--yes']);
    expect(buildClaudeRuntimeArgs('plugins', ['tag', './plugins/review'], { 'dry-run': true })).toEqual(['plugin', 'tag', './plugins/review']);
    expect(buildClaudeRuntimeArgs('plugins', ['tag'], { message: 'Ship %s', remote: 'origin', push: true, force: true })).toEqual(['plugin', 'tag', '--message', 'Ship %s', '--remote', 'origin', '--push', '--force']);
    expect(buildClaudeRuntimeArgs('plugins', ['test'], {})).toEqual(['plugin', 'test']);
    expect(buildClaudeRuntimeArgs('plugins', ['test', './mod'], {})).toEqual(['plugin', 'test', './mod']);
  });

  it('scaffolds at the native fixed location and expands a validated component list', () => {
    expect(buildClaudeRuntimeArgs('plugins', ['init', 'review'], { description: 'Review code', with: '["skills","hooks","channel"]' })).toEqual(['plugin', 'init', 'review', '--description', 'Review code', '--with', 'skills', 'hooks', 'channel']);
    expect(() => buildClaudeRuntimeArgs('plugins', ['init', 'review'], { with: '["unknown"]' })).toThrow(/--with/);
    expect(() => buildClaudeRuntimeArgs('plugins', ['init', 'review'], { scope: 'project' })).toThrow(/--scope is not supported/);
    expect(buildClaudeRuntimeArgs('plugins', ['init', 'review'], { description: '--literal' })).toContain('--description=--literal');
  });

  it('plans eval targets before variadic flags and keeps execution grants explicit', () => {
    expect(buildClaudeRuntimeArgs('plugins', ['eval', './plugin'], { runs: '2', concurrency: '3', model: 'sonnet', 'judge-model': 'haiku', ablation: 'none', threshold: '0.8', 'max-cost-usd': '1.5', 'allow-tools': '["Read","Bash(git diff *)"]', tag: '["smoke","regression"]', 'no-publish': true })).toEqual([
      'plugin', 'eval', './plugin', '--runs', '2', '--concurrency', '3', '--model', 'sonnet', '--judge-model', 'haiku', '--ablation', 'none', '--threshold', '0.8', '--max-cost-usd', '1.5', '--allow-tools', 'Read', 'Bash(git diff *)', '--tag', 'smoke', 'regression', '--no-publish',
    ]);
    expect(buildClaudeRuntimeArgs('plugins', ['eval'], {})).toEqual(['plugin', 'eval']);
    expect(buildClaudeRuntimeArgs('plugins', ['eval', 'init', 'smoke'], { bare: true, 'eval-dir': 'checks' })).toEqual(['plugin', 'eval', 'init', 'smoke', '--bare', '--eval-dir', 'checks']);
    expect(() => buildClaudeRuntimeArgs('plugins', ['eval', 'init'], {})).toThrow(/positional arguments/);
    expect(() => buildClaudeRuntimeArgs('plugins', ['eval', 'init', 'smoke'], { runs: '2' })).toThrow(/--runs is not supported/);
    expect(() => buildClaudeRuntimeArgs('plugins', ['eval', 'init', 'smoke'], { interactive: true })).toThrow(/requires a terminal/);
    expect(() => buildClaudeRuntimeArgs('plugins', ['eval', 'init', 'smoke'], { bare: true, interactive: true })).toThrow(/requires a terminal/);
  });

  it('separates native eval JSON stdout from Forge formatting and native file output', () => {
    expect(buildClaudeRuntimeArgs('plugins', ['eval', './plugin'], { json: true })).toEqual(['plugin', 'eval', './plugin']);
    expect(claudeRuntimeOutput('plugins', ['eval', './plugin'], { json: true })).toBe('text');
    const flags = { 'native-json': true, tag: '["smoke","release"]' };
    expect(buildClaudeRuntimeArgs('plugins', ['eval', './plugin'], flags)).toEqual(['plugin', 'eval', './plugin', '--json', '--tag', 'smoke', 'release']);
    expect(claudeRuntimeOutput('plugins', ['eval', './plugin'], flags)).toBe('json');
    expect(buildClaudeRuntimeArgs('plugins', ['eval', './plugin'], { 'native-json-output': 'reports/review.json' })).toEqual(['plugin', 'eval', './plugin', '--json', 'reports/review.json']);
    expect(claudeRuntimeOutput('plugins', ['eval', './plugin'], { 'native-json-output': 'reports/review.json' })).toBe('text');
    const fileFlags = { 'native-json': true, 'native-json-output': '--literal.json' };
    expect(buildClaudeRuntimeArgs('plugins', ['eval', './plugin'], fileFlags)).toEqual(['plugin', 'eval', './plugin', '--json=--literal.json']);
    expect(claudeRuntimeOutput('plugins', ['eval', './plugin'], fileFlags)).toBe('text');
    expect(() => buildClaudeRuntimeArgs('plugins', ['list'], { 'native-json': true })).toThrow(/not supported/);
    expect(() => buildClaudeRuntimeArgs('plugins', ['eval', 'init', 'smoke'], { 'native-json-output': 'out.json' })).toThrow(/not supported/);
  });

  it.each<Record<string, string | boolean>>([
    { concurrency: '9' }, { runs: '0' }, { threshold: '1.2' }, { 'max-cost-usd': 'NaN' },
    { ablation: 'both' }, { mocks: 'live' }, { 'allow-tools': '["--trust-plugin"]' },
    { 'allow-tools': '[bad-json' }, { scaffold: true, 'no-scaffold': true },
    { 'no-publish': true, 'publish-report': true }, { report: './report.html' },
    { 'native-json-output': 'report.txt' }, { 'native-json-output': '' }, { 'native-json-output': 'bad\0.json' }, { 'native-json': 'yes' },
  ])('rejects unsupported eval options or values %#', flags => {
    expect(() => buildClaudeRuntimeArgs('plugins', ['eval', './plugin'], flags)).toThrowError(expect.objectContaining({ code: 'INVALID_CLAUDE_OPTION' }));
  });

  it('handles optional data measurement, explicit disable-all, and installed config entries', () => {
    expect(buildClaudeRuntimeArgs('plugins', ['list'], { 'data-size': '' })).toEqual(['plugin', 'list', '--json', '--data-size']);
    expect(buildClaudeRuntimeArgs('plugins', ['disable'], { all: true })).toEqual(['plugin', 'disable', '--json', '--all']);
    expect(() => buildClaudeRuntimeArgs('plugins', ['disable'], { all: true, scope: 'project' })).toThrow(/without a plugin name or scope/);
    expect(() => buildClaudeRuntimeArgs('plugins', ['disable'], {})).toThrow(/Disable one plugin/);
    expect(() => buildClaudeRuntimeArgs('plugins', ['install', 'review@team'], { 'keep-data': true })).toThrow(/--keep-data is not supported/);
  });

  it('expands repeated install config and marketplace sparse options without a shell', () => {
    expect(buildClaudeRuntimeArgs('plugins', ['install', 'review@team'], { config: '["region=eu","mode=quiet"]' })).toEqual(['plugin', 'install', 'review@team', '--scope', 'project', '--json', '--config', 'region=eu', '--config', 'mode=quiet']);
    expect(buildClaudeRuntimeArgs('marketplaces', ['add', 'team/repo'], { sparse: '["plugins/review",".claude-plugin"]' })).toEqual(['plugin', 'marketplace', 'add', 'team/repo', '--scope', 'project', '--sparse', 'plugins/review', '.claude-plugin']);
    expect(buildClaudeRuntimeArgs('marketplaces', ['add', 'organization-library'], { claudeai: true })).toEqual(['plugin', 'marketplace', 'add', 'organization-library', '--claudeai']);
    expect(() => buildClaudeRuntimeArgs('marketplaces', ['add', 'organization-library'], { claudeai: true, scope: 'user' })).toThrow(/cannot be combined/);
    expect(claudeRuntimeOptions).toMatchObject({ 'values-stdin': 'boolean', with: 'string', 'no-publish': 'boolean', 'max-cost-usd': 'string', 'native-json': 'boolean', 'native-json-output': 'string' });
  });

  it('rejects unrecognized commands, excess operands and options used with the wrong action', () => {
    expect(() => buildClaudeRuntimeArgs('plugins', ['constructor'], {})).toThrow(/Unknown Claude/);
    expect(() => buildClaudeRuntimeArgs('plugins', ['list', 'name'], {})).toThrow(/positional arguments/);
    expect(() => buildClaudeRuntimeArgs('plugins', ['install'], {})).toThrow(/positional arguments/);
    expect(() => buildClaudeRuntimeArgs('plugins', ['list'], { scope: 'project' })).toThrow(/--scope is not supported/);
    expect(() => buildClaudeRuntimeArgs('plugins', ['install', 'name'], { strict: true })).toThrow(/--strict is not supported/);
    expect(() => buildClaudeRuntimeArgs('plugins', ['validate', '.'], { available: true })).toThrow(/--available is not supported/);
    expect(() => buildClaudeRuntimeArgs('plugins', ['list'], { available: 'yes' })).toThrow(/boolean option/);
    expect(() => buildClaudeRuntimeArgs('plugins', ['install', 'name'], { scope: true })).toThrow(/Invalid scope/);
  });
});
