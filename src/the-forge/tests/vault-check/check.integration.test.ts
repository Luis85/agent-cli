import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { vaultCheckPlugin } from '../../src/plugins/vault-check/plugin.ts';
import type { CorePlugin } from '../../src/application/plugins/core-plugins.ts';
import { vaultCommand, type VaultFinding as Finding } from '../support/vault-check.ts';

let root: string;
const put = async (path: string, content: string) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
};
/** The vault command over the fixture vault. */
const vault = (settings: Record<string, unknown> = {}, options: { plugins?: CorePlugin[]; language?: 'en' | 'de' } = {}) => vaultCommand(root, settings, options);
const brief = (findings: Finding[]) => findings.map(({ rule, severity, path, line, column }) => [rule, severity, `${path}:${line}:${column}`]);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-vault-check-'));
  await put('Home.md', '# Home\n\n## Plan Ahead\n\nSee [[notes/a#Missing]], [[notes/a#Real heading]], [x](notes/a.md#real-heading) and [[notes/a#^blk]].\nAlso [[Nots/a]], ![[img.png]], [[#Plan ahead]] and [[Idea]].\n');
  await put('notes/a.md', '---\nstatus: 1\ncreated: 2024-01-01\n---\n# Real heading\n\npara ![[used.png]] ^blk\n\n- item ^BLK\n');
  await put('notes/b.md', '---\nstatus: draft\nrelated:\n  - "[[notes/a]]"\n  - "[[Gone]]"\n---\nBody #project/alpha\n');
  await put('notes/c.md', '---\nstatus: done\nbad: [\n---\n');
  await put('notes/empty.md', '');
  await put('a/Idea.md', 'One.\n');
  await put('b/Idea.md', 'Two.\n');
  await put('assets/pic.png', 'x');
  await put('assets/used.png', 'x');
  await put('board.canvas', '{"nodes":[{"id":"a","type":"text","text":"x","x":0,"y":0,"width":10,"height":10}],"edges":[{"id":"e1","fromNode":"a","toNode":"zz"}]}');
  await put('map.canvas', '{"nodes":[{"id":"n1","type":"file","file":"notes/missing.md","x":0,"y":0,"width":10,"height":10}]}');
  await put('views/broken.base', 'views:\n  - type: table\n    name: Open\n    filters: "file.name ==="\n');
  await put('views/good.base', 'views:\n  - type: table\n    name: All\n');
  await put('.obsidian/types.json', '{"types":{"status":"text"}}');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('vault check', () => {
  it('reports every rule with severity, location, message and hint in deterministic order', async () => {
    const { check } = await vault();
    const result = await check();
    expect(brief(result.findings)).toEqual([
      ['unresolved-anchor', 'warning', 'Home.md:5:5'],
      ['unresolved-link', 'error', 'Home.md:6:6'],
      ['unresolved-embed', 'error', 'Home.md:6:18'],
      ['ambiguous-link', 'warning', 'Home.md:6:52'],
      ['orphan-attachment', 'info', 'assets/pic.png:null:null'],
      ['invalid-canvas', 'error', 'board.canvas:null:null'],
      ['unresolved-embed', 'error', 'map.canvas:null:null'],
      ['property-type-mismatch', 'warning', 'notes/a.md:2:1'],
      ['duplicate-block-id', 'warning', 'notes/a.md:9:1'],
      ['unresolved-link', 'error', 'notes/b.md:5:6'],
      ['invalid-frontmatter', 'error', 'notes/c.md:4:1'],
      ['empty-file', 'warning', 'notes/empty.md:null:null'],
      ['invalid-base', 'error', 'views/broken.base:null:null'],
    ]);
    const [anchor, missing] = result.findings;
    expect(anchor).toMatchObject({ message: 'Link [[notes/a#Missing]] names #Missing, which notes/a.md does not contain.' });
    expect(missing).toEqual({
      rule: 'unresolved-link', severity: 'error', path: 'Home.md', line: 6, column: 6, suggestion: 'notes/a.md',
      message: 'Link [[Nots/a]] does not resolve to a file.',
      hint: 'Create the target note, correct the link path, or remove the link. Closest existing file: notes/a.md.',
    });
    expect(result.findings.find(finding => finding.rule === 'ambiguous-link')!.message).toBe('Link [[Idea]] matches several files: a/Idea.md, b/Idea.md.');
    expect(result.findings.find(finding => finding.path === 'board.canvas')!.message).toBe('The Canvas is invalid (INVALID_CANVAS): Edge endpoints must reference existing nodes: edge e1 names missing node zz.');
    expect(result.findings.find(finding => finding.path === 'map.canvas')!.message).toBe('Canvas file node n1 shows notes/missing.md, which does not exist.');
    expect(result.findings.find(finding => finding.path === 'notes/b.md')!.message).toBe('Property related.1 links [[Gone]], which does not resolve to a file.');
    expect(result.findings.find(finding => finding.path === 'notes/c.md')!.message).toMatch(/^The note cannot be parsed \(INVALID_YAML\): Flow sequence .* at line 3, column 1\.$/);
    expect(result.findings.find(finding => finding.rule === 'property-type-mismatch')!.message).toBe('Property status is number here, but .obsidian/types.json declares it text.');
    expect(result.findings.find(finding => finding.rule === 'duplicate-block-id')!.message).toBe('Block id ^BLK is already used on line 7.');
    expect(result.findings.find(finding => finding.rule === 'invalid-base')!.message).toMatch(/^View Open of the Base is invalid \(INVALID_BASE_EXPRESSION\): /);
    expect(result.summary).toEqual({ files: 13, findings: 13, error: 7, warning: 5, info: 1 });
    expect(result.rules.map(rule => [rule.id, rule.severity, rule.findings])).toEqual([
      ['unresolved-link', 'error', 2], ['unresolved-embed', 'error', 2], ['ambiguous-link', 'warning', 1], ['unresolved-anchor', 'warning', 1],
      ['invalid-frontmatter', 'error', 1], ['invalid-canvas', 'error', 1], ['invalid-base', 'error', 1], ['property-type-mismatch', 'warning', 1],
      ['duplicate-block-id', 'warning', 1], ['empty-file', 'warning', 1], ['orphan-attachment', 'info', 1],
    ]);
    expect(result).toMatchObject({ skipped: [], strict: false });
  });

  it('filters by --path and --rule and rejects unknown rules, actions and arguments', async () => {
    const { check, run } = await vault();
    expect(brief((await check({ path: 'notes/**' })).findings).map(([rule]) => rule)).toEqual(['property-type-mismatch', 'duplicate-block-id', 'unresolved-link', 'invalid-frontmatter', 'empty-file']);
    const selected = await check({ rule: ' empty-file , unresolved-link' });
    expect(selected.rules.map(rule => rule.id)).toEqual(['unresolved-link', 'empty-file']);
    expect(brief(selected.findings).map(([rule, , at]) => `${rule} ${at}`)).toEqual(['unresolved-link Home.md:6:6', 'unresolved-link notes/b.md:5:6', 'empty-file notes/empty.md:null:null']);
    expect(await run([])).toMatchObject({ summary: { findings: 13 } });
    for (const [args, flags] of [[['check'], { rule: 'nope' }], [['check'], { rule: ',' }], [['lint'], {}], [['check', 'x'], {}], [['tags'], { sort: 'size' }], [['properties'], { name: ' ' }], [['check'], { path: '[z-a]' }]] as const) {
      await expect(run([...args], { ...flags }), JSON.stringify([args, flags])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
  });

  it('fails with VAULT_CHECK_FAILED under --strict only when an error finding remains', async () => {
    const { check } = await vault();
    const failure = await check({ strict: true }).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: 'VAULT_CHECK_FAILED', exitCode: 2,
      message: 'vault check --strict found 7 error findings (2 unresolved-link, 2 unresolved-embed, 1 invalid-frontmatter, 1 invalid-canvas, 1 invalid-base).',
      details: { summary: { error: 7, warning: 5, info: 1 }, truncated: false },
    });
    const details = (failure as { details: { findings: Finding[] } }).details;
    expect(details.findings).toHaveLength(7);
    expect(details.findings.every(finding => finding.severity === 'error')).toBe(true);
    // Warnings and info never fail the check; neither do rules a selection leaves out.
    expect(await check({ strict: true, rule: 'ambiguous-link,orphan-attachment,empty-file' })).toMatchObject({ strict: true, summary: { error: 0, warning: 2, info: 1 } });
    expect(await check({ strict: true, path: 'a/**' })).toMatchObject({ summary: { files: 1, findings: 0 } });
  });

  it('applies configured severities and ignore globs, which keep files as link targets', async () => {
    const { check } = await vault({ 'vault-check': { rules: { 'unresolved-embed': 'warning', 'empty-file': 'off', 'orphan-attachment': 'error' }, ignore: ['notes/c.md', 'views/**'] } });
    const result = await check({ rule: 'empty-file,unresolved-embed,orphan-attachment,invalid-frontmatter,invalid-base' });
    expect(brief(result.findings)).toEqual([
      ['unresolved-embed', 'warning', 'Home.md:6:18'],
      ['orphan-attachment', 'error', 'assets/pic.png:null:null'],
      ['unresolved-embed', 'warning', 'map.canvas:null:null'],
    ]);
    expect(result.skipped).toEqual([{ rule: 'empty-file', reason: 'off', message: 'Turned off in plugins.settings.vault-check.rules.' }]);
    expect(result.summary.files).toBe(10);
  });

  it('makes only the plugin unavailable for an invalid section', async () => {
    const { check } = await vault({ 'vault-check': { ignore: ['[z-a]'], rules: { 'empty-file': 'fatal' } } });
    await expect(check()).rejects.toMatchObject({ code: 'PLUGIN_UNAVAILABLE', details: { plugin: 'vault-check' } });
    const { check: unknownRule } = await vault({ 'vault-check': { rules: { 'no-such-rule': 'error' } } });
    await expect(unknownRule()).rejects.toMatchObject({ code: 'PLUGIN_UNAVAILABLE' });
    const { check: badGlob } = await vault({ 'vault-check': { ignore: ['[z-a]'] } });
    await expect(badGlob()).rejects.toMatchObject({ details: { issues: ['plugins.settings.vault-check.ignore[0]: has the reversed class range [z-a].'] } });
  });

  it('skips invalid-base when the bases plugin and its bases.validation service are absent', async () => {
    const { check } = await vault({}, { plugins: [vaultCheckPlugin] });
    const result = await check();
    expect(result.findings.some(finding => finding.rule === 'invalid-base')).toBe(false);
    expect(result.skipped).toEqual([{ rule: 'invalid-base', reason: 'unavailable', message: expect.stringContaining('bases.validation') }]);
    expect(result.rules.map(rule => rule.id)).not.toContain('invalid-base');
  });

  it('infers property types without .obsidian/types.json and reports an invalid one', async () => {
    await rm(join(root, '.obsidian/types.json'));
    await put('notes/d.md', '---\nstatus: open\n---\nText.\n');
    const { check } = await vault();
    const inferred = (await check({ rule: 'property-type-mismatch' })).findings;
    expect(inferred).toEqual([expect.objectContaining({ path: 'notes/a.md', line: 2, column: 1, message: 'Property status is number here, but text in 2 other notes.' })]);
    await put('.obsidian/types.json', '{"types": [');
    const invalid = (await check({ rule: 'property-type-mismatch' })).findings;
    expect(brief(invalid)).toEqual([['property-type-mismatch', 'warning', '.obsidian/types.json:null:null'], ['property-type-mismatch', 'warning', 'notes/a.md:2:1']]);
    expect(invalid[0]!.message).toBe('.obsidian/types.json is not valid JSON, so no property types are declared.');
  });

  it('localizes findings, hints and skip reasons in German', async () => {
    const { check } = await vault({}, { language: 'de' });
    const result = await check({ rule: 'unresolved-link,empty-file' });
    expect(result.findings[0]).toMatchObject({ message: 'Der Link [[Nots/a]] verweist auf keine Datei.', hint: expect.stringContaining('Nächstliegende vorhandene Datei: notes/a.md.') });
    expect(result.findings.at(-1)).toMatchObject({ message: 'Die Datei ist leer.' });
  });

  it('reads without writing or emitting plugin events', async () => {
    const { check, run, events } = await vault();
    await check();
    await run(['tags']);
    await run(['properties']);
    const history: string[] = [];
    await events.replay(record => { history.push(record.id); });
    expect(history.filter(id => id.startsWith('vault') || id.startsWith('operation.'))).toEqual([]);
  });
});

