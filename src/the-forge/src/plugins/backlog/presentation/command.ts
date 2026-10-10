import type { Command, CommandContext, PluginContext } from '../../../application/plugins/registry.ts';
import { option, type CommandFlags, type CommandOption } from '../../../application/plugins/command-metadata.ts';
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
import { syncAccepted, syncAction, syncOptions } from './sync-command.ts';

const selection = ['base', 'view', 'today'];
/** Options each action accepts besides the backlog selection (`--base`, `--view`, `--today`). */
const accepted: Record<string, readonly string[]> = {
  init: ['folder'], list: ['context'], tree: [], board: [], show: [], check: [],
  add: ['parent', 'folder', 'state', 'iteration', 'release', 'assignee', 'tags'],
  move: ['parent', 'top', 'before', 'after', 'first', 'last', 'if-match'],
  ranks: [], set: ['state', 'horizon', 'priority', 'risk', 'start', 'due', 'assignee', 'type', 'if-match'],
  depend: ['on', 'if-match'], undepend: ['on', 'if-match'],
  iteration: ['name', 'goal', 'start', 'due', 'length', 'if-match'],
  release: ['release-version', 'target-date', 'status', 'description', 'if-match'],
  sync: ['direction', 'take', 'field'],
};
const actions = Object.keys(accepted);
const options: Readonly<Record<string, CommandOption>> = {
  base: option.string('The .base file of the backlog; discovered when it is the only one with a product-backlog view.'),
  view: option.string('The product-backlog view of the base.'),
  today: option.string('The date used for started/finished stamps, iteration defaults and release dates (YYYY-MM-DD); default today.'),
  folder: option.string('init: the backlog folder (default docs). add: the folder of the new note instead of its type folder.'),
  context: option.boolean('list: include read-only context rows (ancestors outside the filter).'),
  parent: option.string('add: the parent item. move: the new parent.'),
  top: option.boolean('move: make the item a top-level item (no parent).'),
  before: option.string('move: place before this sibling.'),
  after: option.string('move: place after this sibling.'),
  first: option.boolean('move: place first among the siblings.'),
  last: option.boolean('move: place last among the siblings (the default).'),
  state: option.string('add/set: the workflow state.'),
  horizon: option.string('set: the roadmap horizon (Now, Next, Later…).'),
  priority: option.string('set: the priority.'),
  risk: option.string('set: the risk.'),
  start: option.string('set/iteration add: the planned start date.'),
  due: option.string('set/iteration add: the planned target date.'),
  assignee: option.string('add/set: a Resource note.'),
  type: option.string('set: the new type (canonical spelling is written).'),
  tags: option.string('add: tags separated by commas or spaces; a leading # is optional.'),
  iteration: option.string('add: the iteration to plan the item in.'),
  release: option.string('add: the release the item ships in.'),
  on: option.string('depend/undepend: the prerequisite item.'),
  name: option.string('iteration add: the name instead of "<N> - Iteration".'),
  goal: option.string('iteration add: the iteration goal.'),
  length: option.string('iteration add: the length in days (default iterationLengthDays, 14).'),
  'release-version': option.string('release add: the version (the release view\'s versionProperty).'),
  'target-date': option.string('release add: the target date.'),
  status: option.string('release add: the release status.'),
  description: option.string('release add: the description.'),
  'if-match': option.string('The revision of the item note the write is planned against.'),
  ...syncOptions,
};

const read = { mutating: false };

function date(flags: CommandFlags, key: string) {
  const text = value(flags, key);
  if (text === undefined) return undefined;
  const parsed = readDate(text).value;
  ensure(parsed !== null && /^\d{4}-\d{2}-\d{2}$/.test(text.trim()), 'INVALID_ARGUMENT', `--${key} must be a date in YYYY-MM-DD form.`);
  return parsed;
}

/** The backlog to open: `--base`/`--view`, else `plugins.settings.backlog.base`/`view`, else discovery. */
function selected(flags: CommandFlags, context: CommandContext): Selection {
  const settings = (context as PluginContext).settings ?? {};
  const base = value(flags, 'base') ?? (typeof settings.base === 'string' ? settings.base : undefined);
  const view = value(flags, 'view') ?? (value(flags, 'base') === undefined && typeof settings.view === 'string' ? settings.view : undefined);
  const today = date(flags, 'today');
  return { ...(base === undefined ? {} : { base }), ...(view === undefined ? {} : { view }), ...(today === undefined ? {} : { today }) };
}

