import { ensure } from '../../domain/shared/errors.ts';
import type { Command } from '../../application/plugins/registry.ts';
import { arity, value } from '../../application/plugins/command-input.ts';
import type { WorkflowServices } from '../cli/services.ts';
import { option } from '../../application/plugins/command-metadata.ts';
import type { JsonSchema } from '../../domain/schema/json-schema.ts';
import { projectInfoSchema, selectedProjectSchema } from '../cli/envelope.ts';

const discovery = { scope: 'workspace', discovery: true } as const;
/** Mutating project actions that only add files or change the selection: repeating one has no further effect. */
const additive = { destructive: false, idempotent: true } as const;
const configOutput: JsonSchema = {
  type: 'object', required: ['path', 'root', 'config', 'sections'],
  properties: {
    path: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Absolute path of the loaded bin/config.json, or null when only defaults apply.' }, root: { type: 'string', description: 'Absolute workspace root.' },
    config: {
      type: 'object', required: ['schemaVersion', 'paths', 'settings', 'plugins'], description: 'The validated effective configuration.',
      properties: { schemaVersion: { type: 'integer' }, paths: { type: 'object' }, settings: { type: 'object' }, plugins: { type: 'object' } },
    },
    sections: { type: 'array', items: { type: 'object', required: ['plugin', 'path', 'schema'], properties: { plugin: { type: 'string' }, path: { type: 'string' }, schema: { type: 'object' } } } },
  },
};

export function workflowCommands(services: WorkflowServices): Command[] {
  const config = services.loaded.config;
  return [
    { id: 'config', description: 'Inspect the validated effective configuration and its source path.', usage: 'config', ...discovery, mutating: false, errors: ['INVALID_CONFIG'], output: configOutput,
      run(args) { arity(args, 0); return { ...services.loaded, sections: services.configSections() }; } },
    { id: 'setup', description: 'Install The Forge into this workspace and initialize missing configuration, skills, templates and project guidance.', usage: '[--root project] setup [--dry-run]', ...discovery, mutating: true, ...additive, errors: ['INVALID_SETUP'],
      run(args) { arity(args, 0); return services.setup(); } },
    { id: 'project', description: 'Manage TypeScript library projects and add tested domain/application components.', usage: 'project list | create <id> | open <id> | current | close | inspect [id] | component [id] <Name> [--kind domain|application]',
      scope: 'workspace', discovery: false, mutating: true, defaultAction: 'list',
      errors: ['INVALID_PROJECT', 'INVALID_PROJECT_NAME', 'INVALID_PROJECT_CONTEXT', 'PROJECT_EXISTS', 'PROJECT_NOT_FOUND', 'PROJECT_REQUIRED', 'STALE_PROJECT_CONTEXT', 'INVALID_NAME', 'PLUGIN_UNAVAILABLE'],
      actions: {
        list: { description: 'List managed projects.', mutating: false, output: { type: 'object', required: ['directory', 'projects'], properties: { directory: { type: 'string' }, projects: { type: 'array', items: projectInfoSchema } } } },
        create: { description: 'Create a self-contained TypeScript project.', ...additive },
        open: { description: 'Select a project for file commands and generators.', ...additive },
        current: { description: 'Report the selected project.', mutating: false, output: { type: 'object', required: ['project'], properties: { project: selectedProjectSchema } } },
        close: { description: 'Clear the project selection.', ...additive },
        inspect: { description: 'Describe a project, or the selected one.', mutating: false },
        component: { description: 'Add a tested domain or application component to a project.', ...additive },
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
