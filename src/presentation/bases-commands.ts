import type { Bases } from '../application/bases.ts';
import type { Command, CommandContext } from '../application/plugins.ts';
import { ensure } from '../domain/errors.ts';
import { arity, globalOptions, value } from './arguments.ts';

export function basesCommand(service: (context: CommandContext) => Promise<Bases>): Command {
  return {
    id: 'bases', description: 'Query native Obsidian Bases views as file repositories without running Obsidian.',
    usage: 'bases list | inspect <path.base> | query <path.base> [--view name] [--context note.md] [--limit count] | capabilities',
    options: { view: 'string', context: 'string', limit: 'string' },
    async run(args, flags, context) {
      const action = args[0] ?? 'list';
      // Global options remain available, but query options never silently affect discovery.
      const allowed = new Set([...Object.keys(globalOptions), ...(action === 'query' ? ['view', 'context', 'limit'] : [])]);
      for (const key of Object.keys(flags)) ensure(allowed.has(key), 'INVALID_ARGUMENT', `--${key} is not supported by bases ${action}.`);
      if (action === 'list') {
        arity(args, 0, 1);
        return { files: (await context.workspace.files.list()).filter(path => path.endsWith('.base') && !path.split('/').some(part => part.startsWith('.'))), scope: context.root };
      }
      if (action === 'capabilities') { arity(args, 1); return (await service(context)).capabilities(); }
      ensure(action === 'inspect' || action === 'query', 'INVALID_ARGUMENT', 'Use bases list, inspect, query, or capabilities.');
      arity(args, 2); const path = args[1]!;
      ensure(path.endsWith('.base'), 'INVALID_BASE', 'Use a native .base file as the repository definition.');
      if (action === 'inspect') {
        const file = await context.workspace.files.read(path);
        const document = context.workspace.codec.inspect(path, file.bytes) as { data: Record<string, unknown> };
        return { path, revision: file.revision, definition: document.data, views: document.data.views ?? [], repository: { path, viewSelection: 'name; first view when omitted' } };
      }
      const limit = value(flags, 'limit');
      const result = await (await service(context)).query(path, { view: value(flags, 'view'), context: value(flags, 'context'), ...(limit === undefined ? {} : { limit: Number(limit) }) });
      return { ...result, repository: { path: result.path, view: result.view }, scope: context.root };
    },
  };
}
