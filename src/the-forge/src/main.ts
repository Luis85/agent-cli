import { standardOutput } from './infrastructure/cli/standard-output.ts';
import { standardInput } from './infrastructure/cli/standard-input.ts';
import { workingDirectoryOutside } from './infrastructure/workspace/working-directory.ts';
import { NodeServerController } from './infrastructure/server/controller.ts';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import metadata from '../package.json';
import { forgeError, AppError, ensure, errorMessage } from './domain/shared/errors.ts';
import { EventBus } from './application/plugins/events.ts';
import { registerHostEvents, type HostEventMap } from './application/plugins/host-events.ts';
import { announceLayoutReady, invokeCommand, quitInvocation } from './application/plugins/invocation.ts';
import { WorkspacePluginState } from './application/plugins/plugin-state.ts';
import { eventOutput, selectEventOutput } from './application/plugins/event-output.ts';
import { NodeEventScope } from './infrastructure/plugins/event-scope.ts';
import { Workspace } from './application/workspace/workspace.ts';
import { ScopedFiles, scopedCommitObserver } from './application/workspace/scoped-files.ts';
import type { CommitObserver } from './application/workspace/ports.ts';
import { Registry, type CommandContext } from './application/plugins/registry.ts';
import { skillFrontmatter } from './infrastructure/plugins/skill-frontmatter.ts';
import { ProjectService, projectScaffolderService, type ProjectScaffolder, type ProjectScaffolderLookup } from './application/projects/projects.ts';
import { SetupService, templateInstallerService, type TemplateInstallerService } from './application/workspace/setup.ts';
import { WorkflowSync } from './application/workflows/workflows.ts';
import { yamlWorkflowRenderer } from './infrastructure/workflows/renderer.ts';
import { NodeFiles, revisionOf, stampedFiles } from './infrastructure/workspace/files.ts';
import { nodeFileDates } from './infrastructure/workspace/file-dates.ts';
import type { LockOwner } from './infrastructure/workspace/lock.ts';
import { ObsidianDocuments } from './infrastructure/documents/codec.ts';
import { installedPlugins, loadEnabledPlugins, recordMissingPlugins } from './infrastructure/plugins/loader.ts';
import { registerCorePlugins, registrySkills } from './application/plugins/core-plugins.ts';
import { commandOptions } from './application/plugins/command-metadata.ts';
import { globalOptions, value, waitBudget } from './application/plugins/command-input.ts';
import { basesPlugin } from './plugins/bases/plugin.ts';
import { skillsPlugin } from './plugins/skills/plugin.ts';
import { searchPlugin } from './plugins/search/plugin.ts';
import { linksPlugin } from './plugins/links/plugin.ts';
import { vaultCheckPlugin } from './plugins/vault-check/plugin.ts';
import { agentsPlugin } from './plugins/agents/plugin.ts';
import { backlogPlugin } from './plugins/backlog/plugin.ts';
import { templatesPlugin } from './plugins/templates/plugin.ts';
import { scaffoldsPlugin } from './plugins/scaffolds/plugin.ts';
import { uiPlugin } from './plugins/ui/plugin.ts';
import { dataSourcesPlugin } from './plugins/data-sources/plugin.ts';
import { claudePlugin } from './plugins/claude/plugin.ts';
import { connectorPlugin } from './plugins/connector/plugin.ts';
import { azureDevOpsPlugin } from './plugins/connector-azure-devops/plugin.ts';
import { webviewsPlugin } from './plugins/webviews/plugin.ts';
import { browserPlugin } from './plugins/browser/plugin.ts';
import { updatesPlugin } from './plugins/updates/plugin.ts';
import distributionPolicy from '../configs/distribution-policy.json';
import { nodeLockFiles } from './infrastructure/workspace/lock-files.ts';
import { FetchHttpClient } from './infrastructure/connectors/http-client.ts';
import type { WorkflowServices } from './presentation/cli/services.ts';
import { loadConfig } from './infrastructure/workspace/config.ts';
import { readSetupArtifacts } from './infrastructure/workspace/setup-artifacts.ts';
import { VaultMetadata } from './application/metadata/vault-metadata.ts';
import { MetadataCacheEvents } from './application/metadata/cache-events.ts';
import { ObsidianMetadataParser, metadataParserVersion } from './infrastructure/metadata/parser.ts';
import { NodeMetadataSnapshotStore, snapshotFile } from './infrastructure/metadata/snapshot-store.ts';
import { createApp } from './application/vault/app.ts';
import { commands } from './presentation/cli/commands.ts';
import { declaredValues, parseArguments, parseBootstrap, parseCommand } from './presentation/cli/arguments.ts';
import { bootstrapSettings, configuredSettings, flagSetting, requestedEvents, requestedLanguage } from './presentation/cli/invocation-settings.ts';
import { responseDocument, type InvocationResponse } from './presentation/cli/response.ts';
import { forgeIdentity } from './presentation/cli/identity.ts';
import { invocationPolicy } from './presentation/cli/invocation-policy.ts';
import { normalizedPathInputs } from './presentation/cli/path-inputs.ts';
import { runCommand } from './presentation/cli/guidance.ts';
import { Localizer } from './presentation/localization/localization.ts';
import { kernelMessage, type KernelMessage } from './domain/shared/kernel-messages.ts';

