import { AppError, ensure, isRecord } from './domain/errors.ts';
import { EventBus } from './application/events.ts';
import { Workspace } from './application/workspace.ts';
import { Registry, type CommandContext } from './application/plugins.ts';
import { NodeFiles } from './infrastructure/files.ts';
import { ObsidianDocuments } from './infrastructure/documents.ts';
import { loadPlugins } from './infrastructure/plugins.ts';
import { generators } from './infrastructure/generators.ts';
import { builtinSkills } from './infrastructure/skills.ts';
import { commands } from './presentation/commands.ts';
import { globalOptions, parseArguments, value } from './presentation/arguments.ts';

async function run(): Promise<void> {
  const tokens = process.argv.slice(2);
  const registry = new Registry(), events = new EventBus();
  let result: Record<string, unknown>;
  let compact = tokens.includes('--json');
  try {
    const bootstrap = parseArguments(tokens, globalOptions, true);
    compact = bootstrap.flags.json === true;
    if (bootstrap.flags.version) { process.stdout.write(JSON.stringify({ ok: true, data: { version: '0.1.0', apiVersion: 1 }, events: [], warnings: [] }) + '\n'); return; }
    const files = await NodeFiles.at(value(bootstrap.flags, 'root') ?? process.cwd());
    for (const id of ['file.created', 'file.updated']) events.define({ id, validate: (v): v is Record<string, unknown> => isRecord(v) && typeof v.path === 'string' && typeof v.revision === 'string' && typeof v.bytes === 'number' && v.operation === id.slice(5) });
    const workspace = new Workspace(files, new ObsidianDocuments(), events, bootstrap.flags['dry-run'] === true);
    const context: CommandContext = { workspace, events, root: files.root, input: async () => {
      ensure(!process.stdin.isTTY, 'INPUT_REQUIRED', '--stdin needs piped input.');
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
      return Buffer.concat(chunks);
    } };
    for (const generator of generators) registry.add(registry.generators, generator);
    for (const skill of builtinSkills) registry.add(registry.skills, skill);
    for (const command of commands(registry)) registry.add(registry.commands, command);
    const pluginConfig = value(bootstrap.flags, 'plugins');
    if (pluginConfig) await loadPlugins(pluginConfig, files, registry, events);
    const id = bootstrap.args[0] ?? 'help';
    const command = registry.commands.get(id);
    ensure(command, 'UNKNOWN_COMMAND', `Unknown command ${id}. Run help or schema.`);
    const parsed = parseArguments(tokens, { ...globalOptions, ...command.options });
    await registry.activate(context);
    const data = parsed.flags.help
      ? await registry.commands.get('help')!.run(id === 'help' ? [] : [id], {}, context)
      : await command.run(parsed.args.slice(1), parsed.flags, context);
    result = { ok: true, data };
  } catch (error) {
    process.exitCode = error instanceof AppError ? error.exitCode : 1;
    result = { ok: false, error: { code: error instanceof AppError ? error.code : 'OPERATION_FAILED', message: error instanceof Error ? error.message : String(error) } };
  } finally { await registry.dispose(events); }
  try { process.stdout.write(JSON.stringify({ ...result, events: events.history, warnings: events.warnings }, null, compact ? undefined : 2) + '\n'); }
  catch { process.exitCode = 1; process.stdout.write('{"ok":false,"error":{"code":"INVALID_RESULT","message":"Command returned a non-serializable result; inspect any reported writes before retrying."},"events":[],"warnings":[]}\n'); }
}
void run();
