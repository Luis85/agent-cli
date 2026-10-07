import { expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { generators } from '../src/infrastructure/generators.ts';
import { NodeFiles } from '../src/infrastructure/files.ts';
import { loadEnabledPlugins } from '../src/infrastructure/plugins.ts';
import { ObsidianDocuments } from '../src/infrastructure/documents.ts';
import { Registry, validatePluginManifest } from '../src/application/plugins.ts';
import { EventBus } from '../src/application/events.ts';
import { Workspace } from '../src/application/workspace.ts';

it('all built-in TypeScript scaffolds compile under strict settings without runtime dependencies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-generators-'));
  try {
    const roots: string[] = [];
    for (const [index, generator] of generators.entries()) {
      for (const name of [`Example${index}`, 'Error', 'Object', 'Promise']) {
        const plan = await generator.generate(name, 'domain');
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

it('generates an installable plugin with a validated manifest and runnable lifecycle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-plugin-generator-'));
  try {
    const files = await NodeFiles.at(root);
    const generator = generators.find(generator => generator.id === 'plugin')!;
    const plan = await generator.generate('HTTPTools', '.agent-cli/plugins');
    expect(plan.map(file => file.path)).toEqual([
      '.agent-cli/plugins/http-tools/manifest.json', '.agent-cli/plugins/http-tools/main.mjs',
    ]);
    const manifest = JSON.parse(new TextDecoder().decode(plan[0]!.bytes));
    expect(() => validatePluginManifest(manifest)).not.toThrow();
    expect(manifest).toMatchObject({ id: 'http-tools', name: 'HTTPTools', version: '0.1.0', minAppVersion: '0.1.0' });
    await files.writeBatch(plan, false);
    const registry = new Registry();
    const events = new EventBus();
    const context = { workspace: new Workspace(files, new ObsidianDocuments(), events, false), events, root, input: async () => new Uint8Array() };
    await loadEnabledPlugins('.agent-cli/plugins', ['http-tools'], files, registry, events);
    const command = registry.commands.get('http-tools.hello')!;
    expect(command).toBeDefined();
    expect(await command.run([], {}, context)).toEqual({ plugin: 'http-tools', ready: false });
    await registry.activate(context);
    expect(await command.run([], {}, context)).toEqual({ plugin: 'http-tools', ready: true });
    await registry.dispose(events);
    expect(await command.run([], {}, context)).toEqual({ plugin: 'http-tools', ready: false });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('rejects unsafe names and output directories before returning a scaffold', async () => {
  for (const generator of generators) {
    await expect(async () => generator.generate("Bad';throw", 'src')).rejects.toMatchObject({ code: 'INVALID_NAME' });
    await expect(async () => generator.generate('Example', '../outside')).rejects.toMatchObject({ code: 'INVALID_PATH' });
  }
});

it('keeps native error and immutability behavior when component names shadow builtins', async () => {
  async function generatedModule(generatorId: string, name: string) {
    const generator = generators.find(generator => generator.id === generatorId)!;
    const [file] = await generator.generate(name, 'domain');
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
