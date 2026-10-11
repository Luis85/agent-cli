import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { expect, it } from 'vitest';
import { scopeServices } from '../support/metadata.ts';
import { generatePlan } from '../support/generators.ts';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { scaffoldGenerators as generators } from '../../src/plugins/scaffolds/infrastructure/generators.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { loadEnabledPlugins } from '../../src/infrastructure/plugins/loader.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { Registry, validatePluginManifest } from '../../src/application/plugins/registry.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { skillFrontmatter } from '../../src/infrastructure/plugins/skill-frontmatter.ts';

it('standalone entity, value-object, use-case and event scaffolds compile without runtime dependencies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-generators-'));
  try {
    const roots: string[] = [];
    for (const [index, generator] of generators.filter(generator => ['entity', 'value-object', 'use-case', 'event'].includes(generator.id)).entries()) {
      for (const name of [`Example${index}`, 'Error', 'Object', 'Promise']) {
        const plan = await generatePlan(generator, name, 'domain');
        for (const file of plan.filter(file => file.path.endsWith('.ts'))) {
          const path = join(directory, `${generator.id}-${name}-${file.path.split('/').at(-1)!}`);
          roots.push(path); await writeFile(path, file.bytes);
        }
      }
    }
    const program = ts.createProgram(roots, { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, types: [], skipLibCheck: true });
    expect(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('generates form source and tests with valid imports for custom paths containing quotes', async () => {
  const generator = generators.find(generator => generator.id === 'form')!;
  const directory = 'src/presentation/forms/team\'s "drafts"';
  const plan = await generatePlan(generator, 'ContactDetails', directory);
  expect(plan.map(file => file.path)).toEqual([
    `${directory}/contact-details.form.ts`, 'tests/contact-details.form.unit.test.ts',
  ]);
  const imports = plan.map(file => {
    const source = new TextDecoder().decode(file.bytes);
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
    expect(compiled.diagnostics).toEqual([]);
    return ts.createSourceFile(file.path, source, ts.ScriptTarget.Latest, true).statements
      .filter(ts.isImportDeclaration).map(declaration => (declaration.moduleSpecifier as ts.StringLiteral).text);
  });
  expect(imports[0]).toEqual(['zod', '../form-model.js']);
  expect(imports[1]).toEqual(['vitest', `../${directory}/contact-details.form.js`, '../src/presentation/forms/form-model.js']);
});

it('requires a selected project with the form runtime before generating a form', async () => {
  const form = generators.find(generator => generator.id === 'form')!;
  expect(form).toMatchObject({ directory: 'src/presentation/forms' });
  await expect(generatePlan(form, 'Contact', 'src/presentation/forms', { project: null })).rejects.toMatchObject({ code: 'PROJECT_REQUIRED' });
  expect(generators.find(generator => generator.id === 'plugin')).toMatchObject({ scope: 'workspace', directory: 'bin/plugins', fixedDirectory: true });
});

it('generates an installable plugin with a validated manifest and runnable lifecycle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-plugin-generator-'));
  try {
    const files = await NodeFiles.at(root);
    const generator = generators.find(generator => generator.id === 'plugin')!;
    const plan = await generatePlan(generator, 'HTTPTools', '.agent-cli/plugins');
    expect(plan.map(file => file.path)).toEqual([
      '.agent-cli/plugins/http-tools/manifest.json', '.agent-cli/plugins/http-tools/main.mjs',
    ]);
    const manifest = JSON.parse(new TextDecoder().decode(plan[0]!.bytes));
    expect(() => validatePluginManifest(manifest)).not.toThrow();
    expect(manifest).toMatchObject({ id: 'http-tools', name: 'HTTPTools', version: '0.1.0', minAppVersion: '0.1.0' });
    await files.writeBatch(plan, false);
    const registry = new Registry(skillFrontmatter);
    const events = new EventBus(new NodeEventScope());
    const workspace = new Workspace(files, new ObsidianDocuments(), events, false);
    const context = { workspace, events, root, workspaceRoot: root, project: null, ...scopeServices(workspace, events), input: async () => new Uint8Array() };
    await loadEnabledPlugins('.agent-cli/plugins', ['http-tools'], files, registry, events);
    const command = registry.commands.get('http-tools.hello')!;
    expect(command).toBeDefined();
    expect(await command.run([], {}, context)).toEqual({ plugin: 'http-tools', ready: false });
    await registry.activate(events, context);
    expect(await command.run([], {}, context)).toEqual({ plugin: 'http-tools', ready: true });
    await registry.dispose(events);
    expect(await command.run([], {}, context)).toEqual({ plugin: 'http-tools', ready: false });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('rejects unsafe names and output directories before returning a scaffold', async () => {
  for (const generator of generators) {
    await expect(async () => generatePlan(generator, "Bad';throw", 'src')).rejects.toMatchObject({ code: 'INVALID_NAME' });
    await expect(async () => generatePlan(generator, 'Example', '../outside')).rejects.toMatchObject({ code: 'INVALID_PATH' });
  }
});

it('keeps native error and immutability behavior when component names shadow builtins', async () => {
  async function generatedModule(generatorId: string, name: string) {
    const generator = generators.find(generator => generator.id === generatorId)!;
    const [file] = await generatePlan(generator, name, 'domain');
    const compiled = ts.transpileModule(new TextDecoder().decode(file!.bytes), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    return import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  }
  const entity = await generatedModule('entity', 'Error');
  expect(() => entity.Error.create('')).toThrow(Error);
  const value = await generatedModule('value-object', 'Object');
  expect(Object.isFrozen(value.Object.from('value'))).toBe(true);
  const useCase = await generatedModule('use-case', 'Promise');
  await expect(new useCase.Promise({ exists: async () => true }).execute({ id: 'item' })).resolves.toEqual({ exists: true });
});
