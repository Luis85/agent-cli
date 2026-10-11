import { ensure, isRecord } from '../../../domain/shared/errors.ts';
import { vaultPath } from '../../../domain/documents/file.ts';
import type { CommandContext, Generator, PluginContext } from '../../../application/plugins/registry.ts';
import { option } from '../../../application/plugins/command-metadata.ts';
import { parseJson, value } from '../../../application/plugins/command-input.ts';
import type { DocumentTemplates } from '../application/templates.ts';

/**
 * `make document`: renders a shared template from the workspace's bin/templates into the command scope. Template
 * dates use `plugins.settings.templates.dateFormat` and `timeFormat` unless a placeholder names its own format.
 */
export function documentGenerator(templates: (context: CommandContext) => DocumentTemplates): Generator {
  return {
    id: 'document', description: 'Render an Obsidian Markdown/frontmatter template with typed values.', usage: 'make document Title --template name.md [--values JSON | --values-from path] [--date ISO] [--out notes]',
    directory: 'notes',
    options: {
      template: option.string('Markdown template under bin/templates.', { required: true }),
      values: option.string('Template values as a JSON object.'),
      'values-from': option.string('Read template values from a JSON file.'),
      date: option.string('ISO date used for template dates; defaults to today.'),
    },
    async run({ name: title, flags, context }) {
      ensure(title.trim() === title && title.length > 0 && !/[/\\:]/.test(title), 'INVALID_NAME', 'Document title must be a nonempty filename without path separators.');
      const template = value(flags, 'template', true)!;
      ensure(template.toLowerCase().endsWith('.md'), 'INVALID_TEMPLATE', 'Use a Markdown template.');
      const source = await context.environment.files.read(`bin/templates/${vaultPath(template)}`);
      const inline = value(flags, 'values'), from = value(flags, 'values-from');
      ensure(inline === undefined || from === undefined, 'INVALID_INPUT', 'Use either --values or --values-from.');
      const data = from === undefined ? parseJson(inline ?? '{}') : parseJson(new TextDecoder('utf-8', { fatal: true }).decode((await context.workspace.files.read(from)).bytes));
      ensure(isRecord(data), 'INVALID_INPUT', 'Template values must be a JSON object.');
      const settings = (context as PluginContext).settings ?? {};
      const bytes = templates(context).render(source.bytes, { title, values: data, date: value(flags, 'date'), dateFormat: settings.dateFormat as string | undefined, timeFormat: settings.timeFormat as string | undefined });
      const path = `${value(flags, 'out') ?? 'notes'}/${title}.md`;
      const result = await context.workspace.write([{ path, bytes }]);
      return { generator: 'document', template: source.path, ...result, ...(context.workspace.dryRun ? { preview: [{ path, content: new TextDecoder().decode(bytes) }] } : {}) };
    },
  };
}
