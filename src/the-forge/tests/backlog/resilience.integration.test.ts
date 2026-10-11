import { afterEach, describe, expect, it } from 'vitest';
import { backlogVault, runBacklog } from '../support/backlog.ts';

const base = (folder: string, extra = '') => `filters:\n  and:\n    - file.inFolder("${folder}")\nviews:\n  - type: product-backlog\n    name: Backlog\n    homeFolder: ${folder}\n    stateProperty: note.status\n${extra}`;
const note = (fields: Record<string, unknown>, body = '') => `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n${body}`;
let vault: Awaited<ReturnType<typeof backlogVault>> | undefined;
afterEach(async () => { await vault?.dispose(); vault = undefined; });

describe('a backlog over notes Obsidian indexes leniently', () => {
  it('reads every command despite ambiguous links and unparseable notes, reporting them as check warnings', async () => {
    vault = await backlogVault({
      'b/Backlog.base': base('b'),
      'archive/README.md': '# old', 'docs/README.md': '# docs',
      'b/Epic.md': note({ type: 'Epic', order: 1 }, 'See [[README]].\n'),
      'x/Epic.md': note({ type: 'Note' }),
      'b/stories/Story.md': note({ type: 'PBI', parent: '[[Epic]]', order: 2 }),
      'b/Broken.md': '---\ntype: PBI\ntype: Task\n---\n',
      'outside/Other.md': '[[README]]',
      'outside/Flow.md': '---\ntags: [a\n---\n',
    });
    const list = await runBacklog(vault.root, ['list']);
    expect(list.data.items.map((item: { path: string; parent: string | null }) => [item.path, item.parent])).toEqual([['b/Epic.md', null], ['b/stories/Story.md', 'b/Epic.md']]);
    const check = await runBacklog(vault.root, ['check']);
    expect(check.data.ok).toBe(true);
    expect(check.data.problems).toEqual([
      expect.objectContaining({ code: 'unparseable-note', severity: 'warning', path: 'b/Broken.md' }),
      expect.objectContaining({ code: 'ambiguous-link', severity: 'warning', path: 'b/Epic.md', value: 'README' }),
      expect.objectContaining({ code: 'ambiguous-link', severity: 'warning', path: 'b/stories/Story.md', value: 'Epic' }),
    ]);
    await runBacklog(vault.root, ['set', 'Story'], { state: 'Open' });
    expect(await vault.read('b/stories/Story.md')).toContain('status: Open');
  });

  it('keeps aliased values when it edits a note whose frontmatter uses anchors', async () => {
    vault = await backlogVault({ 'b/Backlog.base': base('b'), 'b/Epic.md': '---\ntype: &kind Epic\nkind: *kind\norder: 1\n---\nBody\n' });
    await runBacklog(vault.root, ['set', 'Epic'], { state: 'Open' });
    expect(await vault.read('b/Epic.md')).toBe('---\ntype: Epic\nkind: Epic\norder: 1\nstatus: Open\n---\nBody\n');
  });
});
