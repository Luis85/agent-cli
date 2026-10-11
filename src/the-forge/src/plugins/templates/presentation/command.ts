import { ensure } from '../../../domain/shared/errors.ts';
import { vaultPath } from '../../../domain/documents/file.ts';
import type { Command, CommandContext } from '../../../application/plugins/registry.ts';
import { arity } from '../../../application/plugins/command-input.ts';
import type { TemplateArtifact } from '../../../application/workspace/setup.ts';
import { TemplateInstaller, type DocumentTemplates } from '../application/templates.ts';

/** `templates`: lists and inspects the shared templates in the workspace's bin/templates and installs the workflow pack. */
export function templatesCommand(templates: (context: CommandContext) => DocumentTemplates, workflowPack: readonly TemplateArtifact[]): Command {
  return {
    id: 'templates', description: 'Discover Markdown templates, required placeholders, and install the planning workflow pack.', usage: 'templates [list | inspect <template.md> | install [workflow]]',
    scope: 'workspace', discovery: false, mutating: true, defaultAction: 'list', errors: ['INVALID_TEMPLATE', 'INVALID_TEMPLATE_PACK', 'NOT_FOUND', 'CONFLICT'],
    actions: {
      list: { description: 'List the editable Markdown templates in bin/templates.', mutating: false },
      inspect: { description: 'Report a template\'s required and optional values.', mutating: false },
      install: { description: 'Install the planning workflow template pack into bin/templates.' },
    },
    args: [{ name: 'action', description: 'list (default), inspect or install.', enum: ['list', 'inspect', 'install'] }, { name: 'target', description: 'The template for inspect, or the pack (workflow) for install.' }],
    async run(args, _flags, context) {
      const { environment } = context;
      const action = args[0] ?? 'list';
      if (action === 'install') {
        arity(args, 1, 2);
        ensure(args[1] === undefined || args[1] === 'workflow', 'INVALID_ARGUMENT', 'The available template pack is workflow. Run templates install workflow.');
        return new TemplateInstaller(environment, workflowPack).install();
      }
      if (action === 'list') {
        arity(args, 0, 1); const prefix = 'bin/templates/';
        return { directory: 'bin/templates', templates: (await environment.files.list()).filter(path => path.startsWith(prefix) && path.toLowerCase().endsWith('.md')).map(path => path.slice(prefix.length)) };
      }
      ensure(action === 'inspect', 'INVALID_ARGUMENT', 'Use templates list, templates inspect <template.md>, or templates install workflow.'); arity(args, 2);
      ensure(args[1]!.toLowerCase().endsWith('.md'), 'INVALID_TEMPLATE', 'Use a Markdown template.');
      const path = `bin/templates/${vaultPath(args[1]!)}`;
      return { path, ...templates(context).inspect((await environment.files.read(path)).bytes) };
    },
  };
}
