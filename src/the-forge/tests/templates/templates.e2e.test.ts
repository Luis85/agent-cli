import { committedEvents } from '../support/events.ts';
import { beforeAll, expect, it } from 'vitest';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;
let project: string;
beforeAll(() => { project = fixture.project; });

it('uses the same Markdown-only contract when inspecting and rendering templates', async () => {
    await mkdir(join(project, 'bin/templates'), { recursive: true });
    await writeFile(join(project, 'bin/templates/example.txt'), '# {{title}}\n');
    await writeFile(join(project, 'bin/templates/example.MD'), '# {{title}}\n');
    for (const template of ['example.txt', 'missing.txt']) {
      for (const args of [['templates', 'inspect', template], ['make', 'document', 'Example', '--template', template]]) {
        const result = cli(args);
        expect(result.status).toBe(2);
        expect(result.body.error.code).toBe('INVALID_TEMPLATE');
        expect(committedEvents(result.body.events)).toEqual([]);
      }
    }
    expect(cli(['templates', 'inspect', 'example.MD']).body.data.variables).toEqual(['title']);
    expect(cli(['make', 'document', 'Example', '--template', 'example.MD', '--dry-run']).status).toBe(0);
  });

it('renders discovered Obsidian templates using typed values, configured paths and guarded creation', async () => {
    await mkdir(join(project, 'bin/templates'), { recursive: true });
    const template = '---\ntitle: {{title}}\ncreated: {{date}}\ntags: {{tags}}\nsummary: "{{summary}}"\n---\n# {{title}}\n\n[[Architecture]]\n> [!tip]\n> {{summary}}\n';
    await writeFile(join(project, 'bin/templates/entity.md'), template);
    const config = join(project, 'bin/config.json');
    await writeFile(config, JSON.stringify({ templates: { dateFormat: 'YYYY/MM/DD' } }));
    const args: string[] = [];
    expect(cli([...args, 'templates', 'list']).body.data.templates).toContain('entity.md');
    expect(cli([...args, 'templates', 'inspect', 'entity.md']).body.data.variables).toEqual(['date', 'summary', 'tags', 'title']);
    const values = { tags: ['entity', 'domain'], summary: 'Quoted: value\nextra: true' };
    await writeFile(join(project, 'template-values.json'), JSON.stringify(values));
    const make = [...args, 'make', 'document', 'Work Item', '--template', 'entity.md', '--out', 'documents', '--values-from', 'template-values.json', '--date', '2026-10-07T14:05:00Z'];
    const preview = cli([...make, '--dry-run']);
    expect(preview.status).toBe(0); expect(committedEvents(preview.body.events)).toEqual([]);
    expect(preview.body.data.preview[0].path).toBe('documents/Work Item.md');
    await expect(readFile(join(project, 'documents/Work Item.md'))).rejects.toThrow();
    expect(cli(make).status).toBe(0);
    const read = cli(['read', 'documents/Work Item.md', '--parts', 'body']).body.data.document;
    expect(read.properties).toEqual({ title: 'Work Item', created: '2026/10/07', tags: values.tags, summary: values.summary });
    expect(read.body).toContain('[[Architecture]]\n> [!tip]');
    expect(cli(make).body.error.code).toBe('CONFLICT');
    expect(cli([...args, 'make', 'document', 'Missing', '--template', 'entity.md']).body.error.code).toBe('UNKNOWN_TEMPLATE_VARIABLE');
    expect(cli([...make, '--values', '{}']).body.error.code).toBe('INVALID_INPUT');
    expect(cli([...args, 'make', 'document', '../Escape', '--template', 'entity.md']).body.error.code).toBe('INVALID_NAME');
    expect(cli([...args, 'templates', 'inspect', '../template-values.json']).status).not.toBe(0);
    await rm(config);
  });
