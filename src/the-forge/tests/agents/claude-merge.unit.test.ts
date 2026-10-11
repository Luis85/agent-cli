import { describe, expect, it } from 'vitest';
import { mergeSettings, nextManifest, parseManifest, type GeneratedSettings } from '../../src/plugins/agents/domain/claude-merge.ts';
import type { GenerationCoverage, RuleOrigin } from '../../src/plugins/agents/domain/claude-rule-ownership.ts';

const team: RuleOrigin = { file: 'agents/team.yaml' };
const granted = (rules: string[], origin = team) => rules.map(rule => ({ rule, origins: [origin] }));
const rules = (allow: string[] = [], deny: string[] = [], ask: string[] = [], origin = team): GeneratedSettings => ({ permissions: { allow: granted(allow, origin), ask: granted(ask, origin), deny: granted(deny, origin) } });
const permissions = (text: string) => JSON.parse(text).permissions as Record<string, string[]> | undefined;

/** One generation: the merged settings text, the manifest text it records and the rules it revoked. */
function generate(settings: string | undefined, manifestText: string | undefined, generated: GeneratedSettings, coverage?: GenerationCoverage) {
  const merged = mergeSettings(settings, generated, parseManifest(manifestText), coverage);
  return { settings: merged.text, revoked: merged.revoked, manifest: nextManifest(parseManifest(manifestText), manifestText, { settings: merged.text }, { servers: {}, permissions: merged.owned }) };
}

describe('permission rules Forge merges into .claude/settings.json', () => {
  it('records the rules it adds with their origins, but not rules the user already had', () => {
    const user = '{\n  "permissions": {"allow": ["Bash(git *)"], "deny": ["Read(.env)"]}\n}\n';
    const first = generate(user, undefined, rules(['Bash(git *)', 'Bash(npm test)'], ['Read(.env)', 'Read(./secrets/**)']));
    expect(permissions(first.settings)).toEqual({ allow: ['Bash(git *)', 'Bash(npm test)'], deny: ['Read(.env)', 'Read(./secrets/**)'] });
    expect(JSON.parse(first.manifest).settings).toEqual({ permissions: { allow: granted(['Bash(npm test)']), deny: granted(['Read(./secrets/**)']) } });
  });

  it('removes the rules it added once a definition no longer grants them, and never touches user rules', () => {
    const user = '{\n  "permissions": {"allow": ["Bash(git *)"]}\n}\n';
    const first = generate(user, undefined, rules(['Bash(git *)', 'Bash(npm test)', 'Read(./docs/**)']));
    const second = generate(first.settings, first.manifest, rules(['Read(./docs/**)']));
    expect(permissions(second.settings)).toEqual({ allow: ['Bash(git *)', 'Read(./docs/**)'] });
    expect(second.revoked).toEqual([{ list: 'allow', rule: 'Bash(npm test)', origins: [team] }]);
    expect(JSON.parse(second.manifest).settings).toEqual({ permissions: { allow: granted(['Read(./docs/**)']) } });
    const third = generate(second.settings, second.manifest, rules());
    expect(permissions(third.settings)).toEqual({ allow: ['Bash(git *)'] });
    expect(JSON.parse(third.manifest).settings).toEqual({});
  });

  it('keeps a rule another definition still grants when a generation covers only some definitions', () => {
    const other: RuleOrigin = { file: 'agents/other.yaml' }, alpha: RuleOrigin = { file: 'agents/team.yaml', agent: 'alpha' };
    const both: GeneratedSettings = { permissions: { allow: [], ask: [], deny: [
      { rule: 'Bash(*sudo*)', origins: [team, other] }, { rule: 'Bash(*rm -rf*)', origins: [other] }, { rule: 'Read(./secrets/**)', origins: [alpha] },
    ] } };
    const first = generate(undefined, undefined, both);
    // Only agents/team.yaml regenerates and grants nothing any more: the rules of agents/other.yaml stay.
    const subset = generate(first.settings, first.manifest, rules(), { files: ['agents/team.yaml'] });
    expect(permissions(subset.settings)).toEqual({ deny: ['Bash(*sudo*)', 'Bash(*rm -rf*)'] });
    expect(subset.revoked).toEqual([{ list: 'deny', rule: 'Read(./secrets/**)', origins: [alpha] }]);
    expect(JSON.parse(subset.manifest).settings.permissions.deny).toEqual([{ rule: 'Bash(*sudo*)', origins: [other] }, { rule: 'Bash(*rm -rf*)', origins: [other] }]);
    // One agent covers only that agent's own rules, never its file's top-level permissions.
    const agentOnly = generate(first.settings, first.manifest, rules(), { files: ['agents/team.yaml'], agent: 'alpha' });
    expect(agentOnly.revoked.map(entry => entry.rule)).toEqual(['Read(./secrets/**)']);
    expect(JSON.parse(agentOnly.manifest).settings.permissions.deny[0]).toEqual({ rule: 'Bash(*sudo*)', origins: [other, team] });
  });

  it('drops a permission list and the permissions object that only held its own rules', () => {
    const first = generate(undefined, undefined, rules([], [], ['Bash(rm *)']));
    expect(JSON.parse(first.settings)).toEqual({ permissions: { ask: ['Bash(rm *)'] } });
    const second = generate(first.settings, first.manifest, rules());
    expect(JSON.parse(second.settings)).toEqual({});
  });

  it('keeps ownership of rules still granted and present, and forgets rules the user removed', () => {
    const first = generate(undefined, undefined, rules(['Bash(npm test)', 'Bash(npm run lint)']));
    const edited = JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } });
    const second = generate(edited, first.manifest, rules(['Bash(npm test)']));
    expect(second.revoked).toEqual([]);
    expect(JSON.parse(second.manifest).settings).toEqual({ permissions: { allow: granted(['Bash(npm test)']) } });
  });

  it('keeps the recorded rules when a later run writes no settings', () => {
    const first = generate(undefined, undefined, rules(['Bash(npm test)']));
    const manifest = nextManifest(parseManifest(first.manifest), first.manifest, { settings: first.settings }, { servers: {} });
    expect(JSON.parse(manifest).settings).toEqual({ permissions: { allow: granted(['Bash(npm test)']) } });
  });

  it('rejects a manifest whose recorded rules are not lists of rules with origins', () => {
    for (const allow of ['Bash', ['Bash'], [{ rule: 'Bash', origins: [] }], [{ rule: 'Bash', origins: [{ agent: 'x' }] }]]) {
      expect(() => parseManifest(JSON.stringify({ settings: { permissions: { allow } } })), JSON.stringify(allow)).toThrowError(expect.objectContaining({ code: 'INVALID_CLAUDE_SETTINGS' }));
    }
  });
});
