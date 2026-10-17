import type { Command, PluginContext } from '../../../application/plugins/registry.ts';
import type { CommandFlags } from '../../../application/plugins/command-metadata.ts';
import { arity, integer, value } from '../../../application/plugins/command-input.ts';
import { ensure } from '../../../domain/shared/errors.ts';
import { readDate } from '../domain/fields.ts';
import { addItem, moveItem, respaceRanks } from '../application/planning.ts';
import { assignIteration, depend, joinRelease, setFields, undepend } from '../application/editing.ts';
import { addIteration, addRelease, listReleases, markReleased, readiness, releaseNotes } from '../application/markers.ts';
import { initBacklog } from '../application/scaffold.ts';
import { openBacklog, type BacklogPorts, type BasesQueryService, type Selection } from '../application/session.ts';
import { board, check, itemTree, listItems, showItem } from '../application/views.ts';
import type { SyncServices } from '../application/sync-run.ts';
import { syncAction } from './sync-command.ts';
import { backlogActions, selectionOptions } from './actions.ts';
import { localizedCheck } from './messages.ts';

/** The first word of every action: `iteration add` and `iteration assign` share `iteration`. */
const actions = [...new Set(Object.keys(backlogActions).map(id => id.split(' ')[0]!))];

function date(flags: CommandFlags, key: string) {
  const text = value(flags, key);
  if (text === undefined) return undefined;
  const parsed = readDate(text).value;
  ensure(parsed !== null && /^\d{4}-\d{2}-\d{2}$/.test(text.trim()), 'INVALID_ARGUMENT', `--${key} must be a date in YYYY-MM-DD form.`);
  return parsed;
}

/** The backlog to open: `--base`/`--view`, else `plugins.settings.backlog.base`/`view`, else discovery. */
function selected(flags: CommandFlags, context: PluginContext): Selection {
  const settings = context.settings ?? {};
  const base = value(flags, 'base') ?? (typeof settings.base === 'string' ? settings.base : undefined);
  const view = value(flags, 'view') ?? (value(flags, 'base') === undefined && typeof settings.view === 'string' ? settings.view : undefined);
  const today = date(flags, 'today');
  return { ...(base === undefined ? {} : { base }), ...(view === undefined ? {} : { view }), ...(today === undefined ? {} : { today }) };
}

