import { z } from 'zod';
import { stringify } from 'yaml';
import { AppError, ensure } from '../domain/errors.ts';
import { vaultPath } from '../domain/file.ts';
import { interactionEvents, interactionTriggerEvents, isSafeNavigationUrl, type InteractionDefinition } from '../domain/interaction.ts';
import { uiBindingParts, uiHasMalformedBinding, uiWholeBinding } from '../domain/ui-syntax.ts';
import type { InteractionDefinitionCodec } from '../application/interactions.ts';
import { ObsidianDocuments } from './documents.ts';

const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value), 'Reserved state name.');
const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]).refine(value => !uiHasMalformedBinding(value), 'Invalid scalar binding syntax.');
const safeKey = z.string().min(1).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value), 'Reserved detail key.');
const url = z.string().min(1).refine(value => {
  if (uiHasMalformedBinding(value)) return false;
  if (uiWholeBinding(value)) return true;
  const example = uiBindingParts(value).map(part => 'literal' in part ? part.literal : 'value').join('');
  return isSafeNavigationUrl(example);
}, 'Use an HTTP(S) or relative URL with valid scalar bindings, without credentials or executable schemes.');
const action = z.union([
  z.strictObject({ type: z.literal('set-state'), state: identifier, value: scalar }),
  z.strictObject({ type: z.literal('set-state'), state: identifier, fromEvent: z.enum(['value', 'checked']) }),
  z.strictObject({ type: z.literal('toggle-state'), state: identifier }),
  z.strictObject({ type: z.literal('navigate'), url }),
  z.strictObject({ type: z.literal('emit'), event: z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/).refine(value => !interactionTriggerEvents.has(value), 'Emit a custom event name; native interaction events would recursively trigger handlers.'), detail: z.record(safeKey, scalar).optional() }),
]);
const schema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().max(120).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
  event: z.enum(interactionEvents), keys: z.array(z.string().min(1)).min(1).optional(),
  preventDefault: z.boolean().optional(), stopPropagation: z.boolean().optional(), actions: z.array(action).min(1),
}).superRefine((definition, context) => {
  if (definition.keys && !['keydown', 'keyup'].includes(definition.event)) context.addIssue({ code: 'custom', path: ['keys'], message: 'Key filters require keydown or keyup.' });
  if (definition.keys && new Set(definition.keys).size !== definition.keys.length) context.addIssue({ code: 'custom', path: ['keys'], message: 'Key filters must be unique.' });
  for (const [index, entry] of definition.actions.entries()) {
    if (entry.type === 'set-state' && 'fromEvent' in entry && !['input', 'change'].includes(definition.event)) {
      context.addIssue({ code: 'custom', path: ['actions', index, 'fromEvent'], message: 'Event value and checked sources require input or change.' });
    }
  }
});

/** Markdown prose stays authored; strict frontmatter defines the portable interaction contract. */
export class MarkdownInteractionDefinitions implements InteractionDefinitionCodec {
  private readonly documents = new ObsidianDocuments();
  parse(bytes: Uint8Array, path: string): InteractionDefinition {
    vaultPath(path);
    try {
      const document = this.documents.inspect('interaction.md', bytes) as { properties: unknown; body: string };
      const result = schema.safeParse(document.properties);
      ensure(result.success, 'INVALID_INTERACTION', `${path}: ${result.success ? '' : result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
      return { ...result.data, description: document.body, sourcePath: path };
    } catch (error) {
      if (error instanceof AppError && error.code === 'INVALID_INTERACTION') throw error;
      throw new AppError('INVALID_INTERACTION', `${path}: ${error instanceof Error ? error.message : 'Invalid interaction definition.'}`, 2);
    }
  }
  serialize(definition: InteractionDefinition): Uint8Array {
    const { sourcePath, description, ...frontmatter } = definition;
    const bytes = new TextEncoder().encode(`---\n${stringify(frontmatter)}---\n${description}`);
    this.parse(bytes, sourcePath || `${definition.id}.md`);
    return bytes;
  }
}
