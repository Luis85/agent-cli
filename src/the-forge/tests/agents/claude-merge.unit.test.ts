import { describe, expect, it } from 'vitest';
import { mergeSettings, nextManifest, parseManifest, type GeneratedSettings } from '../../src/plugins/agents/domain/claude-merge.ts';

const rules = (allow: string[] = [], deny: string[] = [], ask: string[] = []): GeneratedSettings => ({ permissions: { allow, ask, deny } });
const permissions = (text: string) => JSON.parse(text).permissions as Record<string, string[]> | undefined;

/** One generation: the merged settings text and the manifest text it records. */
function generate(settings: string | undefined, manifestText: string | undefined, generated: GeneratedSettings) {
  const merged = mergeSettings(settings, generated, parseManifest(manifestText));
  return { settings: merged.text, manifest: nextManifest(parseManifest(manifestText), manifestText, { settings: merged.text }, { servers: {}, permissions: merged.owned }) };
}

describe('permission rules Forge merges into .claude/settings.json', () => {
  it('records the rules it adds, but not rules the user already had', () => {
    const user = '{\n  "permissions": {"allow": ["Bash(git *)"], "deny": ["Read(.env)"]}\n}\n';
    const first = generate(user, undefined, rules(['Bash(git *)', 'Bash(npm test)'], ['Read(.env)', 'Read(./secrets/**)']));
    expect(permissions(first.settings)).toEqual({ allow: ['Bash(git *)', 'Bash(npm test)'], deny: ['Read(.env)', 'Read(./secrets/**)'] });
    expect(JSON.parse(first.manifest).settings).toEqual({ permissions: { allow: ['Bash(npm test)'], deny: ['Read(./secrets/**)'] } });
  });

  it('removes the rules it added once a definition no longer grants them, and never touches user rules', () => {
    const user = '{\n  "permissions": {"allow": ["Bash(git *)"]}\n}\n';
    const first = generate(user, undefined, rules(['Bash(git *)', 'Bash(npm test)', 'Read(./docs/**)']));
    const second = generate(first.settings, first.manifest, rules(['Read(./docs/**)']));
    expect(permissions(second.settings)).toEqual({ allow: ['Bash(git *)', 'Read(./docs/**)'] });
    expect(JSON.parse(second.manifest).settings).toEqual({ permissions: { allow: ['Read(./docs/**)'] } });
    const third = generate(second.settings, second.manifest, rules());
    expect(permissions(third.settings)).toEqual({ allow: ['Bash(git *)'] });
    expect(JSON.parse(third.manifest).settings).toEqual({});
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
    expect(JSON.parse(second.manifest).settings).toEqual({ permissions: { allow: ['Bash(npm test)'] } });
  });

  it('keeps the recorded rules when a later run writes no settings', () => {
    const first = generate(undefined, undefined, rules(['Bash(npm test)']));
    const manifest = nextManifest(parseManifest(first.manifest), first.manifest, { settings: first.settings }, { servers: {} });
    expect(JSON.parse(manifest).settings).toEqual({ permissions: { allow: ['Bash(npm test)'] } });
  });

  it('rejects a manifest whose recorded rules are not lists of strings', () => {
    expect(() => parseManifest(JSON.stringify({ settings: { permissions: { allow: 'Bash' } } }))).toThrowError(expect.objectContaining({ code: 'INVALID_CLAUDE_SETTINGS' }));
  });
});
