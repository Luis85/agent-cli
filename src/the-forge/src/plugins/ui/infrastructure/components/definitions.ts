import { z } from 'zod';
import { stringify } from 'yaml';
import { forgeError, AppError, ensure } from '../../../../domain/shared/errors.ts';
import { vaultPath } from '../../../../domain/documents/file.ts';
import type { UiDefinition, UiJson, UiNode } from '../../domain/components/definition.ts';
import { uiVoidTags } from '../../domain/components/syntax.ts';
import type { UiDefinitionCodec } from '../../application/components/library.ts';
import type { DocumentCodec } from '../../../../application/workspace/ports.ts';

const reserved = new Set('arguments await break case catch children class const constructor continue debugger default delete do else enum eval export extends false finally for function if implements import in instanceof interface let new null package private protected prototype public return static super switch this throw true try typeof var void while with yield undefined __proto__'.split(' '));
const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).refine(value => !reserved.has(value), 'Reserved prop name');
const id = z.string().max(120).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const value = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const json: z.ZodType<UiJson> = z.lazy(() => z.union([value, z.array(json), z.record(z.string(), json)]));
const values = z.record(identifier, value);
const prop = z.strictObject({ type: z.enum(['string', 'number', 'boolean']), default: value.optional(), required: z.boolean().optional(), description: z.string().optional() }).superRefine((property, context) => {
  if (property.default !== undefined && typeof property.default !== property.type) context.addIssue({ code: 'custom', message: 'Prop default must match its declared type.' });
});
const state = z.strictObject({ type: z.enum(['string', 'number', 'boolean']), default: value }).superRefine((field, context) => {
  if (typeof field.default !== field.type) context.addIssue({ code: 'custom', message: 'State default must match its declared type.' });
});
const attribute = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/).refine(name => !/^on|^v-/i.test(name) && !['innerHTML', 'dangerouslySetInnerHTML', 'ref', 'key'].includes(name), 'Event handlers and framework runtime attributes belong in native code');
const node: z.ZodType<UiNode> = z.lazy(() => z.union([
  z.strictObject({ tag: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/), attrs: z.record(attribute, value).optional(), text: z.string().optional(), children: z.array(node).optional(), interactions: z.array(id).min(1).refine(ids => new Set(ids).size === ids.length, 'Interaction attachments must be unique.').optional() }).superRefine((element, context) => {
    if (element.tag === 'svg' || element.tag === 'math') context.addIssue({ code: 'custom', message: 'SVG and MathML namespaces are unsupported in portable definitions; use native components or image assets.' });
    if (uiVoidTags.has(element.tag) && (element.text !== undefined || element.children?.length)) context.addIssue({ code: 'custom', message: `Void element ${element.tag} cannot have text or children.` });
  }),
  z.strictObject({ component: id, props: values.optional(), children: z.array(node).optional() }),
  z.strictObject({ slot: z.literal('children') }),
]));
const metadata = z.record(z.string(), json);
const story = z.strictObject({ name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/), args: values.optional(), parameters: metadata.optional(), tags: z.array(z.string()).optional() });
const storybook = z.strictObject({
  title: z.string().min(1).optional(), tags: z.array(z.string()).optional(), args: values.optional(),
  argTypes: metadata.optional(), parameters: metadata.optional(), stories: z.array(story).optional(),
  extension: z.string().optional(),
}).superRefine((settings, context) => {
  const names = settings.stories?.map(entry => entry.name) ?? [];
  if (new Set(names).size !== names.length) context.addIssue({ code: 'custom', message: 'Story names must be unique.' });
});
const schema = z.strictObject({ schemaVersion: z.literal(1), id, name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/).optional(), props: z.record(identifier, prop).default({}), state: z.record(identifier, state).optional(), root: node, storybook: storybook.optional() });

/** Markdown remains prose; only its validated YAML describes executable output. */
export class MarkdownUiDefinitions implements UiDefinitionCodec {
  constructor(private readonly documents: Pick<DocumentCodec, 'inspect'>) {}
  parse(bytes: Uint8Array, path: string): UiDefinition {
    vaultPath(path);
    try {
      const document = this.documents.inspect('definition.md', bytes) as { properties: unknown; body: string };
      const result = schema.safeParse(document.properties);
      ensure(result.success, 'INVALID_UI', `${path}: ${result.success ? '' : result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
      const extension = result.data.storybook?.extension;
      if (extension !== undefined) {
        vaultPath(extension);
        ensure(/\.(?:[cm]?js|tsx?)$/.test(extension), 'INVALID_UI', `${path}: Storybook extension must be a JS or TS module.`);
      }
      return { ...result.data, description: document.body, sourcePath: path };
    } catch (error) {
      if (error instanceof AppError && error.code === 'INVALID_UI') throw error;
      throw forgeError('INVALID_UI', `${path}: ${error instanceof Error ? error.message : 'Invalid component definition.'}`);
    }
  }
  serialize(definition: UiDefinition): Uint8Array {
    const { description, sourcePath, ...frontmatter } = definition;
    const bytes = new TextEncoder().encode(`---\n${stringify(frontmatter)}---\n${description}`);
    this.parse(bytes, sourcePath || `${definition.id}.md`);
    return bytes;
  }
}
