import { resolve } from 'node:path';
import metadata from '../package.json';
import { forgeError, AppError, ensure } from './domain/shared/errors.ts';
import { EventBus } from './application/plugins/events.ts';
import { registerHostEvents, type HostEventMap } from './application/plugins/host-events.ts';
import { announceLayoutReady, invokeCommand, quitInvocation } from './application/plugins/invocation.ts';
import { WorkspacePluginState } from './application/plugins/plugin-state.ts';
import { eventOutput, selectEventOutput, type EventOutput } from './application/plugins/event-output.ts';
import { NodeEventScope } from './infrastructure/plugins/event-scope.ts';
import { ClaudeLifecycle } from './application/claude/lifecycle.ts';
import { Workspace } from './application/workspace/workspace.ts';
import { ScopedFiles } from './application/workspace/scoped-files.ts';
import { Registry, type CommandContext } from './application/plugins/registry.ts';
import { ProjectService } from './application/projects/projects.ts';
import { SetupService } from './application/workspace/setup.ts';
import { UiLibrary } from './application/ui/library.ts';
import { DataSourceLibrary } from './application/data-sources/library.ts';
import { InteractionLibrary } from './application/interactions/library.ts';
import { TemplateInstaller } from './application/templates/templates.ts';
import { WorkflowSync } from './application/workflows/workflows.ts';
import { yamlWorkflowRenderer } from './infrastructure/workflows/renderer.ts';
import { NodeFiles } from './infrastructure/workspace/files.ts';
import type { LockOwner } from './infrastructure/workspace/lock.ts';
import { ObsidianDocuments } from './infrastructure/documents/codec.ts';
import { loadEnabledPlugins } from './infrastructure/plugins/loader.ts';
import { loadConfig } from './infrastructure/workspace/config.ts';
import { MarkdownTemplates } from './infrastructure/templates/markdown.ts';
import { workflowTemplates } from './infrastructure/templates/workflows.ts';
import { projectScaffold, componentScaffold } from './infrastructure/projects/scaffolds.ts';
import { readSetupArtifacts } from './infrastructure/workspace/setup-artifacts.ts';
import { generators } from './infrastructure/generation/generators.ts';
import { MarkdownUiDefinitions } from './infrastructure/ui/definitions.ts';
import { standardUiCatalog } from './infrastructure/ui/catalog.ts';
import { componentArtifact, renderUiComponents } from './infrastructure/ui/renderers.ts';
import { renderUiStories } from './infrastructure/ui/stories.ts';
import { MarkdownDataSourceDefinitions } from './infrastructure/data-sources/definitions.ts';
import { TypeScriptDataSourceRenderer } from './infrastructure/data-sources/generator.ts';
import { MarkdownInteractionDefinitions } from './infrastructure/interactions/definitions.ts';
import { builtinSkills } from './infrastructure/skills/builtin.ts';
import { parseClaudeAgent, renderClaudeAgent } from './infrastructure/claude/agents.ts';
import { claudeTarget } from './infrastructure/claude/target.ts';
import { NodeClaudeRuntime } from './infrastructure/claude/runtime.ts';
import { claudeCommand } from './presentation/claude/commands.ts';
import { Bases } from './application/bases/query.ts';
import { NodeBasesQueryEngine } from './infrastructure/bases/engine.ts';
import { VaultMetadata } from './application/metadata/vault-metadata.ts';
import { ObsidianMetadataParser } from './infrastructure/metadata/parser.ts';
import { basesCommand } from './presentation/bases/commands.ts';
import { commands } from './presentation/cli/commands.ts';
import { globalOptions, parseArguments, parseBootstrap, value } from './presentation/cli/arguments.ts';
import { invocationPolicy } from './presentation/cli/invocation-policy.ts';
import { language, Localizer } from './presentation/localization/localization.ts';

