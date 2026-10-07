import { AppError, ensure, isRecord } from '../domain/errors.ts';
import { vaultPath } from '../domain/file.ts';
import type { Command, CommandContext } from '../application/plugins.ts';
import { parseJson, type WorkflowServices } from './workflow-commands.ts';
import { arity, value } from './arguments.ts';

export const dataSourceGenerationOptions = { 'test-data-out': 'string' } as const;

export async function makeDataSource(id: string, flags: Record<string, string | boolean>, context: CommandContext, services: WorkflowServices) {
  const config = services.loaded.config;
  const scoped = (path: string) => {
    const relative = vaultPath(path);
    return context.project ? `${context.project.directory}/${relative}` : relative;
  };
  const directory = value(flags, 'library') ?? config.paths.dataSources;
  const revisionsPath = value(flags, 'revisions-from'), planPath = value(flags, 'plan-out');
  const planning = flags.plan === true || planPath !== undefined;
  ensure(!(planning && flags.check), 'INVALID_ARGUMENT', 'Choose --plan/--plan-out or --check.');
  ensure(!(revisionsPath !== undefined && (planning || flags.check)), 'INVALID_ARGUMENT', 'Planning and checks do not accept --revisions-from. Review a plan before authorizing regeneration.');
  let revisions: Record<string, string> | undefined;
  if (revisionsPath !== undefined) {
    const parsed = parseJson(new TextDecoder('utf-8', { fatal: true }).decode((await context.workspace.files.read(revisionsPath)).bytes));
    ensure(isRecord(parsed) && Object.values(parsed).every(revision => typeof revision === 'string' && /^[a-f0-9]{64}$/.test(revision)), 'INVALID_INPUT', '--revisions-from must map generated workspace paths to SHA-256 revisions.');
    revisions = parsed as Record<string, string>;
  }
  const options = {
    source: id, outputDirectory: scoped(value(flags, 'out') ?? config.paths.dataGenerated),
    testDataDirectory: scoped(value(flags, 'test-data-out') ?? config.paths.dataFixtures),
    ...(revisions ? { revisions } : {}),
  };
  if (planning || flags.check) {
    const result = await services.dataSources.plan(directory, options, planPath === undefined ? undefined : scoped(planPath));
    if (flags.check && !result.matches) throw new AppError('DATA_SOURCE_DRIFT', 'Generated adapter or test data is missing or differs from its definition. Run the same command with --plan to review changes.', 5, { outputs: result.outputs.map(({ path, status }) => ({ path, status })) });
    return { generator: 'data-source', library: directory, ...(flags.check ? { check: true } : { plan: true }), ...result };
  }
  return { generator: 'data-source', library: directory, ...await services.dataSources.generate(directory, options) };
}

/** Definition files are shared at workspace scope; adapters and fixtures follow the selected project. */
export function dataSourceCommands(services: WorkflowServices): Command[] {
  const config = services.loaded.config;
  return [{
    id: 'data-sources', description: 'Manage Markdown REST/local-JSON definitions for typed adapters and deterministic test data.',
    usage: 'data-sources [list | init | inspect <id> | validate | create <id> [--kind rest|json] | import [--from directory] | export [--out directory]] [--library directory]',
    options: { library: 'string', from: 'string', out: 'string', kind: 'string' },
    async run(args, flags) {
      const action = args[0] ?? 'list', directory = value(flags, 'library') ?? config.paths.dataSources;
      ensure(flags.from === undefined || action === 'import', 'INVALID_ARGUMENT', '--from requires data-sources import.');
      ensure(flags.out === undefined || action === 'export', 'INVALID_ARGUMENT', '--out requires data-sources export.');
      ensure(flags.kind === undefined || action === 'create', 'INVALID_ARGUMENT', '--kind requires data-sources create.');
      const library = services.dataSources;
      if (action === 'list') {
        arity(args, 0, 1);
        const definitions = await library.list(directory);
        return { directory, count: definitions.length, status: definitions.length ? 'ready' : 'empty',
          ...(!definitions.length ? { nextStep: `Run data-sources init --library ${directory}, or add a Markdown data-source definition.` } : {}),
          sources: definitions.map(definition => ({ id: definition.id, kind: definition.kind, model: definition.model.name, sourcePath: definition.sourcePath, fields: Object.keys(definition.model.fields).sort() })) };
      }
      if (action === 'init') { arity(args, 1); return { directory, ...await library.init(directory) }; }
      if (action === 'inspect') { arity(args, 2); return library.inspect(directory, args[1]!); }
      if (action === 'validate') { arity(args, 1); return library.validate(directory); }
      if (action === 'create') {
        arity(args, 2); const kind = value(flags, 'kind') ?? 'rest';
        ensure(kind === 'rest' || kind === 'json', 'INVALID_ARGUMENT', '--kind must be rest or json.');
        return library.create(directory, args[1]!, kind);
      }
      if (action === 'import') { arity(args, 1); return library.import(value(flags, 'from') ?? config.paths.dataImports, directory); }
      ensure(action === 'export', 'INVALID_ARGUMENT', 'Use data-sources list, init, inspect, validate, create, import, or export.');
      arity(args, 1); return library.export(directory, value(flags, 'out') ?? config.paths.dataExports);
    },
  }];
}
