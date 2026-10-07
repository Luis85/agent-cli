import { resolve } from 'node:path';
import metadata from '../package.json';
import { AppError, ensure, isRecord } from './domain/errors.ts';
import { EventBus } from './application/events.ts';
import { Workspace } from './application/workspace.ts';
import { Registry, type CommandContext } from './application/plugins.ts';
import { ProjectService } from './application/projects.ts';
import { SetupService } from './application/setup.ts';
import { NodeFiles } from './infrastructure/files.ts';
import { ObsidianDocuments } from './infrastructure/documents.ts';
import { loadEnabledPlugins } from './infrastructure/plugins.ts';
import { loadConfig } from './infrastructure/config.ts';
import { MarkdownTemplates } from './infrastructure/templates.ts';
import { projectScaffold, componentScaffold } from './infrastructure/project-scaffolds.ts';
import { readSetupArtifacts } from './infrastructure/setup-artifacts.ts';
import { generators } from './infrastructure/generators.ts';
import { builtinSkills } from './infrastructure/skills.ts';
import { commands } from './presentation/commands.ts';
import { globalOptions, parseArguments, parseBootstrap, value } from './presentation/arguments.ts';

async function run(): Promise<void> {
  const tokens = process.argv.slice(2);
  const registry = new Registry(), events = new EventBus();
  let result: Record<string, unknown>;
  let compact = tokens.includes('--json');
  try {
    const bootstrap = parseBootstrap(tokens);
    if (bootstrap.flags.version) {
      const parsed = parseArguments(tokens, globalOptions);
      ensure(parsed.args.length === 0, 'INVALID_ARGUMENT', '--version does not accept a command.');
      result = { ok: true, data: { name: 'The Forge', version: metadata.version, apiVersion: 1 } };
    } else {
      const loaded = await loadConfig({ defaultPath: resolve(__dirname, '../config.json'), explicitPath: value(bootstrap.flags, 'config'), cwd: process.cwd(), root: value(bootstrap.flags, 'root') });
      const config = loaded.config;
      config.settings.json = bootstrap.flags['no-json'] ? false : bootstrap.flags.json ? true : config.settings.json;
      config.settings.dryRun = bootstrap.flags['no-dry-run'] ? false : bootstrap.flags['dry-run'] ? true : config.settings.dryRun;
      compact = config.settings.json;
      const files = await NodeFiles.at(config.paths.root);
      for (const id of ['file.created', 'file.updated']) events.define({ id, validate: (v): v is Record<string, unknown> => isRecord(v) && typeof v.path === 'string' && typeof v.revision === 'string' && typeof v.bytes === 'number' && v.operation === id.slice(5) });
      let workspace: Workspace;
      for (const generator of generators) registry.add(registry.generators, generator);
      for (const skill of builtinSkills) registry.add(registry.skills, skill);
      for (const command of commands(registry, {
        loaded, templates: new MarkdownTemplates(),
        get projects() { return new ProjectService(files, workspace, config.paths.projects, { project: projectScaffold, component: componentScaffold }); },
        setup: async () => new SetupService(workspace, config, await readSetupArtifacts(__dirname), [...registry.skills.values()]).run(),
      })) registry.add(registry.commands, command);
      if (!bootstrap.flags['no-plugins']) await loadEnabledPlugins(config.paths.plugins, config.plugins.enabled, files, registry, events);
      const id = bootstrap.args[0] ?? 'help';
      const command = registry.commands.get(id);
      ensure(command, 'UNKNOWN_COMMAND', `Unknown command ${id}. Run help or schema.`);
      const parsed = parseArguments(tokens, { ...globalOptions, ...command.options });
      ensure(!parsed.flags.version, 'INVALID_ARGUMENT', '--version must be used without a command.');
      for (const option of ['root', 'config', 'no-plugins']) ensure(parsed.flags[option] === bootstrap.flags[option], 'INVALID_ARGUMENT', `--${option} must precede the command.`);
      config.settings.json = parsed.flags['no-json'] ? false : parsed.flags.json ? true : config.settings.json;
      config.settings.dryRun = parsed.flags['no-dry-run'] ? false : parsed.flags['dry-run'] ? true : config.settings.dryRun;
      compact = config.settings.json;
      workspace = new Workspace(files, new ObsidianDocuments(), events, config.settings.dryRun);
      const context: CommandContext = { workspace, events, root: files.root, input: async () => {
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
      result = { ok: true, data };
    }
  } catch (error) {
    process.exitCode = error instanceof AppError ? error.exitCode : 1;
    result = { ok: false, error: { code: error instanceof AppError ? error.code : 'OPERATION_FAILED', message: error instanceof Error ? error.message : String(error) } };
  } finally { await registry.dispose(events); }
  try { process.stdout.write(JSON.stringify({ ...result, events: events.history, warnings: events.warnings }, null, compact ? undefined : 2) + '\n'); }
  catch {
    process.exitCode = 1;
    // Keep committed change evidence even if a plugin command returns invalid data.
    process.stdout.write(JSON.stringify({ ok: false, error: { code: 'INVALID_RESULT', message: 'Command returned non-serializable data. Inspect committed events before retrying.' }, events: events.history, warnings: events.warnings }) + '\n');
  }
}
void run();
