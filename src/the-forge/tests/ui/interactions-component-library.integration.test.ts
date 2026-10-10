import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { UiLibrary, type UiRenderer } from '../../src/plugins/ui/application/components/library.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { MarkdownUiDefinitions } from '../../src/plugins/ui/infrastructure/components/definitions.ts';
import type { UiDefinition } from '../../src/plugins/ui/domain/components/definition.ts';
import type { InteractionDefinition } from '../../src/plugins/ui/domain/interactions/definition.ts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const toggle: InteractionDefinition = { schemaVersion: 1, id: 'toggle', event: 'click', actions: [{ type: 'toggle-state', state: 'expanded' }], sourcePath: 'interactions/toggle.md', description: '# Toggle' };
const child: UiDefinition = { schemaVersion: 1, id: 'child', props: {}, state: { expanded: { type: 'boolean', default: false } }, root: { tag: 'button', interactions: ['toggle'] }, description: '# Child', sourcePath: 'components/child.md' };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'forge-interaction-graph-')); roots.push(root);
  const workspace = new Workspace(await NodeFiles.at(root), new ObsidianDocuments(), new EventBus(new NodeEventScope()), false);
  const codec = new MarkdownUiDefinitions(new ObsidianDocuments());
  const source = { list: vi.fn(async (_directory: string) => [toggle, { ...toggle, id: 'unused' }]) };
  const generate = vi.fn<UiRenderer['generate']>(() => [{ path: 'generated/parent.js', bytes: new TextEncoder().encode('// generated\n') }]);
  const library = new UiLibrary(workspace, codec, [], { generate }, source, 'shared/interactions');
  const add = async (definition: UiDefinition) => {
    await mkdir(join(root, definition.sourcePath, '..'), { recursive: true });
    await writeFile(join(root, definition.sourcePath), codec.serialize(definition));
  };
  return { root, library, source, generate, add };
}

it('resolves configurable interaction libraries and passes only selected component dependencies to rendering', async () => {
  const { library, source, generate, add } = await fixture();
  await add(child);
  await add({ ...child, id: 'parent', state: undefined, sourcePath: 'components/parent.md', root: { component: 'child' } });
  expect(await library.list('components')).toHaveLength(2);
  expect(source.list).toHaveBeenLastCalledWith('shared/interactions');
  await library.plan('components', { framework: 'react', component: 'parent', outputDirectory: 'generated', interactionDirectory: 'custom/interactions' });
  expect(source.list).toHaveBeenLastCalledWith('custom/interactions');
  expect(generate.mock.calls[0]![0].map(definition => definition.id)).toEqual(['child', 'parent']);
  expect(generate.mock.calls[0]![1].interactions).toEqual([toggle]);
});

it('rejects missing interactions before generating or importing component files', async () => {
  const { root, library, source, generate, add } = await fixture();
  source.list.mockResolvedValue([]);
  await add({ ...child, sourcePath: 'imports/child.md' });
  await expect(library.import('imports', 'components')).rejects.toMatchObject({ code: 'UNKNOWN_INTERACTION' });
  await expect(access(join(root, 'components/child.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(library.plan('imports', { framework: 'react', outputDirectory: 'generated' })).rejects.toMatchObject({ code: 'UNKNOWN_INTERACTION' });
  expect(generate).not.toHaveBeenCalled();
});


it('rejects transfers into recursively discovered source directories before changing either library', async () => {
  const { root, library, add } = await fixture();
  await add(child);
  for (const output of ['components', 'components/exports']) {
    await expect(library.export('components', output)).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(library.import('components', output)).rejects.toMatchObject({ code: 'INVALID_PATH' });
  }
  expect(await library.list('components')).toHaveLength(1);
  await expect(access(join(root, 'components/exports'))).rejects.toMatchObject({ code: 'ENOENT' });
});
