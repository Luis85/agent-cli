import { resolve } from 'node:path';
import metadata from '../package.json';
import { AppError, ensure, isRecord } from './domain/errors.ts';
import { EventBus } from './application/events.ts';
import { Workspace } from './application/workspace.ts';
import { ScopedFiles } from './application/scoped-files.ts';
import { Registry, type CommandContext } from './application/plugins.ts';
import { ProjectService } from './application/projects.ts';
import { SetupService } from './application/setup.ts';
import { UiLibrary } from './application/ui.ts';
import { DataSourceLibrary } from './application/data-sources.ts';
import { InteractionLibrary } from './application/interactions.ts';
import { TemplateInstaller } from './application/templates.ts';
import { NodeFiles } from './infrastructure/files.ts';
import { ObsidianDocuments } from './infrastructure/documents.ts';
import { loadEnabledPlugins } from './infrastructure/plugins.ts';
import { loadConfig } from './infrastructure/config.ts';
import { MarkdownTemplates } from './infrastructure/templates.ts';
import { workflowTemplates } from './infrastructure/workflow-templates.ts';
import { projectScaffold, componentScaffold } from './infrastructure/project-scaffolds.ts';
import { readSetupArtifacts } from './infrastructure/setup-artifacts.ts';
import { generators } from './infrastructure/generators.ts';
import { MarkdownUiDefinitions } from './infrastructure/ui-definitions.ts';
import { standardUiCatalog } from './infrastructure/ui-catalog.ts';
import { componentArtifact, renderUiComponents } from './infrastructure/ui-renderers.ts';
import { renderUiStories } from './infrastructure/ui-stories.ts';
import { MarkdownDataSourceDefinitions } from './infrastructure/data-source-definitions.ts';
import { TypeScriptDataSourceRenderer } from './infrastructure/data-source-generator.ts';
import { MarkdownInteractionDefinitions } from './infrastructure/interaction-definitions.ts';
import { builtinSkills } from './infrastructure/skills.ts';
import { commands } from './presentation/commands.ts';
import { globalOptions, parseArguments, parseBootstrap, value } from './presentation/arguments.ts';
import { language, Localizer } from './presentation/localization.ts';

