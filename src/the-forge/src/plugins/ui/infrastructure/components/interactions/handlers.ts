import type { InteractionDefinition } from '../../../domain/interactions/definition.ts';
import type { UiDefinition, UiNode, UiValue } from '../../../domain/components/definition.ts';
import { componentInteractionIds, interactionUsesState } from '../../../domain/components/interactions.ts';
import { expression, json, ordered } from '../rendering.ts';
import { formActionHelper } from './form-actions.ts';

/** Internal Angular members must never shadow a caller-defined input. */
export function interactionPrefix(definition: UiDefinition): string {
  let prefix = '_ui';
  while (Object.keys(definition.props).some(name => name.startsWith(prefix))) prefix += '_';
  return prefix;
}

export function stateDefaults(definition: UiDefinition): Record<string, UiValue> {
  return Object.fromEntries(ordered(definition.state ?? {}).map(([name, state]) => [name, state.default]));
}

export function stateType(definition: UiDefinition): string {
  return `{ ${ordered(definition.state ?? {}).map(([name, state]) => `${json(name)}: ${state.type}`).join('; ')} }`;
}

const handlerName = (id: string, prefix: string) => `${prefix}Interaction_${id.replace(/-/g, '_')}`;

export function componentInteractions(definition: UiDefinition, interactions: readonly InteractionDefinition[]): InteractionDefinition[] {
  const ids = new Set(componentInteractionIds(definition));
  return interactions.filter(interaction => ids.has(interaction.id)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** One listener per event preserves the declaration order of interaction references. */
export function groupElementInteractions(node: UiNode, interactions: readonly InteractionDefinition[], prefix = '_ui') {
  const groups = new Map<string, string[]>();
  if (!('tag' in node)) return [];
  for (const id of node.interactions ?? []) {
    const interaction = interactions.find(candidate => candidate.id === id)!;
    const handlers = groups.get(interaction.event) ?? [];
    handlers.push(handlerName(id, prefix));
    groups.set(interaction.event, handlers);
  }
  return [...groups].map(([event, handlers]) => ({ event, handlers }));
}

interface HandlerOptions {
  typescript: boolean;
  classMembers?: boolean;
  propsScope?: string;
  stateScope?: string;
  prefix?: string;
  /** Commit after each state action, before any later observable side effect. */
  commit(next: string): string;
}

/** Framework adapters own reactivity; this emitter owns portable action semantics. */
export function renderInteractionHandlers(definition: UiDefinition, interactions: readonly InteractionDefinition[], options: HandlerOptions): string {
  const selected = componentInteractions(definition, interactions);
  if (!selected.length) return '';
  const { typescript } = options;
  const prefix = options.prefix ?? '_ui';
  const next = `${prefix}Next`, event = `${prefix}Event`;
  const value = (item: UiValue) => expression(item, options.propsScope ?? 'props', next);
  const eventType = '{ currentTarget: EventTarget | null; target: EventTarget | null; key?: string; preventDefault(): void; stopPropagation(): void }';
  const functions = selected.map(interaction => {
    const asynchronous = interaction.actions.some(action => ['save-form', 'upload-form', 'download-form'].includes(action.type));
    const currentTarget = asynchronous ? `${prefix}Target` : `${event}.currentTarget`;
    const lines = [`${asynchronous ? 'async ' : ''}function ${handlerName(interaction.id, prefix)}(${event}${typescript ? `: ${eventType}` : ''}) {`];
    if (interaction.keys) lines.push(`  if (!${json(interaction.keys)}.includes(${event}.key ?? '')) return;`);
    if (interaction.preventDefault) lines.push(`  ${event}.preventDefault();`);
    if (interaction.stopPropagation) lines.push(`  ${event}.stopPropagation();`);
    if (asynchronous) lines.push(`  const ${currentTarget} = ${event}.currentTarget;`);
    if (interactionUsesState(interaction)) lines.push(`  const ${next} = { ...${options.stateScope ?? '_uiState'} };`);
    for (const [index, action] of interaction.actions.entries()) {
      if (action.type === 'toggle-state' || action.type === 'set-state') {
        let assigned = action.type === 'toggle-state' ? `!${next}[${json(action.state)}]` : 'value' in action ? value(action.value) : '';
        if (action.type === 'set-state' && 'fromEvent' in action) {
          const field = `${prefix}Value${index}`;
          lines.push(`  const ${field} = (${currentTarget}${typescript ? ` as { ${action.fromEvent}?: unknown } | null` : ''})?.${action.fromEvent};`);
          lines.push(`  if (typeof ${field} !== ${json(action.fromEvent === 'checked' ? 'boolean' : 'string')}) throw new globalThis.TypeError(${json(`Interaction ${interaction.id} requires event.currentTarget.${action.fromEvent}.`)});`);
          assigned = field;
        }
        lines.push(`  ${next}[${json(action.state)}] = ${assigned};`, `  ${options.commit(next)}`);
      } else if (action.type === 'emit') {
        const detail = `{ ${ordered(action.detail ?? {}).map(([key, item]) => `${key === '__proto__' ? `[${json(key)}]` : json(key)}: ${value(item)}`).join(', ')} }`;
        lines.push(`  ${options.classMembers ? 'this.' : ''}${prefix}Emit(${currentTarget}, ${json(action.event)}, ${detail});`);
      } else if (action.type === 'navigate') {
        lines.push(`  ${options.classMembers ? 'this.' : ''}${prefix}Navigate(${currentTarget}, ${value(action.url)});`);
      } else {
        const option = action.type === 'save-form' ? action.key : action.type === 'upload-form' ? action.url : action.filename;
        lines.push(`  if (!await ${options.classMembers ? 'this.' : ''}${prefix}FormAction(${currentTarget}, ${json(action.type)}, ${value(option)})) return;`);
      }
    }
    lines.push('}');
    return lines.join('\n');
  });
  const needsForms = selected.some(interaction => interaction.actions.some(action => ['save-form', 'upload-form', 'download-form'].includes(action.type)));
  const needsEmit = needsForms || selected.some(interaction => interaction.actions.some(action => action.type === 'emit'));
  const needsNavigate = selected.some(interaction => interaction.actions.some(action => action.type === 'navigate'));
  const target = `target${typescript ? ': EventTarget | null' : ''}`;
  const element = `target${typescript ? ' as Element | null' : ''}`;
  const helpers: string[] = [];
  if (needsForms) helpers.push(formActionHelper(prefix, typescript, !!options.classMembers));
  if (needsEmit) helpers.push(`function ${prefix}Emit(${target}, name${typescript ? ': string' : ''}, detail${typescript ? ': Record<string, unknown>' : ''}) {
  const element = ${element};
  const EventConstructor = element?.ownerDocument.defaultView?.CustomEvent ?? globalThis.CustomEvent;
  element?.dispatchEvent(new EventConstructor(name, { detail, bubbles: true, composed: true }));
}`);
  if (needsNavigate) helpers.push(`function ${prefix}Navigate(${target}, value${typescript ? ': unknown' : ''}) {
  const element = ${element};
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\\u0000-\\u001f\\\\]/.test(value) || value.startsWith('//') || (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\\/\\//i.test(value))) throw new globalThis.TypeError('Unsafe interaction navigation URL.');
  const url = new globalThis.URL(value, element?.ownerDocument.baseURI);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new globalThis.TypeError('Unsafe interaction navigation URL.');
  element?.ownerDocument.defaultView?.location.assign(url.href);
}`);
  const source = [...helpers, ...functions].join('\n');
  return options.classMembers ? source.replace(/^(async )?function (\w+)\((.*)\) \{$/gm, '$2 = $1($3) => {').replace(/^\}$/gm, '};') : source;
}
