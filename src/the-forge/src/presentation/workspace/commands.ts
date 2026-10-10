import { ensure, isRecord } from '../../domain/shared/errors.ts';
import { vaultPath } from '../../domain/documents/file.ts';
import type { Command, CommandContext } from '../../application/plugins/registry.ts';
import { arity, value } from '../../application/plugins/command-input.ts';
import { parseJson } from '../cli/input.ts';
import type { WorkflowServices } from '../cli/services.ts';
import { option } from '../../application/plugins/command-metadata.ts';

const discovery = { scope: 'workspace', discovery: true } as const;

export async function makeDocument(title: string, flags: Record<string, string | boolean>, context: CommandContext, services: WorkflowServices) {
  ensure(title.trim() === title && title.length > 0 && !/[/\\:]/.test(title), 'INVALID_NAME', 'Document title must be a nonempty filename without path separators.');
  const template = value(flags, 'template', true)!;
  ensure(template.toLowerCase().endsWith('.md'), 'INVALID_TEMPLATE', 'Use a Markdown template.');
  const source = await services.files.read(`bin/templates/${vaultPath(template)}`);
  const inline = value(flags, 'values'), from = value(flags, 'values-from');
  ensure(inline === undefined || from === undefined, 'INVALID_INPUT', 'Use either --values or --values-from.');
  const data = from === undefined ? parseJson(inline ?? '{}') : parseJson(new TextDecoder('utf-8', { fatal: true }).decode((await context.workspace.files.read(from)).bytes));
  ensure(isRecord(data), 'INVALID_INPUT', 'Template values must be a JSON object.');
  const bytes = services.templates.render(source.bytes, { title, values: data, date: value(flags, 'date'), ...services.loaded.config.templates });
  const path = `${value(flags, 'out') ?? 'notes'}/${title}.md`;
  const result = await context.workspace.write([{ path, bytes }]);
  return { generator: 'document', template: source.path, ...result, ...(context.workspace.dryRun ? { preview: [{ path, content: new TextDecoder().decode(bytes) }] } : {}) };
}
export function workflowCommands(services: WorkflowServices): Command[] {
  const config = services.loaded.config;
  return [
    { id: 'config', description: 'Inspect the validated effective configuration and its source path.', usage: 'config', ...discovery, mutating: false, errors: ['INVALID_CONFIG'],
      run(args) { arity(args, 0); return { ...services.loaded, sections: services.configSections() }; } },
    { id: 'setup', description: 'Install The Forge into this workspace and initialize missing configuration, skills, templates and project guidance.', usage: '[--root project] setup [--dry-run]', ...discovery, mutating: true, errors: ['INVALID_SETUP'],
      run(args) { arity(args, 0); return services.setup(); } },
    { id: 'templates', description: 'Discover Markdown templates, required placeholders, and install the planning workflow pack.', usage: 'templates [list | inspect <template.md> | install [workflow]]',
      scope: 'workspace', discovery: false, mutating: true, defaultAction: 'list', errors: ['INVALID_TEMPLATE', 'INVALID_TEMPLATE_PACK', 'NOT_FOUND', 'CONFLICT'],
      actions: {
        list: { description: 'List the editable Markdown templates in bin/templates.', mutating: false },
        inspect: { description: 'Report a template\'s required and optional values.', mutating: false },
        install: { description: 'Install the planning workflow template pack into bin/templates.' },
      },
      args: [{ name: 'action', description: 'list (default), inspect or install.', enum: ['list', 'inspect', 'install'] }, { name: 'target', description: 'The template for inspect, or the pack (workflow) for install.' }],
      async run(args) {
      const action = args[0] ?? 'list';
      if (action === 'install') {
        arity(args, 1, 2);
        ensure(args[1] === undefined || args[1] === 'workflow', 'INVALID_ARGUMENT', 'The available template pack is workflow. Run templates install workflow.');
        return services.installTemplates();
      }
      if (action === 'list') {
        arity(args, 0, 1); const prefix = 'bin/templates/';
        return { directory: 'bin/templates', templates: (await services.files.list()).filter(path => path.startsWith(prefix) && path.toLowerCase().endsWith('.md')).map(path => path.slice(prefix.length)) };
      }
      ensure(action === 'inspect', 'INVALID_ARGUMENT', 'Use templates list, templates inspect <template.md>, or templates install workflow.'); arity(args, 2);
      ensure(args[1]!.toLowerCase().endsWith('.md'), 'INVALID_TEMPLATE', 'Use a Markdown template.');
      const path = `bin/templates/${vaultPath(args[1]!)}`;
      return { path, ...services.templates.inspect((await services.files.read(path)).bytes) };
    } },
    { id: 'project', description: 'Manage TypeScript library projects and add tested domain/application components.', usage: 'project list | create <id> | open <id> | current | close | inspect [id] | component [id] <Name> [--kind domain|application]',
      scope: 'workspace', discovery: false, mutating: true, defaultAction: 'list',
      errors: ['INVALID_PROJECT', 'INVALID_PROJECT_NAME', 'INVALID_PROJECT_CONTEXT', 'PROJECT_EXISTS', 'PROJECT_NOT_FOUND', 'PROJECT_REQUIRED', 'STALE_PROJECT_CONTEXT', 'INVALID_NAME'],
      actions: {
        list: { description: 'List managed projects.', mutating: false },
        create: { description: 'Create a self-contained TypeScript project.' },
        open: { description: 'Select a project for file commands and generators.' },
        current: { description: 'Report the selected project.', mutating: false },
        close: { description: 'Clear the project selection.' },
        inspect: { description: 'Describe a project, or the selected one.', mutating: false },
        component: { description: 'Add a tested domain or application component to a project.' },
      },
      args: [{ name: 'action', description: 'list (default), create, open, current, close, inspect or component.', enum: ['list', 'create', 'open', 'current', 'close', 'inspect', 'component'] }, { name: 'target', description: 'A project id, or the component name.' }, { name: 'name', description: 'The component name when a project id precedes it.' }],
      options: { kind: option.string('Component kind for project component.', { enum: ['domain', 'application'], default: 'domain' }) }, async run(args, flags) {
      const action = args[0] ?? 'list';
      if (action !== 'component') ensure(flags.kind === undefined, 'INVALID_ARGUMENT', '--kind is only valid with project component.');
      if (action === 'list') { arity(args, 0, 1); return { directory: config.paths.projects, projects: await services.projects.list() }; }
      if (action === 'current') { arity(args, 1); return { project: await services.projects.current() }; }
      if (action === 'open') { arity(args, 2); return services.projects.open(args[1]!); }
      if (action === 'close') { arity(args, 1); return services.projects.close(); }
      if (action === 'inspect') { arity(args, 1, 2); return args[1] ? services.projects.inspect(args[1]) : services.projects.requireCurrent(); }
      if (action === 'create') { arity(args, 2); return services.projects.create(args[1]!); }
      ensure(action === 'component', 'INVALID_ARGUMENT', 'Use project list, inspect, create, open, current, close, or component.'); arity(args, 2, 3);
      const kind = value(flags, 'kind') ?? 'domain';
      ensure(kind === 'domain' || kind === 'application', 'INVALID_ARGUMENT', '--kind must be domain or application.');
      const name = args.length === 3 ? args[1]! : (await services.projects.requireCurrent()).name;
      return services.projects.component(name, args.length === 3 ? args[2]! : args[1]!, kind);
    } },
  ];
}
