import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A 1×1 transparent PNG. */
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f00f0005fe02fe0c2dbf3c0000000049454e44ae426082', 'hex');
const statuses = ['draft', 'active', 'done', 'review'];
const folders = 20;

/** The Base every benchmark vault contains: Markdown notes filtered by status and tag, sorted by priority. */
const notesBase = `filters:
  and:
    - file.ext == "md"
    - file.inFolder("notes")
formulas:
  outgoing: file.links.length
views:
  - type: table
    name: Active
    filters:
      and:
        - status == "active"
        - file.hasTag("t3")
    order:
      - file.name
      - status
      - priority
      - formula.outgoing
    sort:
      - property: priority
        direction: DESC
`;

/** A deterministic pseudo-random sequence (linear congruential), so every run generates the same vault. */
function sequence(seed = 42) {
  let state = seed;
  return (/** @type {number} */ limit) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return Math.floor((state / 2147483648) * limit);
  };
}

/**
 * One note: frontmatter with title, aliases, tags, status, priority, a date and a link property; a body with
 * wikilinks, a heading link with display text, a URL-encoded Markdown link, an alias link, a missing link, inline
 * tags, a block id, tasks and one embed. @param {number} index @param {number} notes @param {number} attachments
 * @param {(limit: number) => number} pick
 */
function note(index, notes, attachments, pick) {
  const links = Array.from({ length: 6 }, () => pick(notes));
  const embed = index < attachments * 2 ? `![[image-${index % attachments}.png]]` : `Embed ![[Note ${links[5]}#Details]]`;
  return [
    '---',
    `title: Note ${index}`,
    `aliases:\n  - Alias ${index}`,
    `tags:\n  - t${index % 10}\n  - area/a${index % 7}`,
    `status: ${statuses[index % 4]}`,
    `priority: ${index % 5}`,
    `created: 2026-0${1 + (index % 9)}-1${index % 9}`,
    `related: "[[Note ${links[0]}]]"`,
    '---',
    `# Note ${index}`,
    '',
    `Intro paragraph with #topic/${index % 13} and a link to [[Note ${links[1]}]] and [[Note ${links[2]}#Details|details]].`,
    '',
    '## Details',
    '',
    `Some details about item ${index}. See [md link](Note%20${links[3]}.md) and [[Alias ${links[4]}]].`,
    `Missing link [[Ghost ${index % 50}]] here. ^block-${index}`,
    '',
    embed,
    '',
    '## Tasks',
    '',
    '- [ ] first task',
    '- [x] second task #done',
    '',
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(3),
    '',
  ].join('\n');
}

/**
 * Writes a deterministic synthetic vault below `root`: `notes` Markdown notes in 20 folders, `attachments` PNG
 * images and `bases/Notes.base`. Returns the number of vault files written.
 * @param {string} root @param {{ notes: number, attachments: number }} size
 */
export function generateVault(root, { notes, attachments }) {
  const pick = sequence();
  mkdirSync(join(root, 'attachments'), { recursive: true });
  for (let index = 0; index < attachments; index++) writeFileSync(join(root, 'attachments', `image-${index}.png`), png);
  for (let index = 0; index < folders; index++) mkdirSync(join(root, 'notes', `f${String(index).padStart(2, '0')}`), { recursive: true });
  for (let index = 0; index < notes; index++) {
    const folder = join(root, 'notes', `f${String(index % folders).padStart(2, '0')}`);
    writeFileSync(join(folder, `Note ${index}.md`), note(index, notes, attachments, pick));
  }
  mkdirSync(join(root, 'bases'), { recursive: true });
  writeFileSync(join(root, 'bases', 'Notes.base'), notesBase);
  return notes + attachments + 1;
}
