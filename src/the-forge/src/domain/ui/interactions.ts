import { ensure } from '../shared/errors.ts';
import { interactionTriggerEvents, isSafeNavigationUrl, validateInteractionLibrary, type InteractionDefinition } from '../interactions/definition.ts';
import type { UiDefinition, UiElement, UiNode, UiValue } from './definition.ts';
import { uiBindings, uiWholeBinding, uiBindingSource, validateUiBindings } from './syntax.ts';

/** Values interpreted against a component's props and state when an action runs. */
export function interactionValues(interaction: InteractionDefinition): UiValue[] {
  return interaction.actions.flatMap(action => action.type === 'navigate' || action.type === 'upload-form' ? [action.url] : action.type === 'save-form' ? [action.key] : action.type === 'download-form' ? [action.filename] : action.type === 'emit' ? Object.values(action.detail ?? {}) : action.type === 'set-state' && 'value' in action ? [action.value] : []);
}

export function interactionUsesState(interaction: InteractionDefinition): boolean {
  return interaction.actions.some(action => action.type === 'set-state' || action.type === 'toggle-state') || interactionValues(interaction).some(value => uiBindings(value).some(name => name.startsWith('state.')));
}

function valueType(definition: UiDefinition, value: UiValue): string {
  validateUiBindings(definition, value);
  const binding = uiWholeBinding(value);
  if (!binding) return typeof value;
  const source = uiBindingSource(definition, binding)!;
  ensure(source.default !== undefined || ('required' in source && source.required), 'INVALID_UI', `${definition.id} interaction cannot read optional field ${binding} without a default.`);
  return source.type;
}

function validateAttachment(definition: UiDefinition, node: UiElement, interaction: InteractionDefinition): void {
  for (const action of interaction.actions) {
    if (action.type === 'set-state' || action.type === 'toggle-state') {
      const state = definition.state?.[action.state];
      ensure(state, 'INVALID_UI', `${definition.id} interaction ${interaction.id} requires state ${action.state}.`);
      if (action.type === 'toggle-state') ensure(state.type === 'boolean', 'INVALID_UI', `Interaction ${interaction.id} can toggle only boolean state ${action.state}.`);
      else if ('fromEvent' in action) {
        ensure(['input', 'change'].includes(interaction.event), 'INVALID_UI', `Interaction ${interaction.id} reads form values only from input/change events.`);
        ensure(action.fromEvent === 'checked' ? node.tag === 'input' : ['input', 'select', 'textarea'].includes(node.tag), 'INVALID_UI', `Interaction ${interaction.id} cannot read ${action.fromEvent} from ${node.tag}.`);
        ensure(state.type === (action.fromEvent === 'checked' ? 'boolean' : 'string'), 'INVALID_UI', `Interaction ${interaction.id} ${action.fromEvent} does not match state ${action.state}.`);
      } else ensure(valueType(definition, action.value) === state.type, 'INVALID_UI', `Interaction ${interaction.id} value does not match state ${action.state}.`);
    } else if (action.type === 'navigate' || action.type === 'upload-form') {
      ensure(valueType(definition, action.url) === 'string', 'INVALID_UI', `Interaction ${interaction.id} navigation must resolve to a string.`);
      if (!uiBindings(action.url).length) ensure(isSafeNavigationUrl(action.url), 'INVALID_UI', `Interaction ${interaction.id} has an unsafe navigation URL.`);
    } else if (action.type === 'save-form' || action.type === 'download-form') {
      const value = action.type === 'save-form' ? action.key : action.filename;
      ensure(valueType(definition, value) === 'string', 'INVALID_UI', `Interaction ${interaction.id} requires a string ${action.type === 'save-form' ? 'storage key' : 'filename'}.`);
    } else {
      ensure(!interactionTriggerEvents.has(action.event), 'INVALID_UI', `Interaction ${interaction.id} must emit a custom event, not native trigger ${action.event}.`);
      for (const value of Object.values(action.detail ?? {})) valueType(definition, value);
    }
    if (['save-form', 'upload-form', 'download-form'].includes(action.type)) {
      ensure((node.tag === 'form' && interaction.event === 'submit') || (['button', 'input'].includes(node.tag) && interaction.event === 'click'), 'INVALID_UI', `Interaction ${interaction.id} requires a form submit or an associated button/input click.`);
    }
  }
}

/** Check reusable interactions in the state/prop context of every attached element. */
export function validateUiInteractions(definitions: readonly UiDefinition[], interactions: readonly InteractionDefinition[]): void {
  validateInteractionLibrary(interactions);
  const byId = new Map(interactions.map(interaction => [interaction.id, interaction]));
  for (const definition of definitions) {
    const walk = (node: UiNode): void => {
      if ('tag' in node) for (const id of node.interactions ?? []) {
        const interaction = byId.get(id);
        ensure(interaction, 'UNKNOWN_INTERACTION', `${definition.id} references missing interaction ${id}. Inspect the interactions library or import its definition.`);
        validateAttachment(definition, node, interaction);
      }
      if ('children' in node) for (const child of node.children ?? []) walk(child);
    };
    walk(definition.root);
  }
}

export function componentInteractionIds(definition: UiDefinition): string[] {
  const ids = new Set<string>();
  const walk = (node: UiNode): void => {
    if ('tag' in node) for (const id of node.interactions ?? []) ids.add(id);
    if ('children' in node) for (const child of node.children ?? []) walk(child);
  };
  walk(definition.root);
  return [...ids].sort();
}
