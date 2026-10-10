import { committedEvents } from '../support/events.ts';
import { beforeAll, describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
const fixture = portableCli();
const cli = fixture.cli;
let project: string, bundle: string;
beforeAll(() => { project = fixture.project; bundle = fixture.bundle; });
describe('portable selected-project workflows', () => {
  it('persists project selection across processes and working directories while isolating sibling files', async () => {
    const root = join(project, 'selected-workspace');
    await mkdir(root);
    expect(cli(['setup'], undefined, { root }).status).toBe(0);
    const invocation = { entry: join(root, 'bin/forge.js'), root: null, cwd: bundle };
    const run = (args: string[]) => cli(args, undefined, invocation);
    expect(run(['project', 'current']).body.data.project).toBeNull();
    for (const name of ['alpha', 'beta']) expect(run(['project', 'create', name]).status).toBe(0);
    const opened = run(['project', 'open', 'alpha']);
    expect(opened.status).toBe(0);
    expect(opened.body.data.project.name).toBe('alpha');
    expect(opened.body.context).toEqual({ workspaceRoot: root, root, project: null });
    const selected = { schemaVersion: 1, name: 'alpha', type: 'library', directory: 'projects/alpha' };
    expect(run(['project', 'current']).body.data.project).toEqual(selected);
    expect(run(['project', 'inspect']).body.data).toEqual(selected);
    const otherCwd = { ...invocation, cwd: join(root, 'projects/beta') };
    const created = cli(['create', 'notes/plan.md', '--content', '# Alpha'], undefined, otherCwd);
    expect(created.status).toBe(0);
    expect(created.body.context).toEqual({ workspaceRoot: root, root: join(root, 'projects/alpha'), project: selected });
    expect(await readFile(join(root, 'projects/alpha/notes/plan.md'), 'utf8')).toBe('# Alpha');
    await expect(readFile(join(root, 'notes/plan.md'))).rejects.toThrow();
    expect(run(['list', '--kind', 'markdown']).body.data.files).toContainEqual({ path: 'notes/plan.md', kind: 'markdown' });
    const before = run(['read', 'notes/plan.md']).body.data;
    expect(run(['write', 'notes/plan.md', '--content', '# Updated alpha', '--if-match', before.revision]).status).toBe(0);
    expect(run(['create', 'notes/copy.md', '--from', 'notes/plan.md']).status).toBe(0);
    expect(run(['project', 'component', 'WorkItem']).status).toBe(0);
    expect(await readFile(join(root, 'projects/alpha/src/domain/work-item.ts'), 'utf8')).toContain('class WorkItem');
    expect(run(['project', 'open', 'beta']).status).toBe(0);
    expect(run(['read', 'notes/plan.md']).body.error.code).toBe('NOT_FOUND');
    expect(run(['read', '../alpha/notes/plan.md']).body.error.code).toBe('INVALID_PATH');
    expect(run(['create', 'notes/copy.md', '--from', '../alpha/notes/plan.md']).status).not.toBe(0);
    expect(run(['create', 'notes/plan.md', '--content', '# Beta']).status).toBe(0);
    expect(await readFile(join(root, 'projects/alpha/notes/plan.md'), 'utf8')).toBe('# Updated alpha');
    expect(run(['project', 'close']).status).toBe(0);
    expect(run(['project', 'current']).body.data.project).toBeNull();
    const workspaceWrite = run(['create', 'workspace.md', '--content', '# Workspace']);
    expect(workspaceWrite.body.context).toEqual({ workspaceRoot: root, root, project: null });
    expect(await readFile(join(root, 'workspace.md'), 'utf8')).toBe('# Workspace');
  }, 60_000);

  it('uses workspace templates and selected-project values and generation destinations', async () => {
    const root = join(project, 'selected-template-workspace');
    await mkdir(root);
    const invocation = { root };
    const run = (args: string[]) => cli(args, undefined, invocation);
    expect(run(['project', 'create', 'library']).status).toBe(0);
    expect(run(['project', 'open', 'library']).status).toBe(0);
    await mkdir(join(root, 'bin/templates'), { recursive: true });
    await writeFile(join(root, 'bin/templates/shared.md'), '---\ntitle: {{title}}\nowner: {{owner}}\n---\n# {{title}}\n');
    await writeFile(join(root, 'projects/library/inputs.json'), '{"owner":"Selected project"}');
    expect(run(['templates', 'list']).body.data.templates).toEqual(['shared.md']);
    const inspection = run(['templates', 'inspect', 'shared.md']);
    expect(inspection.body.context).toEqual({ workspaceRoot: root, root, project: null });
    expect(inspection.body.data.variables).toEqual(['owner', 'title']);
    const args = ['make', 'document', 'Plan', '--template', 'shared.md', '--values-from', 'inputs.json', '--out', 'docs'];
    const preview = run([...args, '--dry-run']);
    expect(preview.status).toBe(0);
    expect(preview.body.data.preview[0].path).toBe('docs/Plan.md');
    expect(committedEvents(preview.body.events)).toEqual([]);
    await expect(readFile(join(root, 'projects/library/docs/Plan.md'))).rejects.toThrow();
    expect(run(args).status).toBe(0);
    expect(run(['read', 'docs/Plan.md']).body.data.document.properties.owner).toBe('Selected project');
    expect(run(['make', 'entity', 'GeneratedItem', '--out', 'src/domain']).status).toBe(0);
    expect(await readFile(join(root, 'projects/library/src/domain/generated-item.ts'), 'utf8')).toContain('class GeneratedItem');
    expect(run(['make', 'plugin', 'SharedTools']).status).toBe(0);
    expect(await readFile(join(root, 'bin/plugins/shared-tools/manifest.json'), 'utf8')).toContain('shared-tools');
    expect(run(['make', 'plugin', 'OtherTools', '--out', 'elsewhere']).body.error.code).toBe('UNKNOWN_OPTION');
    await expect(readFile(join(root, 'projects/library/bin/plugins/shared-tools/manifest.json'))).rejects.toThrow();
    expect(run(['skills', 'install']).status).toBe(0);
    expect(await readFile(join(root, 'projects/library/.agents/skills/forge-workflow/SKILL.md'), 'utf8')).toContain('CONFLICT');
    await expect(readFile(join(root, '.agents/skills/forge-workflow/SKILL.md'))).rejects.toThrow();
    await expect(readFile(join(root, 'docs/Plan.md'))).rejects.toThrow();
    await expect(readFile(join(root, 'src/domain/generated-item.ts'))).rejects.toThrow();
  }, 60_000);

  it('previews selection changes without persisting or changing the execution scope', async () => {
    const root = join(project, 'selection-preview-workspace');
    await mkdir(root);
    const run = (args: string[]) => cli(args, undefined, { root });
    for (const name of ['alpha', 'beta']) expect(run(['project', 'create', name]).status).toBe(0);
    const initialPreview = run(['project', 'open', 'alpha', '--dry-run']);
    expect(initialPreview.status).toBe(0); expect(initialPreview.body.data.dryRun).toBe(true);
    expect(committedEvents(initialPreview.body.events)).toEqual([]);
    await expect(readFile(join(root, 'bin/data/context.json'))).rejects.toThrow();
    expect(run(['project', 'current']).body.data.project).toBeNull();
    expect(run(['project', 'open', 'alpha']).status).toBe(0);
    const contextBefore = await readFile(join(root, 'bin/data/context.json'));
    for (const args of [['project', 'open', 'beta', '--dry-run'], ['project', 'close', '--dry-run']]) {
      const preview = run(args);
      expect(preview.status).toBe(0); expect(preview.body.data.dryRun).toBe(true); expect(committedEvents(preview.body.events)).toEqual([]);
      expect(await readFile(join(root, 'bin/data/context.json'))).toEqual(contextBefore);
      expect(run(['project', 'current']).body.data.project.name).toBe('alpha');
    }
    expect(run(['create', 'still-alpha.md', '--content', '# Selected']).status).toBe(0);
    expect(await readFile(join(root, 'projects/alpha/still-alpha.md'), 'utf8')).toBe('# Selected');
  }, 60_000);

  it('blocks stale or malformed project selections and keeps discovery and recovery available', async () => {
    const root = join(project, 'selection-recovery-workspace');
    await mkdir(root);
    const run = (args: string[]) => cli(args, undefined, { root });
    for (const name of ['alpha', 'beta']) expect(run(['project', 'create', name]).status).toBe(0);
    expect(run(['project', 'open', 'alpha']).status).toBe(0);
    await rm(join(root, 'projects/alpha/.forge/project.json'));
    const stale = run(['create', 'blocked.md', '--content', '# Do not write']);
    expect(stale.body.error.code).toBe('STALE_PROJECT_CONTEXT');
    expect(committedEvents(stale.body.events)).toEqual([]);
    await expect(readFile(join(root, 'blocked.md'))).rejects.toThrow();
    await expect(readFile(join(root, 'projects/alpha/blocked.md'))).rejects.toThrow();
    expect(run(['schema']).status).toBe(0);
    expect(run(['make']).status).toBe(0);
    expect(run(['skills', 'list']).status).toBe(0);
    expect(run(['skills', 'show', 'forge-workflow']).status).toBe(0);
    expect(run(['project', 'open', 'beta']).status).toBe(0);
    expect(run(['project', 'current']).body.data.project.name).toBe('beta');
    await writeFile(join(root, 'bin/data/context.json'), '{broken');
    expect(run(['list']).body.error.code).toBe('INVALID_PROJECT_CONTEXT');
    expect(run(['config']).status).toBe(0);
    expect(run(['project', 'open', 'beta']).status).toBe(0);
    expect(run(['project', 'current']).body.data.project.name).toBe('beta');
    await writeFile(join(root, 'bin/data/context.json'), '{broken again');
    expect(run(['project', 'close']).status).toBe(0);
    expect(run(['project', 'current']).body.data.project).toBeNull();
    expect(run(['project', 'inspect']).body.error.code).toBe('PROJECT_REQUIRED');
    expect(run(['project', 'component', 'MissingSelection']).body.error.code).toBe('PROJECT_REQUIRED');
  }, 60_000);

  it('blocks redirected writes after changing the projects directory until explicitly reselected', async () => {
    const root = join(project, 'selection-directory-workspace');
    await mkdir(join(root, 'bin'), { recursive: true });
    const run = (args: string[]) => cli(args, undefined, { root });
    expect(run(['project', 'create', 'alpha']).status).toBe(0);
    expect(run(['project', 'open', 'alpha']).status).toBe(0);
    await writeFile(join(root, 'bin/config.json'), JSON.stringify({ paths: { projects: 'other' } }));
    expect(run(['project', 'create', 'alpha']).status).toBe(0);
    const blocked = run(['create', 'note.md', '--content', '# Selected project']);
    expect(blocked.body.error.code).toBe('STALE_PROJECT_CONTEXT');
    expect(committedEvents(blocked.body.events)).toEqual([]);
    for (const directory of ['projects', 'other']) await expect(readFile(join(root, directory, 'alpha/note.md'))).rejects.toThrow();
    expect(run(['project', 'open', 'alpha']).status).toBe(0);
    const created = run(['create', 'note.md', '--content', '# Explicit selection']);
    expect(created.status).toBe(0);
    expect(created.body.context.root).toBe(join(root, 'other/alpha'));
    expect(await readFile(join(root, 'other/alpha/note.md'), 'utf8')).toBe('# Explicit selection');
  }, 60_000);

  it('loads shared workspace plugins with the selected project as their execution root', async () => {
    const root = join(project, 'selected-plugin-workspace');
    await mkdir(join(root, 'bin/plugins/context'), { recursive: true });
    const config = join(root, 'bin/config.json');
    await writeFile(config, JSON.stringify({ paths: { projects: 'src' }, plugins: { enabled: ['context'] } }));
    await writeFile(join(root, 'bin/plugins/context/manifest.json'), JSON.stringify({ id: 'context', name: 'Context', version: '1.0.0', minAppVersion: '0.1.0', description: 'Selected-root fixture', author: 'Tests' }));
    await writeFile(join(root, 'bin/plugins/context/main.mjs'), `export default {
      commands: [{ id: 'context.write', description: 'Write in the execution root', usage: 'context.write', async run(args, flags, ctx) {
        const result = await ctx.workspace.write([{ path: 'plugin.md', bytes: new TextEncoder().encode('# Plugin') }]);
        return { root: ctx.root, ...result };
      } }]
    };`);
    const run = (args: string[]) => cli(args, undefined, { root });
    expect(run(['project', 'create', 'library']).status).toBe(0);
    expect(run(['project', 'open', 'library']).status).toBe(0);
    const result = run(['context.write']);
    expect(result.status).toBe(0);
    expect(result.body.data.root).toBe(join(root, 'src/library'));
    expect(result.body.context.root).toBe(join(root, 'src/library'));
    expect(await readFile(join(root, 'src/library/plugin.md'), 'utf8')).toBe('# Plugin');
    await expect(readFile(join(root, 'plugin.md'))).rejects.toThrow();
  }, 60_000);

  it('keeps setup and project management rooted in the workspace while a project is selected', async () => {
    const root = join(project, 'selected-setup-workspace');
    await mkdir(root);
    const run = (args: string[]) => cli(args, undefined, { root });
    expect(run(['project', 'create', 'alpha']).status).toBe(0);
    expect(run(['project', 'open', 'alpha']).status).toBe(0);
    const before = await readFile(join(root, 'bin/data/context.json'));
    const setup = run(['setup']);
    expect(setup.status).toBe(0);
    expect(setup.body.context).toEqual({ workspaceRoot: root, root, project: null });
    expect(await readFile(join(root, 'bin/forge.js'), 'utf8')).toBeTruthy();
    expect(await readFile(join(root, 'bin/templates/entity.md'), 'utf8')).toContain('{{title}}');
    expect(await readFile(join(root, 'bin/data/context.json'))).toEqual(before);
    await expect(readFile(join(root, 'projects/alpha/bin/forge.js'))).rejects.toThrow();
    expect(run(['project', 'create', 'beta']).status).toBe(0);
    expect(await readFile(join(root, 'projects/beta/.forge/project.json'), 'utf8')).toContain('beta');
    expect(run(['project', 'current']).body.data.project.name).toBe('alpha');
  }, 60_000);

  it('activates file observers with workspace scope for management and selected scope for file edits', async () => {
    const root = join(project, 'observer-scope-workspace');
    await mkdir(join(root, 'bin/plugins/observer'), { recursive: true });
    await writeFile(join(root, 'bin/config.json'), JSON.stringify({ plugins: { enabled: ['observer'] } }));
    await writeFile(join(root, 'bin/plugins/observer/manifest.json'), JSON.stringify({ id: 'observer', name: 'Observer', version: '1.0.0', minAppVersion: '0.1.0', description: 'Lifecycle scope fixture', author: 'Tests' }));
    await writeFile(join(root, 'bin/plugins/observer/main.mjs'), `export default {
      onload(ctx) {
        for (const id of ['vault.create', 'vault.modify']) ctx.events.on(id, file => {
          ctx.events.warn(JSON.stringify({ id, root: ctx.root, path: file.path }));
        });
      }
    };`);
    const run = (args: string[]) => cli(args, undefined, { root });
    const observations = (result: ReturnType<typeof run>) => result.body.warnings.map((warning: string) => JSON.parse(warning));
    const created = run(['project', 'create', 'alpha']);
    expect(created.status).toBe(0);
    expect(observations(created)).toContainEqual({ id: 'vault.create', root, path: 'projects/alpha/.forge/project.json' });
    expect(run(['project', 'open', 'alpha']).status).toBe(0);
    const component = run(['project', 'component', 'ObservedItem']);
    expect(component.status).toBe(0);
    expect(observations(component)).toContainEqual({ id: 'vault.create', root, path: 'projects/alpha/src/domain/observed-item.ts' });
    const plugin = run(['make', 'plugin', 'ObservedTools']);
    expect(plugin.status).toBe(0);
    expect(observations(plugin)).toContainEqual({ id: 'vault.create', root, path: 'bin/plugins/observed-tools/manifest.json' });
    const note = run(['create', 'observed.md', '--content', '# Observed']);
    expect(note.status).toBe(0);
    expect(observations(note)).toContainEqual({ id: 'vault.create', root: join(root, 'projects/alpha'), path: 'observed.md' });
    const revision = run(['read', 'observed.md']).body.data.revision;
    const edit = run(['edit', 'observed.md', '--append', '--content', '\nUpdated', '--if-match', revision]);
    expect(edit.status).toBe(0);
    expect(observations(edit)).toContainEqual({ id: 'vault.modify', root: join(root, 'projects/alpha'), path: 'observed.md' });
    await writeFile(join(root, 'bin/data/context.json'), '{broken');
    const recovered = run(['project', 'close']);
    expect(recovered.status).toBe(0);
    expect(observations(recovered)).toContainEqual({ id: 'vault.modify', root, path: 'bin/data/context.json' });
  }, 60_000);

  it('makes guarded forms and unit tests inside the persisted project selection', async () => {
    const root = join(project, 'forms-workspace');
    await mkdir(root);
    const run = (args: string[]) => cli(args, undefined, { root });
    const unselected = run(['make', 'form', 'ContactDetails']);
    expect(unselected.body.error.code).toBe('PROJECT_REQUIRED');
    expect(committedEvents(unselected.body.events)).toEqual([]);
    expect(run(['project', 'create', 'library']).status).toBe(0);
    expect(run(['project', 'open', 'library']).status).toBe(0);
    const selectedRoot = join(root, 'projects/library');
    const preview = run(['make', 'form', 'ContactDetails', '--dry-run']);
    expect(preview.status).toBe(0);
    expect(preview.body.context.root).toBe(selectedRoot);
    expect(preview.body.data.preview.map((file: { path: string }) => file.path)).toEqual([
      'src/presentation/forms/contact-details.form.ts', 'tests/contact-details.form.unit.test.ts',
    ]);
    expect(committedEvents(preview.body.events)).toEqual([]);
    await expect(readFile(join(selectedRoot, 'src/presentation/forms/contact-details.form.ts'))).rejects.toThrow();
    await expect(readFile(join(selectedRoot, 'tests/contact-details.form.unit.test.ts'))).rejects.toThrow();
    const created = cli(['make', 'form', 'ContactDetails'], undefined, { root, cwd: bundle });
    expect(created.status).toBe(0);
    expect(created.body.context.root).toBe(selectedRoot);
    expect(committedEvents(created.body.events)).toHaveLength(2);
    expect(await readFile(join(selectedRoot, 'src/presentation/forms/contact-details.form.ts'), 'utf8')).toContain('ContactDetailsForm');
    expect(await readFile(join(selectedRoot, 'tests/contact-details.form.unit.test.ts'), 'utf8')).toContain('validates and normalizes form data');
    expect(run(['make', 'form', 'ContactDetails']).body.error.code).toBe('CONFLICT');
    for (const out of ['../outside', '/absolute', 'src/../outside']) {
      const rejected = run(['make', 'form', 'UnsafeForm', '--out', out]);
      expect(rejected.body.error.code).toBe('INVALID_PATH');
      expect(committedEvents(rejected.body.events)).toEqual([]);
    }
    const custom = run(['make', 'form', 'CustomContact', '--out', 'src/presentation/custom-forms']);
    expect(custom.status).toBe(0);
    expect(await readFile(join(selectedRoot, 'src/presentation/custom-forms/custom-contact.form.ts'), 'utf8')).toContain('../forms/form-model.js');
    expect(await readFile(join(selectedRoot, 'tests/custom-contact.form.unit.test.ts'), 'utf8')).toContain('custom-forms/custom-contact.form.js');
    await expect(readFile(join(root, 'src/presentation/forms/contact-details.form.ts'))).rejects.toThrow();
  }, 60_000);
});