/** The `backlog` command: backlog-view compatible planning over a `.base` file's `product-backlog` view. */
export function backlogCommand(ports: (context: CommandContext) => { bases: BasesQueryService; ports: BacklogPorts; sync: () => SyncServices }): Command {
  return {
    id: 'backlog',
    description: 'Plan a product backlog compatible with the Obsidian Product Backlog view (backlog-view): hierarchy, ranks, states, iterations, releases and dependencies.',
    usage: 'backlog init [--folder docs] | list | tree | board | show <item> | add <type> <title> | move <item> | ranks seed|respace | set <item> | depend|undepend <item> --on <item> | iteration add|assign | release add|join|mark-released|readiness|notes|list | check | sync [status | resolve <item> --take local|remote] [--direction push|pull|both]',
    scope: 'project', discovery: false, mutating: true,
    actions: {
      init: { description: 'Write the plugin\'s Product Backlog.base scaffold into a folder (default docs).' },
      list: { description: 'Every item by global rank as JSON.', ...read },
      tree: { description: 'The hierarchy in sibling rank order, context ancestors included.', ...read },
      board: { description: 'Board columns by state with WIP limits and the no-state column.', ...read },
      show: { description: 'One item with its ancestors, children, prerequisites and dependents.', ...read },
      add: { description: 'Create an item note exactly as the plugin does: sanitized name, type folder, pbl-id, key order and end-of-siblings rank.' },
      move: { description: 'Reparent or reorder one item with the plugin\'s rank arithmetic; writes only its parent and order.' },
      ranks: { description: 'seed (tree preorder) or respace (current rank order) ranks 1000 apart.' },
      set: { description: 'Set state (with started/finished stamps), horizon, priority, risk, dates, assignee or type; an empty value clears.' },
      depend: { description: 'Add a dependsOn link unless it closes a dependency loop.' },
      undepend: { description: 'Remove a dependsOn entry; the key is deleted when the list empties.' },
      iteration: { description: 'add an iteration with the plugin\'s name and date defaults, or assign <item> <iteration>.' },
      release: { description: 'add, join <item> <release>, mark-released, readiness, notes (generated release notes) or list releases.' },
      check: { description: 'Report parent and dependency cycles, broken links, unresolved memberships, configuration and field problems, rank ties.', ...read },
      sync: { description: 'Two-way sync of every view bound to a connection (view option connection: <id>) with explicit conflicts; status reads both sides without writing; resolve settles a conflict.' },
    },
    args: [
      { name: 'action', description: actions.join(', '), required: true, enum: actions },
      { name: 'arguments', description: 'The action\'s arguments: an item, a type and title, or a sub-action and its arguments.', variadic: true },
    ],
    options,
    errors: ['BACKLOG_NOT_FOUND', 'BACKLOG_AMBIGUOUS', 'BACKLOG_CONFIG_PROBLEM', 'BACKLOG_WRITE_REFUSED', 'BACKLOG_NO_GAP', 'CONFLICT', 'SYNC_CONFLICT', 'CONNECTOR_NOT_FOUND', 'CONNECTION_INVALID', 'CONNECTOR_AUTH_FAILED', 'CONNECTOR_REQUEST_FAILED'],
    async run(args, flags, context) {
      const [action, ...rest] = args;
      ensure(action !== undefined && actions.includes(action), 'INVALID_ARGUMENT', `Use backlog ${actions.join(', backlog ')}.`);
      only(flags, `backlog ${action}`, action === 'sync' ? syncAccepted(rest[0]) : accepted[action]!);
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
        case 'check': arity(rest, 0); return check(session);
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

/** Rejects the command's own options that `sub` does not take; global options stay available. */
function only(flags: CommandFlags, sub: string, keys: readonly string[]): void {
  for (const key of Object.keys(flags)) ensure(!Object.hasOwn(options, key) || [...selection, ...keys].includes(key), 'INVALID_ARGUMENT', `--${key} is not supported by ${sub}.`);
}

function iteration(session: Session, rest: string[], flags: CommandFlags, ifMatch?: string) {
  const [sub, ...args] = rest;
  if (sub === 'add') {
    arity(args, 0);
    only(flags, 'backlog iteration add', ['name', 'goal', 'start', 'due', 'length']);
    const length = integer(flags, 'length', 1);
    return addIteration(session, { name: value(flags, 'name'), goal: value(flags, 'goal'), start: value(flags, 'start'), due: value(flags, 'due'), ...(length === undefined ? {} : { length }) });
  }
  ensure(sub === 'assign', 'INVALID_ARGUMENT', 'Use backlog iteration add or backlog iteration assign <item> <iteration>.');
  arity(args, 2);
  only(flags, 'backlog iteration assign', ['if-match']);
  return assignIteration(session, args[0]!, args[1]!, ifMatch);
}

function release(session: Session, bases: BasesQueryService, rest: string[], flags: CommandFlags, ifMatch?: string) {
  const [sub, ...args] = rest;
  const subs = ['add', 'join', 'mark-released', 'readiness', 'notes', 'list'];
  ensure(sub !== undefined && subs.includes(sub), 'INVALID_ARGUMENT', `Use backlog release ${subs.join(', ')}.`);
  only(flags, `backlog release ${sub}`, sub === 'add' ? ['release-version', 'target-date', 'status', 'description'] : ['join', 'mark-released'].includes(sub) ? ['if-match'] : []);
  switch (sub) {
    case 'add': arity(args, 1); return addRelease(session, args[0]!, { version: value(flags, 'release-version'), targetDate: value(flags, 'target-date'), status: value(flags, 'status'), description: value(flags, 'description') });
    case 'join': arity(args, 2); return joinRelease(session, args[0]!, args[1]!, ifMatch);
    case 'mark-released': arity(args, 1); return markReleased(session, bases, args[0]!, ifMatch);
    case 'readiness': arity(args, 1); return readiness(session, bases, args[0]!);
    case 'notes': arity(args, 1); return releaseNotes(session, bases, args[0]!);
    default: arity(args, 0); return listReleases(session, bases);
  }
}