async function run(): Promise<void> {
  const tokens = process.argv.slice(2);
  const registry = new Registry(), events = new EventBus(new NodeEventScope());
  let result: Record<string, unknown>;
  let activeContext: Pick<CommandContext, 'workspaceRoot' | 'root' | 'project'> | undefined;
  let localizer = new Localizer();
  let compact = tokens.includes('--json');
  // Response event output only; listeners and replay always observe the full invocation history.
  let eventLevel: EventOutput = 'changes';
  try {
    const bootstrap = parseBootstrap(tokens);
    // The requested language applies first, so every later bootstrap failure is reported in it.
    const requestedLanguage = value(bootstrap.flags, 'lang');
    if (requestedLanguage !== undefined) localizer = new Localizer(language(requestedLanguage));
    const requestedEvents = value(bootstrap.flags, 'events');
    if (requestedEvents !== undefined) eventLevel = eventOutput(requestedEvents);
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
      if (requestedEvents !== undefined) config.settings.events = eventLevel; else eventLevel = config.settings.events;
      compact = config.settings.json;
      let lockOwner: LockOwner = {};
      const files = await NodeFiles.at(loaded.root, message => events.warn(message), () => lockOwner);
      activeContext = { workspaceRoot: files.root, root: files.root, project: null };
      registerHostEvents(events);
      // The writer lock names the routed command so WORKSPACE_BUSY can identify its holder.
      events.on<HostEventMap['command.started']>('command.started', ({ command, operationId }) => { lockOwner = { command, operationId }; });
      let environment: Workspace;
      for (const generator of generators) registry.add(registry.generators, generator);
      for (const skill of builtinSkills) registry.add(registry.skills, skill);
      for (const command of commands(registry, {
        loaded, files, templates: new MarkdownTemplates(),
        get projects() { return new ProjectService(files, environment, config.paths.projects, { project: projectScaffold, component: componentScaffold }, events); },
        get dataSources() { return new DataSourceLibrary(environment, new MarkdownDataSourceDefinitions(), new TypeScriptDataSourceRenderer()); },
        get interactions() { return new InteractionLibrary(environment, new MarkdownInteractionDefinitions()); },
        get workflows() { return new WorkflowSync(environment, this.projects, yamlWorkflowRenderer); },
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
      registry.add(registry.commands, claudeCommand({ agentCodec: { parse: parseClaudeAgent, render: renderClaudeAgent }, target: claudeTarget }));
      registry.add(registry.commands, basesCommand(async context => new Bases(new NodeBasesQueryEngine(await NodeFiles.at(context.root), context.workspace.codec, () => context.metadata.load()))));
      if (!bootstrap.flags['no-plugins']) await loadEnabledPlugins('bin/plugins', config.plugins.enabled, files, registry, events);
      await registry.publishRegistered(events);
      const id = bootstrap.args[0] ?? 'help';
      const command = registry.commands.get(id);
      ensure(command, 'UNKNOWN_COMMAND', `Unknown command ${id}. Run help or schema.`);
      const parsed = parseArguments(tokens, { ...globalOptions, ...command.options });
      const parsedLanguage = value(parsed.flags, 'lang');
      if (parsedLanguage !== undefined) localizer = new Localizer(language(parsedLanguage));
      config.settings.language = localizer.language;
      const parsedEvents = value(parsed.flags, 'events');
      if (parsedEvents !== undefined) eventLevel = config.settings.events = eventOutput(parsedEvents);
      for (const [commandId, registered] of registry.commands) registry.commands.set(commandId, localizer.command(registered));
      ensure(!parsed.flags.version, 'INVALID_ARGUMENT', '--version must be used without a command.');
      for (const option of ['root', 'no-plugins']) ensure(parsed.flags[option] === bootstrap.flags[option], 'INVALID_ARGUMENT', `--${option} must precede the command.`);
      config.settings.json = parsed.flags['no-json'] ? false : parsed.flags.json ? true : config.settings.json;
      config.settings.dryRun = parsed.flags['no-dry-run'] ? false : parsed.flags['dry-run'] ? true : config.settings.dryRun;
      compact = config.settings.json;
      environment = new Workspace(files, new ObsidianDocuments(), events, config.settings.dryRun, files.root);
      const policy = invocationPolicy(id, parsed.args.slice(1), parsed.flags);
      const projects = new ProjectService(files, environment, config.paths.projects, { project: projectScaffold, component: componentScaffold }, events);
      const project = policy.scope === 'workspace' ? null : policy.requestedProject !== undefined ? await projects.inspect(policy.requestedProject) : await projects.current();
      const workspace = project ? environment.within(new ScopedFiles(files, project.directory), resolve(files.root, project.directory)) : environment;
      activeContext = { workspaceRoot: files.root, root: project ? resolve(files.root, project.directory) : files.root, project };
      const claude = new ClaudeLifecycle(executable => new NodeClaudeRuntime({ executable }), { cwd: activeContext.root, dryRun: workspace.dryRun }, events);
      const vaultMetadata = new VaultMetadata(workspace.files, new ObsidianMetadataParser(workspace.codec));
      // Committed writes keep a loaded cache current; before the first load an update does nothing.
      for (const id of ['vault.create', 'vault.modify', 'vault.delete'] as const) events.on<HostEventMap[typeof id]>(id, async change => { if (change.kind === 'file') await vaultMetadata.update([change]); });
      const context: CommandContext = { workspace, events, claude, metadata: vaultMetadata, ...activeContext, input: async () => {
        ensure(!process.stdin.isTTY, 'INPUT_REQUIRED', '--stdin needs piped input.');
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
        return Buffer.concat(chunks);
      } };
      const commandId = parsed.flags.help ? 'help' : id;
      const data = await invokeCommand(events, {
        command: commandId, root: context.root, workspaceRoot: context.workspaceRoot, dryRun: workspace.dryRun,
      }, async () => {
        if (!policy.activatePlugins) return;
        // First-activation and settings state lives in workspace data; --no-plugins leaves it untouched.
        await registry.activate(events, context, bootstrap.flags['no-plugins'] ? undefined : new WorkspacePluginState(environment, message => events.warn(message)));
        await announceLayoutReady(events);
      }, async () => {
        const output = parsed.flags.help
          ? await registry.commands.get('help')!.run(id === 'help' ? [] : [id], {}, context)
          : await command.run(parsed.args.slice(1), parsed.flags, context);
        return localizer.result(commandId, output);
      });
      result = { ok: true, data };
    }
  } catch (error) {
    process.exitCode = error instanceof AppError ? error.exitCode : 1;
    result = { ok: false, error: localizer.error(error) };
  } finally {
    await quitInvocation(events);
    await registry.dispose(events);
  }
  try { process.stdout.write(JSON.stringify({ ...result, ...(activeContext ? { context: activeContext } : {}), events: selectEventOutput(events.history, eventLevel), warnings: events.warnings }, null, compact ? undefined : 2) + '\n'); }
  catch {
    process.exitCode = 1;
    // Keep committed change evidence even if a plugin command returns invalid data.
    process.stdout.write(JSON.stringify({ ok: false, error: localizer.error(forgeError('INVALID_RESULT', 'Command returned non-serializable data. Inspect committed events before retrying.')), ...(activeContext ? { context: activeContext } : {}), events: selectEventOutput(events.history, eventLevel), warnings: events.warnings }) + '\n');
  }
}
void run();
