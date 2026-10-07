import { uiFrameworks, type UiDefinition, type UiFramework } from '../domain/ui.ts';
import { componentDependencies } from '../domain/ui-library.ts';
import type { WriteRequest } from '../domain/file.ts';
import { vaultPath } from '../domain/file.ts';
import { ensure } from '../domain/errors.ts';
import { componentArtifact, defaults } from './ui-rendering.ts';
import { domModule, domDeclaration, staticMarkup } from './ui-dom-renderer.ts';
import { reactModule } from './ui-react-renderer.ts';
import { vueModule } from './ui-vue-renderer.ts';
import { svelteModule } from './ui-svelte-renderer.ts';
import { angularModule } from './ui-angular-renderer.ts';

export { componentArtifact } from './ui-rendering.ts';

const renderers: Record<UiFramework, (definition: UiDefinition, definitions: Map<string, UiDefinition>) => string> = {
  html: domModule, htmx: domModule, vanilla: domModule,
  react: reactModule, vue: vueModule, svelte: svelteModule, angular: angularModule,
};

/** Pure generation: callers validate definitions and commit the returned write plan. */
export function renderUiComponents(input: readonly UiDefinition[], framework: UiFramework, outputDirectory: string): WriteRequest[] {
  vaultPath(outputDirectory);
  ensure(uiFrameworks.includes(framework), 'INVALID_UI_FRAMEWORK', `Unknown UI framework: ${framework}`);
  const definitions = new Map(input.map(definition => [definition.id, definition]));
  ensure(definitions.size === input.length, 'INVALID_UI_LIBRARY', 'Duplicate UI component IDs.');
  const visited = new Set<string>();
  function visit(id: string, stack: string[]) {
    ensure(!stack.includes(id), 'INVALID_UI_LIBRARY', `Cyclic component reference: ${[...stack, id].join(' -> ')}`);
    if (visited.has(id)) return;
    const definition = definitions.get(id);
    ensure(definition, 'INVALID_UI_LIBRARY', `Unknown UI component: ${id}`);
    for (const child of componentDependencies(definition.root)) visit(child, [...stack, id]);
    visited.add(id);
  }
  for (const id of definitions.keys()) visit(id, []);
  const writes: WriteRequest[] = [];
  for (const definition of [...input].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const artifact = componentArtifact(definition, framework);
    const source = renderers[framework](definition, definitions);
    writes.push({ path: `${outputDirectory}/${artifact.fileName}`, bytes: new TextEncoder().encode(source) });
    if (['html', 'htmx', 'vanilla'].includes(framework)) {
      writes.push({ path: `${outputDirectory}/${definition.id}.html`, bytes: new TextEncoder().encode(staticMarkup(definition.root, defaults(definition), definitions) + '\n') });
      writes.push({ path: `${outputDirectory}/${definition.id}.d.ts`, bytes: new TextEncoder().encode(domDeclaration(definition)) });
    }
  }
  return writes.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
