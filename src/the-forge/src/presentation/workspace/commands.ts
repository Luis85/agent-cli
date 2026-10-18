import { ensure } from '../../domain/shared/errors.ts';
import type { Command } from '../../application/plugins/registry.ts';
import { value } from '../../application/plugins/command-input.ts';
import type { KernelServices } from '../cli/services.ts';
import { option } from '../../application/plugins/command-metadata.ts';
import type { JsonSchema } from '../../domain/schema/json-schema.ts';
import { projectInfoSchema, selectedProjectSchema } from '../cli/envelope.ts';
import { changesOutput } from '../../application/plugins/output-schemas.ts';

const discovery = { scope: 'workspace', discovery: true } as const;
const projectId = { name: 'id', description: 'A project id.', required: true } as const;
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

const projectListOutput: JsonSchema = {
  type: 'object', required: ['directory', 'projects', 'invalid'],
  properties: {
    directory: { type: 'string' }, projects: { type: 'array', items: projectInfoSchema },
    invalid: {
      type: 'array', description: 'Project directories whose .forge/project.json is invalid; the other projects stay usable.',
      items: { type: 'object', required: ['directory', 'code', 'reason'], properties: { directory: { type: 'string' }, code: { type: 'string', enum: ['INVALID_PROJECT', 'INVALID_PROJECT_NAME'] }, reason: { type: 'string' } } },
    },
  },
};

export function workspaceCommands(services: KernelServices): Command[] {
  const config = services.loaded.config;
  return [
    { id: 'config', description: 'Inspect the validated effective configuration and its source path.', usage: 'config', ...discovery, mutating: false, errors: ['INVALID_CONFIG'], output: configOutput, localizedOutput: { sections: 'settings' }, args: [],
      run() { return { ...services.loaded, sections: services.configSections() }; } },
    { id: 'setup', description: 'Install The Forge into this workspace and initialize missing configuration, skills, templates and project guidance.', usage: '[--root workspace] setup [--dry-run]', ...discovery, mutating: true, ...additive, errors: ['INVALID_SETUP'], localizedOutput: { nextSteps: 'text' }, args: [],
      run() { return services.setup(); } },
    { id: 'project', description: 'Manage self-contained library and webview projects and add tested domain/application components.', usage: 'project list | create <id> [--type library|webview] | open <id> | current | close | inspect [id] | component [id] <Name> [--kind domain|application]',
      scope: 'workspace', discovery: false, mutating: true, defaultAction: 'list', unknownAction: 'INVALID_ARGUMENT',
      errors: ['INVALID_PROJECT', 'INVALID_PROJECT_NAME', 'INVALID_PROJECT_CONTEXT', 'PROJECT_EXISTS', 'PROJECT_NOT_FOUND', 'PROJECT_REQUIRED', 'STALE_PROJECT_CONTEXT', 'INVALID_NAME', 'INVALID_COMPONENT_KIND', 'PLUGIN_UNAVAILABLE'],
      actions: {
        list: { description: 'List managed projects, and the directories whose project marker is invalid.', usage: 'project [list]', mutating: false, args: [], output: projectListOutput },
        create: { description: 'Create a self-contained TypeScript library or Vue webview project.', usage: 'project create <id> [--type library|webview]', ...additive, args: [projectId], output: changesOutput({ project: projectInfoSchema, nextSteps: { type: 'array', items: { type: 'object' } } }, ['project', 'nextSteps']), options: { type: option.string('Project scaffold type for project create.', { enum: ['library', 'webview'], default: 'library' }) } },
        open: { description: 'Select a project for file commands and generators.', usage: 'project open <id>', ...additive, args: [projectId], output: changesOutput({ project: projectInfoSchema }, ['project']) },
        current: { description: 'Report the selected project.', usage: 'project current', mutating: false, args: [], output: { type: 'object', required: ['project'], properties: { project: selectedProjectSchema } } },
        close: { description: 'Clear the project selection.', usage: 'project close', ...additive, args: [], output: changesOutput({ project: { type: 'null' } }, ['project']) },
        inspect: { description: 'Describe a project, or the selected one.', usage: 'project inspect [id]', mutating: false, args: [{ name: 'id', description: 'A project id; defaults to the selected project.' }] },
        component: {
          description: 'Add a tested domain or application component to a project.', usage: 'project component [id] <Name> [--kind domain|application]', ...additive,
          args: [{ name: 'target', description: 'A project id, or the component name.', required: true }, { name: 'name', description: 'The component name when a project id precedes it.' }],
          output: changesOutput({ project: projectInfoSchema, component: { type: 'object', required: ['name', 'kind'], properties: { name: { type: 'string' }, kind: { type: 'string', enum: ['domain', 'application'] } } } }, ['project', 'component']),
          options: { kind: option.string('Component kind for project component.', { enum: ['domain', 'application'], default: 'domain' }) },
        },
      },
      async run(args, flags) {
      const action = args[0] ?? 'list';
      if (action === 'list') return { directory: config.paths.projects, ...await services.projects.discover() };
      if (action === 'current') return { project: await services.projects.current() };
      if (action === 'open') return services.projects.open(args[1]!);
      if (action === 'close') return services.projects.close();
      if (action === 'inspect') return args[1] ? services.projects.inspect(args[1]) : services.projects.requireCurrent();
      if (action === 'create') {
        const type = value(flags, 'type') ?? 'library';
        ensure(type === 'library' || type === 'webview', 'INVALID_ARGUMENT', '--type must be library or webview.');
        return services.projects.create(args[1]!, type);
      }
      ensure(action === 'component', 'INVALID_ARGUMENT', 'Use project list, inspect, create, open, current, close, or component.');
      const kind = value(flags, 'kind') ?? 'domain';
      ensure(kind === 'domain' || kind === 'application', 'INVALID_ARGUMENT', '--kind must be domain or application.');
      const name = args.length === 3 ? args[1]! : (await services.projects.requireCurrent()).name;
      return services.projects.component(name, args.length === 3 ? args[2]! : args[1]!, kind);
    } },
  ];
}
