import type { Bases } from '../../application/bases/query.ts';
import type { Command, CommandContext } from '../../application/plugins/registry.ts';
import { ensure } from '../../domain/shared/errors.ts';
import { globalOptions } from '../cli/arguments.ts';
import { arity, value } from '../../application/plugins/command-input.ts';
import { option } from '../../application/plugins/command-metadata.ts';

export function basesCommand(service: (context: CommandContext) => Promise<Bases>): Command {
  return {
    id: 'bases', description: 'Query native Obsidian Bases views as file repositories without running Obsidian.',
    usage: 'bases list | inspect <path.base> | query <path.base> [--view name] [--context note.md] [--limit count] | capabilities',
    scope: 'project', discovery: false, mutating: false, defaultAction: 'list',
    actions: {
      list: { description: 'List visible .base files in the command scope.' },
      inspect: { description: 'Return a .base definition and its views.' },
      query: { description: 'Evaluate a view and return its matching files.' },
      capabilities: { description: 'Describe the standalone Bases compatibility profile.' },
    },
    args: [
      { name: 'action', description: 'list (default), inspect, query or capabilities.', enum: ['list', 'inspect', 'query', 'capabilities'] },
      { name: 'path', description: 'The .base file for inspect and query.' },
    ],
    options: {
      view: option.string('View name for query; the first view when omitted.'),
      context: option.string('Note used as this file in query expressions.'),
      limit: option.string('Maximum number of rows for query.'),
    },
    errors: ['INVALID_BASE', 'INVALID_BASE_QUERY', 'INVALID_BASE_EXPRESSION', 'BASE_EVALUATION_ERROR', 'BASE_VIEW_NOT_FOUND', 'BASE_CONTEXT_NOT_FOUND', 'BASE_INDEX_ERROR', 'AMBIGUOUS_BASE_LINK', 'INVALID_BASE_PROPERTY_TYPES', 'UNSUPPORTED_BASE_PROPERTY_TYPE'],
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
