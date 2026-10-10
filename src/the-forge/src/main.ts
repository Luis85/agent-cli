import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import metadata from '../package.json';
import { forgeError, AppError, ensure } from './domain/shared/errors.ts';
import { EventBus } from './application/plugins/events.ts';
import { registerHostEvents, type HostEventMap } from './application/plugins/host-events.ts';
import { announceLayoutReady, invokeCommand, quitInvocation } from './application/plugins/invocation.ts';
import { WorkspacePluginState } from './application/plugins/plugin-state.ts';
import { eventOutput, selectEventOutput, type EventOutput } from './application/plugins/event-output.ts';
import { NodeEventScope } from './infrastructure/plugins/event-scope.ts';
import { Workspace } from './application/workspace/workspace.ts';
import { ScopedFiles, scopedCommitObserver } from './application/workspace/scoped-files.ts';
import type { CommitObserver } from './application/workspace/ports.ts';
import { Registry, type CommandContext } from './application/plugins/registry.ts';
import { ProjectService, projectScaffolderService, type ProjectScaffolder, type ProjectScaffolderLookup } from './application/projects/projects.ts';
import { SetupService, templateInstallerService, type TemplateInstallerService } from './application/workspace/setup.ts';
import { WorkflowSync } from './application/workflows/workflows.ts';
import { yamlWorkflowRenderer } from './infrastructure/workflows/renderer.ts';
import { NodeFiles } from './infrastructure/workspace/files.ts';
import { nodeFileDates } from './infrastructure/workspace/file-dates.ts';
import type { LockOwner } from './infrastructure/workspace/lock.ts';
import { ObsidianDocuments } from './infrastructure/documents/codec.ts';
import { installedPlugins, loadEnabledPlugins } from './infrastructure/plugins/loader.ts';
import { registerCorePlugins, registrySkills } from './application/plugins/core-plugins.ts';
import { commandOptions, hasActionOptions, optionTypes } from './application/plugins/command-metadata.ts';
import { globalOptions, value } from './application/plugins/command-input.ts';
import { basesPlugin } from './plugins/bases/plugin.ts';
import { skillsPlugin } from './plugins/skills/plugin.ts';
import { searchPlugin } from './plugins/search/plugin.ts';
import { linksPlugin } from './plugins/links/plugin.ts';
import { agentsPlugin } from './plugins/agents/plugin.ts';
import { backlogPlugin } from './plugins/backlog/plugin.ts';
import { templatesPlugin } from './plugins/templates/plugin.ts';
import { scaffoldsPlugin } from './plugins/scaffolds/plugin.ts';
import { uiPlugin } from './plugins/ui/plugin.ts';
import { dataSourcesPlugin } from './plugins/data-sources/plugin.ts';
import { claudePlugin } from './plugins/claude/plugin.ts';
import type { WorkflowServices } from './presentation/cli/services.ts';
import { loadConfig } from './infrastructure/workspace/config.ts';
import { readSetupArtifacts } from './infrastructure/workspace/setup-artifacts.ts';
import { VaultMetadata } from './application/metadata/vault-metadata.ts';
import { MetadataCacheEvents } from './application/metadata/cache-events.ts';
import { ObsidianMetadataParser } from './infrastructure/metadata/parser.ts';
import { createApp } from './application/vault/app.ts';
import { commands } from './presentation/cli/commands.ts';
import { parseArguments, parseBootstrap } from './presentation/cli/arguments.ts';
import { invocationPolicy } from './presentation/cli/invocation-policy.ts';
import { language, Localizer } from './presentation/localization/localization.ts';