async function run(): Promise<void> {
  const tokens = process.argv.slice(2);
  const registry = new Registry(), events = new EventBus();
  let result: Record<string, unknown>;
  let activeContext: Pick<CommandContext, 'workspaceRoot' | 'root' | 'project'> | undefined;
  let localizer = new Localizer();
  let compact = tokens.includes('--json');
  try {
    const bootstrap = parseBootstrap(tokens);
    const requestedLanguage = value(bootstrap.flags, 'lang');
    if (requestedLanguage !== undefined) localizer = new Localizer(language(requestedLanguage));
    if (bootstrap.flags.version) {
      const parsed = parseArguments(tokens, globalOptions);
      ensure(parsed.args.length === 0, 'INVALID_ARGUMENT', '--version does not accept a command.');
      result = { ok: true, data: { name: 'The Forge', version: metadata.version, apiVersion: 1 } };
    } else {
      const loaded = await loadConfig({ defaultPath: resolve(__dirname, 'config.json'), cwd: process.cwd(), root: value(bootstrap.flags, 'root') });
      const config = loaded.config;
      localizer = new Localizer(requestedLanguage !== undefined ? language(requestedLanguage) : config.settings.language);
      config.settings.language = localizer.language;
      config.settings.json = bootstrap.flags['no-json'] ? false : bootstrap.flags.json ? true : config.settings.json;
      config.settings.dryRun = bootstrap.flags['no-dry-run'] ? false : bootstrap.flags['dry-run'] ? true : config.settings.dryRun;
      compact = config.settings.json;
      const files = await NodeFiles.at(loaded.root, message => events.warn(message));
      activeContext = { workspaceRoot: files.root, root: files.root, project: null };
      for (const id of ['file.created', 'file.updated']) events.define({ id, validate: (v): v is Record<string, unknown> => isRecord(v) && typeof v.path === 'string' && typeof v.revision === 'string' && typeof v.bytes === 'number' && v.operation === id.slice(5) });
      let environment: Workspace;
      for (const generator of generators) registry.add(registry.generators, generator);
      for (const skill of builtinSkills) registry.add(registry.skills, skill);
      for (const command of commands(registry, {
        loaded, files, templates: new MarkdownTemplates(),
        get projects() { return new ProjectService(files, environment, config.paths.projects, { project: projectScaffold, component: componentScaffold }); },
        get dataSources() { return new DataSourceLibrary(environment, new MarkdownDataSourceDefinitions(), new TypeScriptDataSourceRenderer()); },
        get interactions() { return new InteractionLibrary(environment, new MarkdownInteractionDefinitions()); },
        get uiLibrary() { return new UiLibrary(environment, new MarkdownUiDefinitions(), standardUiCatalog, {
          componentPaths: (definitions, options) => definitions.map(definition => `${options.outputDirectory}/${componentArtifact(definition, options.framework).fileName}`),
          generate: (definitions, options) => [
            ...(options.storiesOnly ? [] : renderUiComponents(definitions, options.framework, options.outputDirectory, options.interactions)),
            ...(options.storybook ? renderUiStories(definitions, options.framework, options.outputDirectory, options.storiesDirectory!) : []),
          ],
        }, new InteractionLibrary(environment, new MarkdownInteractionDefinitions()), config.paths.interactions); },
        installTemplates: () => new TemplateInstaller(environment, workflowTemplates).install(),
        setup: async () => new SetupService(environment, config, await readSetupArtifacts(__dirname), [...registry.skills.values()], workflowTemplates).run(),
      })) registry.add(registry.commands, command);
      if (!bootstrap.flags['no-plugins']) await loadEnabledPlugins('bin/plugins', config.plugins.enabled, files, registry, events);
      const id = bootstrap.args[0] ?? 'help';
      const command = registry.commands.get(id);
      ensure(command, 'UNKNOWN_COMMAND', `Unknown command ${id}. Run help or schema.`);
      const parsed = parseArguments(tokens, { ...globalOptions, ...command.options });
      const parsedLanguage = value(parsed.flags, 'lang');
      if (parsedLanguage !== undefined) localizer = new Localizer(language(parsedLanguage));
      config.settings.language = localizer.language;
      for (const [commandId, registered] of registry.commands) registry.commands.set(commandId, localizer.command(registered));
      ensure(!parsed.flags.version, 'INVALID_ARGUMENT', '--version must be used without a command.');
      for (const option of ['root', 'no-plugins']) ensure(parsed.flags[option] === bootstrap.flags[option], 'INVALID_ARGUMENT', `--${option} must precede the command.`);
      config.settings.json = parsed.flags['no-json'] ? false : parsed.flags.json ? true : config.settings.json;
      config.settings.dryRun = parsed.flags['no-dry-run'] ? false : parsed.flags['dry-run'] ? true : config.settings.dryRun;
      compact = config.settings.json;
      environment = new Workspace(files, new ObsidianDocuments(), events, config.settings.dryRun);
      // Management and recovery remain available even if saved project context is stale.
      const environmentCommand = parsed.flags.help || ['help', 'schema', 'config', 'formats', 'events', 'plugins', 'setup', 'project', 'templates', 'components', 'data-sources', 'interactions'].includes(id) || (id === 'make' && (parsed.args.length === 1 || parsed.args[1] === 'plugin')) || (id === 'skills' && parsed.args[1] !== 'install');
      const projects = new ProjectService(files, environment, config.paths.projects, { project: projectScaffold, component: componentScaffold });
      const requestedProject = id === 'make' && ['ui', 'stories', 'data-source'].includes(parsed.args[1] ?? '') ? value(parsed.flags, 'project') : undefined;
      const project = environmentCommand ? null : requestedProject !== undefined ? await projects.inspect(requestedProject) : await projects.current();
      const workspace = project ? new Workspace(new ScopedFiles(files, project.directory), environment.codec, events, config.settings.dryRun) : environment;
      activeContext = { workspaceRoot: files.root, root: project ? resolve(files.root, project.directory) : files.root, project };
      const context: CommandContext = { workspace, events, ...activeContext, input: async () => {
        ensure(!process.stdin.isTTY, 'INPUT_REQUIRED', '--stdin needs piped input.');
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
        return Buffer.concat(chunks);
      } };
      // Discovery and setup do not need plugin activation or its side effects.
      if (!parsed.flags.help && !['help', 'schema', 'config', 'formats', 'events', 'plugins', 'setup'].includes(id)) await registry.activate(context);
      const data = parsed.flags.help
        ? await registry.commands.get('help')!.run(id === 'help' ? [] : [id], {}, context)
        : await command.run(parsed.args.slice(1), parsed.flags, context);
      result = { ok: true, data: localizer.result(parsed.flags.help ? 'help' : id, data) };
    }
  } catch (error) {
    process.exitCode = error instanceof AppError ? error.exitCode : 1;
    result = { ok: false, error: localizer.error(error) };
  } finally { await registry.dispose(events); }
  try { process.stdout.write(JSON.stringify({ ...result, ...(activeContext ? { context: activeContext } : {}), events: events.history, warnings: events.warnings }, null, compact ? undefined : 2) + '\n'); }
  catch {
    process.exitCode = 1;
    // Keep committed change evidence even if a plugin command returns invalid data.
    process.stdout.write(JSON.stringify({ ok: false, error: localizer.error(new AppError('INVALID_RESULT', 'Command returned non-serializable data. Inspect committed events before retrying.')), ...(activeContext ? { context: activeContext } : {}), events: events.history, warnings: events.warnings }) + '\n');
  }
}
void run();