describe('vault tags and vault properties', () => {
  it('inventories tags with nested roll-up and properties with inferred and declared types', async () => {
    await put('tagged.md', '---\ntags: [Project, idea]\n---\nText #project/beta #idea\n');
    const { run } = await vault();
    expect(await run(['tags'])).toEqual({ tags: [
      { tag: '#idea', count: 1, files: ['tagged.md'] },
      { tag: '#project', count: 2, files: ['notes/b.md', 'tagged.md'] },
      { tag: '#project/alpha', count: 1, files: ['notes/b.md'] },
      { tag: '#project/beta', count: 1, files: ['tagged.md'] },
    ] });
    expect(((await run(['tags'], { sort: 'count', path: 'tagged.md' })) as { tags: Array<{ tag: string }> }).tags.map(entry => entry.tag)).toEqual(['#idea', '#project', '#project/beta']);
    expect(await run(['properties'])).toEqual({
      properties: [
        { name: 'created', count: 1, empty: 0, types: { date: 1 }, type: 'date', declared: null, conflicting: false },
        { name: 'related', count: 1, empty: 0, types: { list: 1 }, type: 'list', declared: null, conflicting: false },
        { name: 'status', count: 2, empty: 0, types: { number: 1, text: 1 }, type: 'number', declared: 'text', conflicting: true },
        { name: 'tags', count: 1, empty: 0, types: { list: 1 }, type: 'list', declared: null, conflicting: false },
      ],
      typesFile: { path: '.obsidian/types.json', status: 'loaded' },
    });
    expect(await run(['properties'], { name: 'status', path: 'notes/**' })).toMatchObject({ properties: [{ name: 'status', files: [{ path: 'notes/a.md', type: 'number' }, { path: 'notes/b.md', type: 'text' }] }] });
    expect(await run(['properties'], { name: 'nothing' })).toMatchObject({ properties: [] });
  });
});