/** Bundled core plugins in registration order; each `src/plugins/<id>/plugin.ts` wires its own layers. */
const corePlugins = [
  templatesPlugin, scaffoldsPlugin, uiPlugin, dataSourcesPlugin, claudePlugin,
  basesPlugin, skillsPlugin, searchPlugin, linksPlugin, vaultCheckPlugin, agentsPlugin, connectorPlugin, azureDevOpsPlugin, backlogPlugin, webviewsPlugin, browserPlugin(__dirname), updatesPlugin(distributionPolicy),
];

async function run(): Promise<void> {
  const tokens = process.argv.slice(2);
  const registry = new Registry(skillFrontmatter, metadata.version), events = new EventBus(new NodeEventScope());
  let result: InvocationResponse['result'];
  let activeContext: Pick<CommandContext, 'workspaceRoot' | 'root' | 'project'> | undefined;
  // Bootstrap failures format and localize with what the tokens state; the configuration and complete parse refine it.
  let settings = bootstrapSettings(tokens, {});
  // Hints name the invoked command once it is resolved.
  let invoked: string | undefined;
  const localizer = () => new Localizer(settings.language, registry.catalog, invoked);
  // Stores the scope index's parse results once the command finished, if it loaded the index.
  let persistMetadata: (() => Promise<void>) | undefined;
  try {
    const bootstrap = parseBootstrap(tokens);
    settings = bootstrapSettings(tokens, bootstrap.flags);
    if (bootstrap.flags.version) {
      const prefixEvents = value(bootstrap.flags, 'events');
      if (prefixEvents !== undefined) eventOutput(prefixEvents);
      const parsed = parseArguments(tokens, globalOptions);
      ensure(parsed.args.length === 0, 'INVALID_ARGUMENT', '--version does not accept a command.');
      result = { ok: true, data: { ...forgeIdentity } };
    } else {
      // --root wins over FORGE_ROOT; without either, the workspace is the one containing this distribution.
      const requestedRoot = value(bootstrap.flags, 'root') ?? (process.env.FORGE_ROOT || undefined);
      const loaded = await loadConfig({ defaultPath: resolve(__dirname, 'config.json'), cwd: process.cwd(), root: requestedRoot });
      const config = loaded.config;
      settings = Object.assign(config.settings, configuredSettings(config.settings, settings, tokens, bootstrap.flags));
      let lockOwner: LockOwner = {}, lockWait = 0;
      // A stale lock an acquisition removed is reported in the invocation's language.
      const warn = (message: KernelMessage) => events.warn(message);
      const files = await NodeFiles.at(loaded.root, warn, () => lockOwner, () => lockWait);
      activeContext = { workspaceRoot: files.root, root: files.root, project: null };
      registerHostEvents(events);
      const outside = await workingDirectoryOutside(files.root, process.cwd());
      if (outside !== undefined) warn(kernelMessage('CWD_OUTSIDE_WORKSPACE', { cwd: outside, workspaceRoot: files.root }));
      // The writer lock names the routed command so WORKSPACE_BUSY can identify its holder.
      events.on<HostEventMap['command.started']>('command.started', ({ command, operationId }) => { lockOwner = { command, operationId }; });
      let environment: Workspace;
      let projects: ProjectService | undefined;
      const skipUserPlugins = bootstrap.flags['no-plugins'] === true;
      // Project files come from the scaffolds core plugin; project scope management stays in the kernel.
      const scaffolder: ProjectScaffolderLookup = action => registry.requireService<ProjectScaffolder>(projectScaffolderService, `project ${action}`);
      const services: WorkflowServices = {
        loaded, files,
        server: new NodeServerController({ workspaceRoot: files.root, distributionPath: __dirname, version: metadata.version }),
        get projects() { return projects ??= new ProjectService(files, environment, config.paths.projects, scaffolder, events); },
        get workflows() { return new WorkflowSync(environment, this.projects, yamlWorkflowRenderer); },
        setup: async () => {
          // The templates core plugin provides the starter templates; without it, setup installs none and says so.
          const templates = registry.service<TemplateInstallerService>(templateInstallerService);
          if (templates === undefined) events.warn(kernelMessage('SETUP_TEMPLATES_UNAVAILABLE'));
          return new SetupService(environment, config, await readSetupArtifacts(__dirname), [...registry.skills.values()], templates?.setupTemplates() ?? null).run();
        },
        configSections: () => registry.settings.sections(),
        installedPlugins: () => installedPlugins('bin/plugins', config.plugins.enabled, skipUserPlugins, files, metadata.version, message => events.warn(message)),
      };
      for (const command of commands(registry, services)) registry.add(registry.commands, command);
      // Bundled core plugins register in bundle order before user plugins; --no-plugins skips only user plugins.
      registerCorePlugins(registry, events, corePlugins, {
        skills: registrySkills(registry), fileDates: nodeFileDates,
        openFiles: root => NodeFiles.at(root, warn, undefined, () => lockWait), operationId: () => events.nextOperationId(),
        locks: root => nodeLockFiles(root, warn, () => lockWait), http: new FetchHttpClient(), environment: name => process.env[name],
      }, config.plugins.disabled);
      if (!skipUserPlugins) await loadEnabledPlugins('bin/plugins', config.plugins.enabled, files, registry, events);
      else await recordMissingPlugins('bin/plugins', config.plugins.enabled, files, registry, events);
      config.plugins.settings = await registry.configure(config.plugins.settings, async () => (await services.installedPlugins()).map(entry => entry.manifest.id), message => events.warn(message));
      await registry.publishRegistered(events);
      const id = bootstrap.args[0] ?? 'help';
      const command = registry.resolveCommand(id);
      invoked = command.id;
      const parsed = parseCommand(tokens, command);
      // From here on, plugin-contributed strings and error catalog entries localize responses too.
      settings.language = requestedLanguage(parsed.flags, settings.language);
      settings.events = requestedEvents(parsed.flags, settings.events);
      const commandLocalizer = localizer();
      for (const [commandId, registered] of registry.commands) registry.commands.set(commandId, commandLocalizer.command(registered));
      ensure(!parsed.flags.version, 'INVALID_ARGUMENT', '--version must be used without a command.');
      // help describes a command without running it, so its declared constraints do not apply.
      const flags = parsed.flags.help ? parsed.flags : declaredValues(commandOptions(command, parsed.args.slice(1)), parsed.flags);
      if (!parsed.flags.help) lockWait = waitBudget(parsed.flags);
      settings.dryRun = flagSetting(parsed.flags, 'dry-run', settings.dryRun);
      // Environment commits reach the metadata index once the command's scope binds it below.
      let metadataCommits: CommitObserver | undefined;
      environment = new Workspace(files, new ObsidianDocuments(), events, settings.dryRun, files.root, { committed: async changes => { await metadataCommits?.committed(changes); } });
      const policy = invocationPolicy(command, parsed.args.slice(1), parsed.flags);
      const project = policy.scope === 'workspace' ? null : policy.requestedProject !== undefined ? await services.projects.inspect(policy.requestedProject) : await services.projects.current();
      const scopedFiles = project ? new ScopedFiles(files, project.directory) : files;
      // Parse results persist in the workspace's .forge/cache between invocations; a dry run reads them but never writes.
      const cacheFile = snapshotFile(project?.directory ?? null);
      const vaultMetadata = new VaultMetadata(scopedFiles, new ObsidianMetadataParser(environment.codec), {
        workspaceRoot: project === null,
        revisionOf,
        snapshots: {
          store: new NodeMetadataSnapshotStore(files.root, cacheFile, __filename, stamped => stampedFiles(files, project?.directory, stamped)),
          key: `forge ${metadata.version}; parser ${metadataParserVersion}; scope ${project?.directory ?? '.'}`,
          save: !settings.dryRun,
        },
      });
      persistMetadata = () => vaultMetadata.persist().catch(error => events.warn(kernelMessage('METADATA_CACHE_UNSAVED', { file: cacheFile, diagnostic: errorMessage(error) })));
      // Commits keep a loaded cache current and publish metadataCache.* events; workspace-scope commits while a
      // project is selected reach the project's index only inside its directory, with project-relative paths.
      const metadataEvents = new MetadataCacheEvents(events, vaultMetadata);
      metadataCommits = project ? scopedCommitObserver(metadataEvents, project.directory) : metadataEvents;
      const workspace = project ? environment.within(scopedFiles, resolve(files.root, project.directory), metadataEvents) : environment;
      activeContext = { workspaceRoot: files.root, root: project ? resolve(files.root, project.directory) : files.root, project };
      const app = createApp({ workspace, metadata: vaultMetadata, events, project });
      const context: CommandContext = { workspace, environment, events, metadata: vaultMetadata, app, ...activeContext, language: settings.language, input: standardInput };
      // --help runs the help command for the requested command id.
      const invokedCommand = parsed.flags.help ? registry.resolveCommand('help') : command;
      const commandId = invokedCommand.id;
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
          ? await invokedCommand.run(id === 'help' ? [] : [id], {}, context)
          : await runCommand(command, ...normalizedPathInputs(command, parsed.args.slice(1), flags, context), context);
        return localizer().result(registry.commands.get(commandId), output);
      });
      result = { ok: true, data };
    }
  } catch (error) {
    // Plugin failures were already mapped by their owner's wrapper; codes reaching here unmapped stay opaque.
    process.exitCode = error instanceof AppError ? error.exitCode : 1;
    result = { ok: false, error: localizer().error(error) };
  } finally {
    await persistMetadata?.();
    await quitInvocation(events);
    await registry.dispose(events);
  }
  const responseLocalizer = localizer();
  const response = responseDocument({
    result, context: activeContext, events: selectEventOutput(events.history, settings.events),
    warnings: events.warningRecords.map(warning => responseLocalizer.warning(warning)),
  }, settings.json, () => responseLocalizer.error(forgeError('INVALID_RESULT', 'Command returned non-serializable data. Inspect committed events before retrying.')));
  // Keep committed change evidence even if a plugin command returns invalid data.
  if (!response.serializable) process.exitCode = 1;
  output(response.text);
}
const output = standardOutput();
void run();