/** The `backlog` command: backlog-view compatible planning over a `.base` file's `product-backlog` view. */
export function backlogCommand(ports: (context: PluginContext) => { bases: BasesQueryService; ports: BacklogPorts; sync: () => SyncServices }): Command<PluginContext> {
  return {
    id: 'backlog',
    description: 'Plan a product backlog compatible with the Obsidian Product Backlog view (backlog-view): hierarchy, ranks, states, iterations, releases and dependencies.',
    usage: 'backlog init [--folder docs] | list | tree | board | show <item> | add <type> <title> | move <item> | ranks seed|respace | set <item> | depend|undepend <item> --on <item> | iteration add|assign | release add|join|mark-released|readiness|notes|list | check | sync [status | resolve <item> --take local|remote] [--direction push|pull|both]',
    scope: 'project', discovery: false, mutating: true,
    actions: backlogActions, unknownAction: 'INVALID_ARGUMENT',
    args: [
      { name: 'action', description: actions.join(', '), required: true, enum: actions },
      { name: 'arguments', description: 'The action\'s arguments: an item, a type and title, or a sub-action and its arguments.', variadic: true },
    ],
    options: selectionOptions,
    errors: ['BACKLOG_NOT_FOUND', 'BACKLOG_AMBIGUOUS', 'BACKLOG_CONFIG_PROBLEM', 'BACKLOG_WRITE_REFUSED', 'BACKLOG_NO_GAP', 'CONFLICT', 'SYNC_CONFLICT', 'SYNC_INTERRUPTED', 'CONNECTOR_NOT_FOUND', 'CONNECTION_INVALID', 'CONNECTOR_AUTH_FAILED', 'CONNECTOR_REQUEST_FAILED'],
    async run(args, flags, context) {
      const [action, ...rest] = args;
      ensure(action !== undefined && actions.includes(action), 'INVALID_ARGUMENT', `Use backlog ${actions.join(', backlog ')}.`);
      if (action === 'init') { arity(rest, 0); return initBacklog(context, value(flags, 'folder')); }
      const { bases, ports: host, sync } = ports(context);
      if (action === 'sync') {
        const today = date(flags, 'today');
        return syncAction(rest, flags, context, sync(), { ...(value(flags, 'base') === undefined ? {} : { base: value(flags, 'base') }), ...(value(flags, 'view') === undefined ? {} : { view: value(flags, 'view') }), ...(today ? { today } : {}) });
      }
      const session = await openBacklog(context, bases, host, selected(flags, context));
      const ifMatch = value(flags, 'if-match');
      switch (action) {
        case 'list': arity(rest, 0); return listItems(session, flags.context === true);
        case 'tree': arity(rest, 0); return itemTree(session);
        case 'board': arity(rest, 0); return board(session);
        case 'show': arity(rest, 1); return showItem(session, rest[0]!);
        case 'check': arity(rest, 0); return localizedCheck(check(session), context.language);
        case 'add': {
          arity(rest, 2);
          const tags = value(flags, 'tags');
          return addItem(session, { type: rest[0]!, title: rest[1]!, parent: value(flags, 'parent'), folder: value(flags, 'folder'), state: value(flags, 'state'), iteration: value(flags, 'iteration'), release: value(flags, 'release'), assignee: value(flags, 'assignee'), ...(tags === undefined ? {} : { tags: [tags] }) });
        }
        case 'move': {
          arity(rest, 1);
          const placements = ['before', 'after', 'first', 'last'].filter(key => flags[key] !== undefined);
          ensure(placements.length <= 1 && !(flags.top === true && flags.parent !== undefined), 'INVALID_ARGUMENT', 'Pass at most one of --before, --after, --first, --last, and either --parent or --top.');
          return moveItem(session, { item: rest[0]!, parent: value(flags, 'parent'), top: flags.top === true, before: value(flags, 'before'), after: value(flags, 'after'), first: flags.first === true, last: flags.last === true, ifMatch });
        }
        case 'ranks':
          arity(rest, 1);
          ensure(rest[0] === 'seed' || rest[0] === 'respace', 'INVALID_ARGUMENT', 'Use backlog ranks seed or backlog ranks respace.');
          return respaceRanks(session, rest[0]);
        case 'set': {
          arity(rest, 1);
          const fields = ['state', 'horizon', 'priority', 'risk', 'start', 'due', 'assignee', 'type'] as const;
          ensure(fields.some(key => flags[key] !== undefined), 'MISSING_ARGUMENT', `backlog set needs at least one of --${fields.join(', --')}.`);
          return setFields(session, { item: rest[0]!, ifMatch, ...Object.fromEntries(fields.flatMap(key => (value(flags, key) === undefined ? [] : [[key, value(flags, key)]]))) });
        }
        case 'depend': case 'undepend': {
          arity(rest, 1);
          const on = value(flags, 'on', true)!;
          return action === 'depend' ? depend(session, rest[0]!, on, ifMatch) : undepend(session, rest[0]!, on, ifMatch);
        }
        case 'iteration': return iteration(session, rest, flags, ifMatch);
        default: return release(session, bases, rest, flags, ifMatch);
      }
    },
  };
}

type Session = Awaited<ReturnType<typeof openBacklog>>;

function iteration(session: Session, rest: string[], flags: CommandFlags, ifMatch?: string) {
  const [sub, ...args] = rest;
  if (sub === 'add') {
    arity(args, 0);
    const length = integer(flags, 'length', 1);
    return addIteration(session, { name: value(flags, 'name'), goal: value(flags, 'goal'), start: value(flags, 'start'), due: value(flags, 'due'), ...(length === undefined ? {} : { length }) });
  }
  ensure(sub === 'assign', 'INVALID_ARGUMENT', 'Use backlog iteration add or backlog iteration assign <item> <iteration>.');
  arity(args, 2);
  return assignIteration(session, args[0]!, args[1]!, ifMatch);
}

function release(session: Session, bases: BasesQueryService, rest: string[], flags: CommandFlags, ifMatch?: string) {
  const [sub, ...args] = rest;
  const subs = ['add', 'join', 'mark-released', 'readiness', 'notes', 'list'];
  ensure(sub !== undefined && subs.includes(sub), 'INVALID_ARGUMENT', `Use backlog release ${subs.join(', ')}.`);
  switch (sub) {
    case 'add': arity(args, 1); return addRelease(session, args[0]!, { version: value(flags, 'release-version'), targetDate: value(flags, 'target-date'), status: value(flags, 'status'), description: value(flags, 'description') });
    case 'join': arity(args, 2); return joinRelease(session, args[0]!, args[1]!, ifMatch);
    case 'mark-released': arity(args, 1); return markReleased(session, bases, args[0]!, ifMatch);
    case 'readiness': arity(args, 1); return readiness(session, bases, args[0]!);
    case 'notes': arity(args, 1); return releaseNotes(session, bases, args[0]!);
    default: arity(args, 0); return listReleases(session, bases);
  }
}
