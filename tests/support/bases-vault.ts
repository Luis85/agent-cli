import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';

/** Path of the Base definition written by {@link writeSyntheticVault}. */
export const syntheticBase = 'Views/Scale.base';

const statuses = ['open', 'review', 'done', 'blocked'] as const;
const area = (index: number) => `Areas/Area ${index % 20}`;
const note = (index: number) => `Note ${index}`;

/**
 * Write a deterministic vault of linked notes with frontmatter, tags and typed dates, plus attachments that
 * notes embed, and a Base whose view combines formulas, filters, sorting and grouping.
 */
export async function writeSyntheticVault(root: string, { notes: count, attachments }: { notes: number; attachments: number }): Promise<void> {
  const writes: [string, string][] = [
    ['.obsidian/types.json', JSON.stringify({ types: { due: 'date', points: 'number', labels: 'multitext' } })],
    [syntheticBase, stringify({
      filters: { and: ['file.ext == "md"', '!file.path.startsWith("Views/")'] },
      formulas: { weight: 'points * 2 + file.links.length', urgent: 'formula.weight > 20 || file.hasTag("urgent")', label: 'status + "-" + formula.weight' },
      views: [{
        type: 'table', name: 'Scale', limit: 500,
        filters: { or: ['formula.urgent', 'file.hasLink(this.file)', 'parent.asFile().path.contains("Area 3")'] },
        groupBy: { property: 'note.status', direction: 'ASC' }, groupOrder: ['blocked', 'open', 'review', null],
        sort: [{ property: 'formula.weight', direction: 'DESC' }, { property: 'file.name', direction: 'ASC' }],
      }],
    })],
  ];
  for (let index = 0; index < count; index++) {
    const properties = {
      status: index % 11 === 0 ? undefined : statuses[index % statuses.length],
      points: (index * 7) % 13,
      due: `2026-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
      labels: [`label-${index % 5}`, `label-${index % 3}`],
      tags: index % 4 === 0 ? ['project/scale', 'urgent'] : ['project/scale'],
      parent: `[[${note((index * 31 + 7) % count)}]]`,
    };
    const body = [
      `# ${note(index)}`,
      `Related to [[${note((index + 1) % count)}]] and [[${area((index + 3) % count)}/${note((index + 3) % count)}|alias]].`,
      `See [details](../Area%20${(index + 5) % count % 20}/Note%20${(index + 5) % count}.md) and #topic/${index % 9}.`,
      `![[image ${(index * 3) % attachments}.png]] ${index % 2 === 0 ? `[[Missing ${index % 17}]]` : ''}`,
    ].join('\n');
    writes.push([`${area(index)}/${note(index)}.md`, `---\n${stringify(properties)}---\n${body}\n`]);
  }
  for (let index = 0; index < attachments; index++) writes.push([`Assets/image ${index}.png`, 'image bytes']);
  const folders = new Set(writes.map(([path]) => path.slice(0, path.lastIndexOf('/'))));
  await Promise.all([...folders].map(folder => mkdir(join(root, folder), { recursive: true })));
  for (let start = 0; start < writes.length; start += 64) {
    await Promise.all(writes.slice(start, start + 64).map(([path, source]) => writeFile(join(root, path), source)));
  }
}
