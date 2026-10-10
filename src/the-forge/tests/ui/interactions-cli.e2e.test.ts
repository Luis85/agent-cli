import { committedEvents } from '../support/events.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
let root: string;
beforeEach(async () => { root = await mkdtemp(join(fixture.project, 'interactions-')); });
const cli = (args: string[]) => fixture.cli(args, undefined, { root });
async function seed() {
  await cp('docs/examples/interactions/definitions', join(root, 'interactions'), { recursive: true });
  await cp('docs/examples/interactions/components', join(root, 'components'), { recursive: true });
}

describe('portable interaction library and executable UI', () => {
  it('discovers, creates, inspects and transfers Markdown definitions without changing original bytes', async () => {
    expect(cli(['interactions']).body.data).toMatchObject({ status: 'empty', count: 0 });
    expect(cli(['interactions', 'init', '--dry-run']).status).toBe(0);
    expect(await readdir(root)).toEqual([]);
    expect(cli(['interactions', 'init']).status).toBe(0);
    const initialized = cli(['interactions', 'list']);
    expect(initialized.body.data.interactions.map((entry: { id: string }) => entry.id)).toEqual(['download', 'input-value', 'save', 'toggle-expanded', 'upload']);
    expect(cli(['interactions', 'create', 'capture-text', '--event', 'input']).status).toBe(0);
    const inspected = cli(['interactions', 'inspect', 'capture-text']);
    expect(inspected.body.data).toMatchObject({ id: 'capture-text', event: 'input', actions: [{ type: 'set-state', state: 'value', fromEvent: 'value' }] });
    expect(inspected.body.data.revision).toMatch(/^[a-f0-9]{64}$/);
    const original = await readFile(join(root, 'interactions/capture-text.md'), 'utf8');
    expect(cli(['interactions', 'export', '--out', 'exchange']).status).toBe(0);
    expect(cli(['interactions', 'import', '--from', 'exchange', '--library', 'reviewed']).status).toBe(0);
    expect(await readFile(join(root, 'reviewed/capture-text.md'), 'utf8')).toBe(original);
    expect(cli(['interactions', 'import', '--from', 'exchange', '--library', 'reviewed']).body.error.code).toBe('DUPLICATE_INTERACTION');
    expect(cli(['interactions', 'validate', '--library', 'reviewed']).body.data.valid).toBe(true);
    expect(cli(['interactions', 'init']).body.data.skipped).toContain('capture-text');
    expect(await readFile(join(root, 'interactions/capture-text.md'), 'utf8')).toBe(original);
  });

  it('creates executable form presets with inferred trigger events and explicit destinations', () => {
    for (const [id, event, action] of [
      ['save', 'submit', { type: 'save-form', key: 'forge-form' }],
      ['upload', 'submit', { type: 'upload-form', url: '{{uploadUrl}}' }],
      ['download', 'click', { type: 'download-form', filename: 'form-data.json' }],
    ] as const) {
      expect(cli(['interactions', 'create', id]).status).toBe(0);
      expect(cli(['interactions', 'inspect', id]).body.data).toMatchObject({ id, event, preventDefault: true, actions: [action] });
    }
    expect(cli(['interactions', 'validate']).body.data.valid).toBe(true);
  });

  it('generates all seven targets and runs the documented form through real emitted browser code', async () => {
    await seed();
    expect(cli(['components', 'validate']).status).toBe(0);
    for (const framework of ['html', 'htmx', 'vanilla', 'react', 'vue', 'svelte', 'angular']) {
      const result = cli(['make', 'ui', 'contact-request', '--framework', framework, '--out', `generated/${framework}`, '--stories', '--stories-out', `stories/${framework}`, '--dry-run']);
      expect(result.status, framework).toBe(0);
      expect(committedEvents(result.body.events)).toEqual([]);
      const sources = result.body.data.preview.map((file: { content: string }) => file.content).join('\n');
      expect(sources, framework).toContain('contact:requested');
      expect(sources, framework).toContain('Request prepared');
    }
    expect(cli(['make', 'ui', 'contact-request', '--framework', 'vanilla']).status).toBe(0);
    const source = await readFile(join(root, 'src/ui/contact-request.js'), 'utf8');
    const browser = new JSDOM('<main></main>');
    try {
      const exported: { default?: () => HTMLElement } = {};
      const executable = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      new Function('exports', 'document', 'CustomEvent', executable)(exported, browser.window.document, browser.window.CustomEvent);
      const form = exported.default!();
      browser.window.document.querySelector('main')!.append(form);
      const email = form.querySelector<HTMLInputElement>('input[type="email"]')!;
      const consent = form.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      let detail: unknown;
      form.addEventListener('contact:requested', event => { detail = (event as CustomEvent).detail; });
      email.value = 'reader@example.com'; email.dispatchEvent(new browser.window.Event('input', { bubbles: true }));
      consent.checked = true; consent.dispatchEvent(new browser.window.Event('change', { bubbles: true }));
      const submitted = new browser.window.Event('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(submitted);
      expect(submitted.defaultPrevented).toBe(true);
      expect(form.querySelector('[role="status"]')?.textContent).toBe('Request prepared');
      expect(detail).toEqual({ email: 'reader@example.com', consent: true, status: 'Request prepared' });
      expect(form.querySelector('input[type="email"]')).toBe(email);
    } finally { browser.window.close(); }
  });

  it('detects changed interaction behavior and regenerates only reviewed output revisions', async () => {
    await seed();
    const args = ['make', 'ui', 'contact-request', '--framework', 'react'];
    expect(cli(args).status).toBe(0);
    expect(cli([...args, '--check']).status).toBe(0);
    const path = join(root, 'interactions/prepare-request.md');
    await writeFile(path, (await readFile(path, 'utf8')).replace('value: Request prepared', 'value: Ready now'));
    const drift = cli([...args, '--check']);
    expect(drift.status).toBe(5); expect(drift.body.error.code).toBe('UI_DRIFT');
    expect(committedEvents(drift.body.events)).toEqual([]);
    expect(cli([...args, '--plan-out', 'review.json']).status).toBe(0);
    expect(cli([...args, '--revisions-from', 'review.json']).status).toBe(0);
    expect(cli([...args, '--check']).status).toBe(0);
    expect(await readFile(join(root, 'src/ui/contact-request.tsx'), 'utf8')).toContain('Ready now');
  });

  it('honors configured and overridden shared paths while generated output follows the project', async () => {
    await mkdir(join(root, 'bin'));
    await writeFile(join(root, 'bin/config.json'), JSON.stringify({ paths: { projects: 'apps' }, plugins: { settings: { ui: { interactions: 'shared/actions', interactionImports: 'incoming', interactionExports: 'outgoing' } } } }));
    await cp('docs/examples/interactions/definitions', join(root, 'incoming'), { recursive: true });
    expect(cli(['interactions', 'import']).status).toBe(0);
    await cp('docs/examples/interactions/components', join(root, 'components'), { recursive: true });
    expect(cli(['project', 'create', 'portal']).status).toBe(0);
    expect(cli(['project', 'open', 'portal']).status).toBe(0);
    expect(cli(['interactions', 'list']).body.context.project).toBeNull();
    expect(cli(['interactions', 'export']).status).toBe(0);
    expect(cli(['interactions', 'import', '--from', 'outgoing', '--library', 'reviewed']).status).toBe(0);
    expect(cli(['components', 'validate', '--interactions-library', 'reviewed']).status).toBe(0);
    const generated = cli(['make', 'ui', 'contact-request', '--framework', 'vue', '--interactions-library', 'reviewed']);
    expect(generated.status).toBe(0);
    expect(generated.body.context.project.name).toBe('portal');
    expect(await readFile(join(root, 'apps/portal/src/ui/contact-request.vue'), 'utf8')).toContain('contact:requested');
    expect(await readFile(join(root, 'outgoing/prepare-request.md'), 'utf8')).toContain('prepare-request');
  });

  it('rejects unresolved behavior and inapplicable options before creating output', async () => {
    await cp('docs/examples/interactions/components', join(root, 'components'), { recursive: true });
    expect(cli(['make', 'ui', 'contact-request', '--framework', 'html']).body.error.code).toBe('UNKNOWN_INTERACTION');
    for (const args of [
      ['interactions', 'list', '--event', 'click'],
      ['interactions', 'create', 'bad', '--event', 'load'],
      ['interactions', 'export', '--out', '../escape'],
      ['make', 'entity', 'Example', '--interactions-library', 'actions'],
      ['make', 'data-source', 'example', '--interactions-library', 'actions'],
    ]) {
      const result = cli(args);
      expect(result.status, args.join(' ')).not.toBe(0);
      expect(committedEvents(result.body.events)).toEqual([]);
    }
    expect(await readdir(root)).toEqual(['components']);
  });
});