/** Bundled core plugins in registration order; each `src/plugins/<id>/plugin.ts` wires its own layers. */
const corePlugins = [templatesPlugin, scaffoldsPlugin, uiPlugin, dataSourcesPlugin, claudePlugin, basesPlugin, skillsPlugin, searchPlugin, linksPlugin, agentsPlugin, backlogPlugin];

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
      const skipUserPlugins = bootstrap.flags['no-plugins'] === true;
      // Project files come from the scaffolds core plugin; project scope management stays in the kernel.
      const scaffolder: ProjectScaffolderLookup = action => registry.requireService<ProjectScaffolder>(projectScaffolderService, `project ${action}`);
      const services: WorkflowServices = {
        loaded, files,
        get projects() { return new ProjectService(files, environment, config.paths.projects, scaffolder, events); },
        get workflows() { return new WorkflowSync(environment, this.projects, yamlWorkflowRenderer); },
        setup: async () => {
          // The templates core plugin provides the starter templates; without it, setup installs none and says so.
          const templates = registry.service<TemplateInstallerService>(templateInstallerService);
          if (templates === undefined) events.warn('The templates core plugin is disabled or unavailable; setup did not install templates into bin/templates.');
          return new SetupService(environment, config, await readSetupArtifacts(__dirname), [...registry.skills.values()], templates?.setupTemplates() ?? null).run();
        },
        configSections: () => registry.settings.sections(),
        installedPlugins: () => installedPlugins('bin/plugins', config.plugins.enabled, skipUserPlugins, files, message => events.warn(message)),
      };
      for (const command of commands(registry, services)) registry.add(registry.commands, command);
      // Bundled core plugins register in bundle order before user plugins; --no-plugins skips only user plugins.
      registerCorePlugins(registry, events, corePlugins, {
        skills: registrySkills(registry), fileDates: nodeFileDates,
        openFiles: (root, warn) => NodeFiles.at(root, warn), operationId: () => events.nextOperationId(),
      }, config.plugins.disabled);
      if (!skipUserPlugins) await loadEnabledPlugins('bin/plugins', config.plugins.enabled, files, registry, events);
      config.plugins.settings = await registry.configure(config.plugins.settings, async () => (await services.installedPlugins()).map(entry => entry.manifest.id), message => events.warn(message));
      await registry.publishRegistered(events);
      const id = bootstrap.args[0] ?? 'help';
      const command = registry.resolveCommand(id);
      // An action's own options (make <generator>) parse only once the action is known: the first argument after
      // the command id, unless an option precedes it.
      const actionArgs = hasActionOptions(command) ? parseArguments(tokens, { ...globalOptions, ...optionTypes(command.options) }, true).args.slice(1) : [];
      const parsed = parseArguments(tokens, { ...globalOptions, ...optionTypes(commandOptions(command, actionArgs)) });
      const parsedLanguage = value(parsed.flags, 'lang');
      // From here on, plugin-contributed strings and error catalog entries localize responses too.
      localizer = new Localizer(parsedLanguage !== undefined ? language(parsedLanguage) : localizer.language, registry.catalog);
      config.settings.language = localizer.language;
      const parsedEvents = value(parsed.flags, 'events');
      if (parsedEvents !== undefined) eventLevel = config.settings.events = eventOutput(parsedEvents);
      for (const [commandId, registered] of registry.commands) registry.commands.set(commandId, localizer.command(registered));
      ensure(!parsed.flags.version, 'INVALID_ARGUMENT', '--version must be used without a command.');
      for (const option of ['root', 'no-plugins']) ensure(parsed.flags[option] === bootstrap.flags[option], 'INVALID_ARGUMENT', `--${option} must precede the command.`);
      config.settings.json = parsed.flags['no-json'] ? false : parsed.flags.json ? true : config.settings.json;
      config.settings.dryRun = parsed.flags['no-dry-run'] ? false : parsed.flags['dry-run'] ? true : config.settings.dryRun;
      compact = config.settings.json;
      // Environment commits reach the metadata index once the command's scope binds it below.
      let metadataCommits: CommitObserver | undefined;
      environment = new Workspace(files, new ObsidianDocuments(), events, config.settings.dryRun, files.root, { committed: async changes => { await metadataCommits?.committed(changes); } });
      const policy = invocationPolicy(command, parsed.args.slice(1), parsed.flags);
      const projects = new ProjectService(files, environment, config.paths.projects, scaffolder, events);
      const project = policy.scope === 'workspace' ? null : policy.requestedProject !== undefined ? await projects.inspect(policy.requestedProject) : await projects.current();
      const scopedFiles = project ? new ScopedFiles(files, project.directory) : files;
      const vaultMetadata = new VaultMetadata(scopedFiles, new ObsidianMetadataParser(environment.codec), { workspaceRoot: project === null });
      // Commits keep a loaded cache current and publish metadataCache.* events; workspace-scope commits while a
      // project is selected reach the project's index only inside its directory, with project-relative paths.
      const metadataEvents = new MetadataCacheEvents(events, vaultMetadata);
      metadataCommits = project ? scopedCommitObserver(metadataEvents, project.directory) : metadataEvents;
      const workspace = project ? environment.within(scopedFiles, resolve(files.root, project.directory), metadataEvents) : environment;
      activeContext = { workspaceRoot: files.root, root: project ? resolve(files.root, project.directory) : files.root, project };
      const app = createApp({ workspace, metadata: vaultMetadata, events, project });
      const context: CommandContext = { workspace, environment, events, metadata: vaultMetadata, app, ...activeContext, language: localizer.language, input: async () => {
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
        // First-activation and settings state lives in workspace data; --no-plugins leaves it untouched. The settings
        // revision is the SHA-256 of the plugin's canonical effective section, so an edited section calls onExternalSettingsChange.
        const settingsRevision = async (pluginId: string) => {
          const canonical = registry.settings.canonical(pluginId);
          return canonical === null ? null : createHash('sha256').update(canonical).digest('hex');
        };
        await registry.activate(events, context, skipUserPlugins ? undefined : new WorkspacePluginState(environment, message => events.warn(message), settingsRevision));
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
    // Plugin failures were already mapped by their owner's wrapper; codes reaching here unmapped stay opaque.
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
