import { ensure } from './errors.ts';
import type { UiDefinition, UiNode, UiValue } from './ui.ts';
import type { InteractionDefinition } from './interaction.ts';
import { validateUiInteractions } from './ui-interactions.ts';
import { uiBindings, uiWholeBinding, uiBindingSource, validateUiBindings } from './ui-syntax.ts';

function checkValue(value: UiValue, type: string, label: string) {
  ensure(typeof value === type, 'INVALID_UI', `${label} must be ${type}.`);
}

/** Validate the complete graph before rendering or accepting imported definitions. */
export function validateUiLibrary(definitions: readonly UiDefinition[], interactions: readonly InteractionDefinition[] = []): void {
  const byId = new Map<string, UiDefinition>();
  for (const definition of definitions) {
    ensure(!byId.has(definition.id), 'DUPLICATE_UI_COMPONENT', `Duplicate component ${definition.id}.`);
    byId.set(definition.id, definition);
  }
  const edges = new Map<string, Set<string>>();
  for (const definition of definitions) {
    const references = new Set<string>(); edges.set(definition.id, references);
    let slots = 0;
    const checkBinding = (value: UiValue) => validateUiBindings(definition, value);
    const walk = (node: UiNode): void => {
      if ('slot' in node) {
        slots++;
        ensure(slots <= 1, 'INVALID_UI', `${definition.id} may project its default child slot only once.`);
        return;
      }
      if ('tag' in node) {
        if (node.text !== undefined) checkBinding(node.text);
        for (const value of Object.values(node.attrs ?? {})) checkBinding(value);
      } else {
        const target = byId.get(node.component);
        ensure(target, 'UNKNOWN_UI_COMPONENT', `${definition.id} references missing component ${node.component}.`);
        references.add(node.component);
        for (const [name, value] of Object.entries(node.props ?? {})) {
          const targetProp = target.props[name];
          ensure(targetProp, 'INVALID_UI', `${definition.id} supplies unknown prop ${node.component}.${name}.`);
          checkBinding(value);
          const binding = uiWholeBinding(value);
          if (binding) {
            const source = uiBindingSource(definition, binding)!;
            ensure(source.type === targetProp.type, 'INVALID_UI', `Prop binding type differs for ${node.component}.${name}.`);
            ensure(!targetProp.required || targetProp.default !== undefined || ('required' in source && source.required) || source.default !== undefined, 'INVALID_UI', `Optional prop ${definition.id}.${binding} cannot satisfy required ${node.component}.${name}.`);
          }
          else if (!uiBindings(value).length) checkValue(value, targetProp.type, `${node.component}.${name}`);
          else ensure(targetProp.type === 'string', 'INVALID_UI', `Interpolated ${node.component}.${name} must be a string.`);
        }
        for (const [name, prop] of Object.entries(target.props)) ensure(!prop.required || prop.default !== undefined || Object.hasOwn(node.props ?? {}, name), 'INVALID_UI', `${definition.id} must supply required prop ${node.component}.${name}.`);
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(definition.root);
    for (const args of [definition.storybook?.args, ...(definition.storybook?.stories ?? []).map(story => story.args)]) {
      for (const [name, value] of Object.entries(args ?? {})) {
        ensure(Object.hasOwn(definition.props, name), 'INVALID_UI', `${definition.id} story has unknown prop ${name}.`);
        checkValue(value, definition.props[name]!.type, `${definition.id} story prop ${name}`);
      }
    }
  }
  const visited = new Set<string>(), active = new Set<string>();
  const visit = (id: string) => {
    ensure(!active.has(id), 'CYCLIC_UI_COMPONENT', `Cyclic component reference involving ${id}.`);
    if (visited.has(id)) return;
    active.add(id);
    for (const child of edges.get(id) ?? []) visit(child);
    active.delete(id); visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
  validateUiInteractions(definitions, interactions);
}

/** Direct references include references nested in a component's projected children. */
export function componentDependencies(root: UiNode): string[] {
  const dependencies = new Set<string>();
  const visit = (node: UiNode): void => {
    if ('component' in node) dependencies.add(node.component);
    if ('children' in node) for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return [...dependencies].sort();
}

/** Select the transitive reference closure, retaining the library's stable order. */
export function selectUiComponents(definitions: readonly UiDefinition[], id: string): UiDefinition[] {
  const byId = new Map(definitions.map(definition => [definition.id, definition]));
  const selected = new Set<string>();
  const select = (component: string): void => {
    if (selected.has(component)) return;
    const definition = byId.get(component);
    ensure(definition, 'UNKNOWN_UI_COMPONENT', `Missing component ${component}.`);
    selected.add(component);
    for (const dependency of componentDependencies(definition.root)) select(dependency);
  };
  select(id);
  return definitions.filter(definition => selected.has(definition.id));
}
