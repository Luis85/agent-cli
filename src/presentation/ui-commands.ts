import { ensure, isRecord } from '../domain/errors.ts';
import { vaultPath } from '../domain/file.ts';
import { uiFrameworks, type UiFramework, type UiNode } from '../domain/ui.ts';
import type { Command, CommandContext } from '../application/plugins.ts';
import { parseJson, type WorkflowServices } from './workflow-commands.ts';
import { arity, value } from './arguments.ts';

export const uiGenerationOptions = { framework: 'string', project: 'string', library: 'string', stories: 'boolean', 'stories-out': 'string', 'revisions-from': 'string', plan: 'boolean', 'plan-out': 'string', check: 'boolean' } as const;

function componentDependencies(root: UiNode): string[] {
  const dependencies = new Set<string>();
  const visit = (node: UiNode) => {
    if ('component' in node) dependencies.add(node.component);
    if ('children' in node) for (const child of node.children ?? []) visit(child);
  };
  visit(root); return [...dependencies].sort();
}

export async function makeUi(kind: 'ui' | 'stories', id: string, flags: Record<string, string | boolean>, context: CommandContext, services: WorkflowServices) {
  const config = services.loaded.config;
  const framework = value(flags, 'framework') ?? config.ui.framework;
  ensure(uiFrameworks.includes(framework as UiFramework), 'INVALID_UI_FRAMEWORK', `--framework must be one of: ${uiFrameworks.join(', ')}.`);
  const storybook = kind === 'stories' || flags.stories === true;
  ensure(storybook || flags['stories-out'] === undefined, 'INVALID_ARGUMENT', '--stories-out requires --stories or make stories.');
  ensure(kind !== 'stories' || flags.stories === undefined, 'INVALID_ARGUMENT', 'make stories already generates stories; omit --stories.');
  const scoped = (path: string) => {
    const relative = vaultPath(path);
    return context.project ? `${context.project.directory}/${relative}` : relative;
  };
  const directory = value(flags, 'library') ?? config.paths.components;
  const revisionsPath = value(flags, 'revisions-from');
  const planPath = value(flags, 'plan-out'), planning = flags.plan === true || planPath !== undefined;
  ensure(!(planning && flags.check), 'INVALID_ARGUMENT', 'Choose --plan/--plan-out or --check.');
  ensure(!(revisionsPath !== undefined && (planning || flags.check)), 'INVALID_ARGUMENT', 'Planning and checks do not accept --revisions-from. Review a plan first, then regenerate explicitly.');
  let revisions: Record<string, string> | undefined;
  if (revisionsPath !== undefined) {
    const parsed = parseJson(new TextDecoder('utf-8', { fatal: true }).decode((await context.workspace.files.read(revisionsPath)).bytes));
    ensure(isRecord(parsed) && Object.values(parsed).every(revision => typeof revision === 'string' && /^[a-f0-9]{64}$/.test(revision)), 'INVALID_INPUT', '--revisions-from must contain a JSON object mapping generated workspace paths to SHA-256 revisions.');
    revisions = parsed as Record<string, string>;
  }
  const options = {
    component: id, framework: framework as UiFramework,
    outputDirectory: scoped(value(flags, 'out') ?? config.paths.ui),
    ...(storybook ? { storiesDirectory: scoped(value(flags, 'stories-out') ?? config.paths.stories) } : {}),
    storybook, storiesOnly: kind === 'stories',
    ...(revisions ? { revisions } : {}),
  };
  if (planning || flags.check) {
    const result = flags.check ? await services.uiLibrary.check(directory, options) : await services.uiLibrary.plan(directory, options, planPath === undefined ? undefined : scoped(planPath));
    return { generator: kind, library: directory, ...(flags.check ? { check: true } : { plan: true }), ...result };
  }
  return { generator: kind, library: directory, ...await services.uiLibrary.generate(directory, options) };
}

/** The shared library is managed at workspace scope even while a project is open. */
export function uiCommands(services: WorkflowServices): Command[] {
  const config = services.loaded.config;
  return [{
    id: 'components', description: 'Manage and validate a shared Markdown UI component library.',
    usage: 'components [list | init | inspect <id> | validate | create <id> [--tag div] | import [--from directory] | export [--out directory]] [--library directory]',
    options: { library: 'string', from: 'string', out: 'string', tag: 'string' },
    async run(args, flags) {
      const action = args[0] ?? 'list', directory = value(flags, 'library') ?? config.paths.components;
      ensure(flags.from === undefined || action === 'import', 'INVALID_ARGUMENT', '--from requires components import.');
      ensure(flags.out === undefined || action === 'export', 'INVALID_ARGUMENT', '--out requires components export.');
      ensure(flags.tag === undefined || action === 'create', 'INVALID_ARGUMENT', '--tag requires components create.');
      const library = services.uiLibrary;
      if (action === 'list') {
        arity(args, 0, 1);
        const definitions = await library.list(directory);
        return { directory, count: definitions.length, status: definitions.length ? 'ready' : 'empty', ...(!definitions.length ? { nextStep: `Run components init --library ${directory}, or add a Markdown component definition.` } : {}), components: definitions.map(definition => ({
          id: definition.id, name: definition.name, sourcePath: definition.sourcePath,
          descriptionSummary: definition.description.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').trim() ?? '',
          propNames: Object.keys(definition.props).sort(), dependencies: componentDependencies(definition.root),
        })) };
      }
      if (action === 'init') { arity(args, 1); return { directory, ...await library.init(directory) }; }
      if (action === 'inspect') { arity(args, 2); return library.inspect(directory, args[1]!); }
      if (action === 'validate') { arity(args, 1); return library.validate(directory); }
      if (action === 'create') { arity(args, 2); return library.create(directory, args[1]!, value(flags, 'tag') ?? 'div'); }
      if (action === 'import') { arity(args, 1); return library.import(value(flags, 'from') ?? config.paths.componentImports, directory); }
      ensure(action === 'export', 'INVALID_ARGUMENT', 'Use components list, init, inspect, validate, create, import, or export.');
      arity(args, 1); return library.export(directory, value(flags, 'out') ?? config.paths.componentExports);
    },
  }];
}
