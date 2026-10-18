import { ensure } from '../../../domain/shared/errors.ts';
import { changesOutput } from '../../../application/plugins/output-schemas.ts';
import { vaultPath } from '../../../domain/documents/file.ts';
import type { Command, CommandContext } from '../../../application/plugins/registry.ts';
import type { TemplateArtifact } from '../../../application/workspace/setup.ts';
import { TemplateInstaller, type DocumentTemplates } from '../application/templates.ts';
import { ensureTemplate } from '../domain/errors.ts';

/** `templates`: lists and inspects the shared templates in the workspace's bin/templates and installs the workflow pack. */
export function templatesCommand(templates: (context: CommandContext) => DocumentTemplates, workflowPack: readonly TemplateArtifact[]): Command {
  return {
    id: 'templates', description: 'Discover Markdown templates, required placeholders, and install the planning workflow pack.', usage: 'templates [list | inspect <template.md> | install [workflow]]',
    scope: 'workspace', discovery: false, mutating: true, defaultAction: 'list', unknownAction: 'INVALID_ARGUMENT', errors: ['INVALID_TEMPLATE', 'INVALID_TEMPLATE_PACK', 'NOT_FOUND', 'CONFLICT'],
    actions: {
      list: { description: 'List the editable Markdown templates in bin/templates.', mutating: false, args: [] },
      inspect: { description: 'Report a template\'s required and optional values.', mutating: false, args: [{ name: 'template', description: 'The template path inside bin/templates, such as prd.md.', required: true }] },
      install: {
        description: 'Install the planning workflow template pack into bin/templates; existing templates are skipped.', destructive: false, idempotent: true,
        args: [{ name: 'pack', description: 'The template pack; workflow is the only one.', enum: ['workflow'] }],
        output: changesOutput({ directory: { type: 'string' }, skipped: { type: 'array', items: { type: 'string' }, description: 'Templates that already exist and were left unchanged.' } }, ['directory', 'skipped']),
      },
    },
    async run(args, _flags, context) {
      const { environment } = context;
      const action = args[0] ?? 'list';
      if (action === 'install') {
        ensure(args[1] === undefined || args[1] === 'workflow', 'INVALID_ARGUMENT', 'The available template pack is workflow. Run templates install workflow.');
        return new TemplateInstaller(environment, workflowPack).install();
      }
      if (action === 'list') {
        const prefix = 'bin/templates/';
        return { directory: 'bin/templates', templates: (await environment.files.list()).filter(path => path.startsWith(prefix) && path.toLowerCase().endsWith('.md')).map(path => path.slice(prefix.length)) };
      }
      ensure(action === 'inspect', 'INVALID_ARGUMENT', 'Use templates list, templates inspect <template.md>, or templates install workflow.'); 
      ensureTemplate(args[1]!.toLowerCase().endsWith('.md'), 'INVALID_TEMPLATE', 'Use a Markdown template.');
      const path = `bin/templates/${vaultPath(args[1]!)}`;
      return { path, ...templates(context).inspect((await environment.files.read(path)).bytes) };
    },
  };
}
