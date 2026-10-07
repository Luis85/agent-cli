import { describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;
const definition = (id: string) => `---\nschemaVersion: 1\nid: ${id}\nprops:\n  label:\n    type: string\n    default: Hello\nroot:\n  tag: button\n  attrs:\n    type: button\n  text: '{{label}}'\n---\n# A documented component\n`;

describe('portable Markdown component library and deterministic UI generation', () => {
  it('discovers the library and generators and previews initialization without writing', async () => {
    expect(cli(['schema']).body.data.commands.map((command: { id: string }) => command.id)).toContain('components');
    expect(cli(['make']).body.data.generators.map((generator: { id: string }) => generator.id)).toEqual(expect.arrayContaining(['ui', 'stories']));
    const preview = cli(['components', 'init', '--dry-run']);
    expect(preview.status, preview.stdout).toBe(0);
    expect(preview.body.events).toEqual([]);
    expect(preview.body.data.components).toEqual(expect.arrayContaining(['page', 'layout', 'header', 'nav-bar']));
    await expect(readFile(join(fixture.project, 'components/page.md'))).rejects.toThrow();
    const initialized = cli(['components', 'init']);
    expect(initialized.status, initialized.stdout).toBe(0);
    expect(initialized.body.events.length).toBeGreaterThan(0);
    expect(cli(['components', 'init']).body.data.changes).toEqual([]);
    expect(cli(['components', 'validate']).status).toBe(0);
    expect(cli(['components', 'inspect', 'page']).body.data).toMatchObject({ id: 'page', revision: expect.stringMatching(/^[a-f0-9]{64}$/), bytes: expect.any(Number) });
    const summary = cli(['components', 'list']).body.data;
    expect(summary.count).toBeGreaterThanOrEqual(50);
    expect(summary.components.find((component: { id: string }) => component.id === 'page')).toMatchObject({ sourcePath: 'components/page.md', propNames: expect.any(Array), dependencies: expect.any(Array) });
    expect(summary.components.every((component: Record<string, unknown>) => !('root' in component))).toBe(true);
  });

  it('accepts user Markdown, exports exact bytes, and imports a configurable directory', async () => {
    await mkdir(join(fixture.project, 'incoming/nested'), { recursive: true });
    const source = definition('greeting');
    await writeFile(join(fixture.project, 'incoming/nested/greeting.md'), source);
    const imported = cli(['components', 'import', '--from', 'incoming', '--library', 'custom-library']);
    expect(imported.status, imported.stdout).toBe(0);
    expect(await readFile(join(fixture.project, 'custom-library/nested/greeting.md'), 'utf8')).toBe(source);
    const exported = cli(['components', 'export', '--library', 'custom-library', '--out', 'shared']);
    expect(exported.status, exported.stdout).toBe(0);
    expect(await readFile(join(fixture.project, 'shared/nested/greeting.md'), 'utf8')).toBe(source);
    expect(cli(['components', 'import', '--from', 'incoming', '--library', 'custom-library']).status).not.toBe(0);
    const created = cli(['components', 'create', 'custom-section', '--tag', 'section', '--library', 'custom-library']);
    expect(created.status, created.stdout).toBe(0);
    expect(cli(['components', 'inspect', 'custom-section', '--library', 'custom-library']).body.data.root.tag).toBe('section');
  });

  it.each(['html', 'htmx', 'vanilla', 'vue', 'svelte', 'react', 'angular'])('generates repeatable %s code and Storybook stories with configurable outputs', async framework => {
    const args = ['make', 'ui', 'greeting', '--library', 'custom-library', '--framework', framework, '--out', `generated/${framework}`, '--stories', '--stories-out', `catalog/${framework}`];
    const first = cli([...args, '--dry-run']), second = cli([...args, '--dry-run']);
    expect(first.status, first.stdout).toBe(0);
    expect(first.body.data).toEqual(second.body.data);
    expect(first.body.events).toEqual([]);
    const paths: string[] = first.body.data.changes.map((change: { path: string }) => change.path);
    expect(paths.some(path => path.startsWith(`generated/${framework}/`))).toBe(true);
    expect(paths.some(path => path.startsWith(`catalog/${framework}/`) && path.includes('.stories.'))).toBe(true);
    await expect(readFile(join(fixture.project, paths[0]!))).rejects.toThrow();
    const generated = cli(args);
    expect(generated.status, generated.stdout).toBe(0);
    expect(generated.body.events).toHaveLength(paths.length);
    expect(cli(args).body.error.code).toBe('CONFLICT');
  });

  it('generates stories separately without overwriting existing component code', () => {
    const args = ['make', 'stories', 'greeting', '--library', 'custom-library', '--framework', 'react', '--out', 'generated/react', '--stories-out', 'additional-stories'];
    const preview = cli([...args, '--dry-run']);
    expect(preview.status, preview.stdout).toBe(0);
    expect(preview.body.data.changes.every((change: { path: string }) => change.path.startsWith('additional-stories/'))).toBe(true);
    expect(cli(args).status).toBe(0);
    const missing = cli(['make', 'stories', 'greeting', '--library', 'custom-library', '--framework', 'react', '--out', 'missing-ui', '--stories-out', 'missing-stories']);
    expect(missing.status, missing.stdout).not.toBe(0);
    expect(missing.body.events).toEqual([]);
  });

  it('regenerates reviewed outputs with revision guards and rejects stale or unrelated revisions', async () => {
    const args = ['make', 'ui', 'greeting', '--library', 'custom-library', '--framework', 'react', '--out', 'maintained-ui'];
    const generated = cli(args);
    expect(generated.status, generated.stdout).toBe(0);
    const revisions = Object.fromEntries(generated.body.data.changes.map((change: { path: string; revision: string }) => [change.path, change.revision]));
    await writeFile(join(fixture.project, 'reviewed-revisions.json'), JSON.stringify(revisions));
    const read = cli(['read', 'custom-library/nested/greeting.md']).body.data;
    expect(cli(['edit', 'custom-library/nested/greeting.md', '--if-match', read.revision, '--find', 'Hello', '--replace', 'Updated']).status).toBe(0);
    const guarded = [...args, '--revisions-from', 'reviewed-revisions.json'];
    const preview = cli([...guarded, '--dry-run']);
    expect(preview.status, preview.stdout).toBe(0);
    expect(preview.body.events).toEqual([]);
    const updated = cli(guarded);
    expect(updated.status, updated.stdout).toBe(0);
    expect(updated.body.events.every((event: { id: string }) => event.id === 'file.updated')).toBe(true);
    expect(await readFile(join(fixture.project, 'maintained-ui/greeting.tsx'), 'utf8')).toContain('Updated');
    const stale = cli(guarded);
    expect(stale.body.error.code).toBe('CONFLICT');
    expect(stale.body.events).toEqual([]);
    await writeFile(join(fixture.project, 'unrelated-revisions.json'), JSON.stringify({ 'unrelated.txt': 'a'.repeat(64) }));
    expect(cli([...args, '--revisions-from', 'unrelated-revisions.json']).status).not.toBe(0);
    await writeFile(join(fixture.project, 'invalid-revisions.json'), JSON.stringify({ 'maintained-ui/greeting.tsx': 'invalid' }));
    expect(cli([...args, '--revisions-from', 'invalid-revisions.json']).body.error.code).toBe('INVALID_INPUT');
  });

  it('plans and checks drift before authorizing regeneration through a captured manifest', async () => {
    const args = ['make', 'ui', 'greeting', '--library', 'custom-library', '--framework', 'react', '--out', 'review-ui'];
    const missing = cli([...args, '--plan']);
    expect(missing.status, missing.stdout).toBe(0);
    expect(missing.body.data.outputs).toEqual([expect.objectContaining({ path: 'review-ui/greeting.tsx', status: 'missing', content: expect.any(String) })]);
    expect(missing.body.events).toEqual([]);
    await expect(readFile(join(fixture.project, 'review-ui/greeting.tsx'))).rejects.toThrow();
    const drift = cli([...args, '--check']);
    expect(drift.status).toBe(5);
    expect(drift.body.error).toMatchObject({ code: 'UI_DRIFT', details: { outputs: [{ path: 'review-ui/greeting.tsx', status: 'missing' }] } });
    expect(cli(args).status).toBe(0);
    expect(cli([...args, '--check']).body.data.matches).toBe(true);
    await writeFile(join(fixture.project, 'review-ui/greeting.tsx'), '// User customization\n');
    const preview = cli([...args, '--plan-out', 'reviews/preview.json', '--dry-run']);
    expect(preview.status, preview.stdout).toBe(0);
    expect(preview.body.events).toEqual([]);
    await expect(readFile(join(fixture.project, 'reviews/preview.json'))).rejects.toThrow();
    const planned = cli([...args, '--plan-out', 'reviews/reviewed.json']);
    expect(planned.status, planned.stdout).toBe(0);
    expect(planned.body.data.outputs[0]).toMatchObject({ status: 'changed', currentContent: '// User customization\n' });
    expect(planned.body.events).toHaveLength(1);
    expect(await readFile(join(fixture.project, 'review-ui/greeting.tsx'), 'utf8')).toBe('// User customization\n');
    expect(JSON.parse(await readFile(join(fixture.project, 'reviews/reviewed.json'), 'utf8'))).toEqual(planned.body.data.revisions);
    expect(cli([...args, '--plan-out', 'reviews/reviewed.json']).body.error.code).toBe('CONFLICT');
    expect(cli([...args, '--revisions-from', 'reviews/reviewed.json']).status).toBe(0);
    expect(cli([...args, '--check']).body.data.matches).toBe(true);
    for (const options of [['--check', '--plan'], ['--check', '--plan-out', 'reviews/invalid.json'], ['--plan', '--revisions-from', 'reviews/reviewed.json']]) {
      const invalid = cli([...args, ...options]);
      expect(invalid.body.error.code).toBe('INVALID_ARGUMENT'); expect(invalid.body.events).toEqual([]);
    }
  });

  it('uses configured library, import, export, UI, story, and framework defaults', async () => {
    await mkdir(join(fixture.project, 'bin'), { recursive: true });
    await writeFile(join(fixture.project, 'bin/config.json'), JSON.stringify({
      paths: { components: 'configured-library', componentImports: 'incoming', componentExports: 'configured-export', ui: 'configured-ui', stories: 'configured-stories' },
      ui: { framework: 'vue' },
    }));
    expect(cli(['components', 'import']).status).toBe(0);
    expect(cli(['components', 'export']).status).toBe(0);
    const generated = cli(['make', 'ui', 'greeting', '--stories']);
    expect(generated.status, generated.stdout).toBe(0);
    expect(generated.body.data.framework).toBe('vue');
    expect(generated.body.data.changes.some((change: { path: string }) => change.path.startsWith('configured-ui/'))).toBe(true);
    expect(generated.body.data.changes.some((change: { path: string }) => change.path.startsWith('configured-stories/'))).toBe(true);
    expect(await readFile(join(fixture.project, 'configured-export/nested/greeting.md'), 'utf8')).toBe(definition('greeting'));
  });

  it('shares the workspace library and explicitly scopes generation to selected projects', async () => {
    expect(cli(['project', 'create', 'website']).status).toBe(0);
    expect(cli(['project', 'create', 'admin']).status).toBe(0);
    expect(cli(['project', 'open', 'website']).status).toBe(0);
    expect(cli(['components', 'list']).body.context.project).toBeNull();
    const current = cli(['make', 'ui', 'greeting', '--out', 'widgets']);
    expect(current.status, current.stdout).toBe(0);
    expect(current.body.context.project.name).toBe('website');
    expect(current.body.data.changes.every((change: { path: string }) => change.path.startsWith('projects/website/widgets/'))).toBe(true);
    const selected = cli(['make', 'ui', 'greeting', '--project', 'admin', '--stories']);
    expect(selected.status, selected.stdout).toBe(0);
    expect(selected.body.context.project.name).toBe('admin');
    expect(selected.body.data.changes.every((change: { path: string }) => change.path.startsWith('projects/admin/'))).toBe(true);
    const projectPlan = cli(['make', 'ui', 'greeting', '--project', 'admin', '--stories', '--plan-out', 'reviews/ui.json']);
    expect(projectPlan.status, projectPlan.stdout).toBe(0);
    expect(projectPlan.body.data.manifest.path).toBe('projects/admin/reviews/ui.json');
    expect(Object.keys(projectPlan.body.data.revisions).every(path => path.startsWith('projects/admin/'))).toBe(true);
    expect(JSON.parse(await readFile(join(fixture.project, 'projects/admin/reviews/ui.json'), 'utf8'))).toEqual(projectPlan.body.data.revisions);
    expect(cli(['project', 'current']).body.data.project.name).toBe('website');
    expect(cli(['make', 'ui', 'greeting', '--project', 'missing']).body.error.code).toBe('PROJECT_NOT_FOUND');
    expect(cli(['project', 'close']).status).toBe(0);
  });

  it('rejects escaping destinations and options belonging to another operation without events', () => {
    for (const args of [
      ['components', 'init', '--library', '../outside'],
      ['components', 'list', '--out', 'ignored'],
      ['make', 'ui', 'greeting', '--out', '../outside'],
      ['make', 'ui', 'greeting', '--framework', 'unknown'],
      ['make', 'ui', 'greeting', '--stories-out', 'ignored'],
      ['make', 'ui', 'greeting', '--template', 'ignored'],
      ['make', 'entity', 'Thing', '--framework', 'react'],
      ['make', '--library', 'ignored'],
    ]) {
      const result = cli(args);
      expect(result.status, result.stdout).not.toBe(0);
      expect(result.body.events).toEqual([]);
    }
  });
});
