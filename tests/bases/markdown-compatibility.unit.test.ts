import { describe, expect, it } from 'vitest';
import { ObsidianDocuments, encodeText, parseMarkdownParts } from '../../src/infrastructure/documents.ts';
import { MarkdownTemplates } from '../../src/infrastructure/templates.ts';

const documents = new ObsidianDocuments();
const templates = new MarkdownTemplates();
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
const body = [
  '# {{title}}  ',
  '',
  '![[Tasks.base]]',
  '![[Tasks.base#Ready for review]]',
  '',
  '```base',
  '# Keep the inline view editable',
  'filters:',
  '  and:',
  '    - file.hasTag("work")',
  '    - status != "done"',
  'formulas:',
  '  label: \'file.name + " — " + status\'',
  'views:',
  '  - type: table',
  '    name: Ready for review',
  '    order:',
  '      - file.name',
  '      - formula.label',
  '```',
  '',
  '> [!tip]- Review notes',
  '> Follow [[Plan#Acceptance|the plan]] and [[Plan#^decision-1]].',
  '',
  '![[Sketch.canvas]]',
  '![[diagram.png|320]]',
  '- [ ] Check $x^2$ and the diagram. ^task-1',
  '',
  '$$',
  'E = mc^2',
  '$$',
  '',
].join('\n');

describe('Markdown source compatibility for Bases', () => {
  it('preserves native Base embeds, view fragments and inline query source during template generation', () => {
    const source = `---\ntitle: {{title}}\nstatus: draft\n---\n${body}`;
    const generated = templates.render(encodeText(source), { title: 'Review dashboard' });
    const parts = parseMarkdownParts(decode(generated));
    expect(encodeText(parts.body)).toEqual(encodeText(body.replace('{{title}}', 'Review dashboard')));
    expect(documents.inspect('Dashboard.md', generated)).toMatchObject({ properties: { title: 'Review dashboard', status: 'draft' } });
  });

  it('leaves the complete CRLF Markdown body byte-identical when editing frontmatter properties', () => {
    const authoredBody = body.replace('{{title}}', 'Review dashboard').replaceAll('\n', '\r\n');
    const source = `\uFEFF---\r\n# Editable note properties\r\ntitle: Review dashboard\r\nstatus: draft\r\n---\r\n${authoredBody}`;
    const updated = documents.properties(encodeText(source), { status: 'review', tags: ['work', 'product/review'] });
    const parts = parseMarkdownParts(decode(updated));
    expect(encodeText(parts.body)).toEqual(encodeText(authoredBody));
    expect(parts.prefix).toBe('\uFEFF');
    expect(parts.yaml).toContain('# Editable note properties\r\n');
    expect(decode(updated)).not.toMatch(/(?<!\r)\n/);
    expect(documents.inspect('Dashboard.md', updated)).toMatchObject({ properties: { status: 'review', tags: ['work', 'product/review'] } });
  });

  it('keeps generated scalar, list and internal-link properties editable without changing inline Base YAML', () => {
    const source = `---\n# Keep property notes\ntitle: {{title}}\naliases: {{aliases}}\ntags: {{tags}}\nrelated: {{related}}\ndue: {{due}}\ncomplete: {{complete}}\npriority: {{priority}}\n---\n${body}`;
    const values = { aliases: ['Review board'], tags: ['work'], related: ['[[Plan]]', '[[Research#Findings]]'], due: '2026-10-08', complete: false, priority: 0 };
    const generated = templates.render(encodeText(source), { title: 'Review dashboard', values });
    expect(documents.inspect('Dashboard.md', generated)).toMatchObject({ properties: { title: 'Review dashboard', ...values } });
    const edited = documents.properties(generated, { due: '2026-10-09', complete: true, priority: 2 });
    expect(documents.inspect('Dashboard.md', edited)).toMatchObject({ properties: { ...values, title: 'Review dashboard', due: '2026-10-09', complete: true, priority: 2 } });
    expect(parseMarkdownParts(decode(edited)).yaml).toContain('# Keep property notes');
    expect(encodeText(parseMarkdownParts(decode(edited)).body)).toEqual(encodeText(parseMarkdownParts(decode(generated)).body));
  });
});
