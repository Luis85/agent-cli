import { option, type CommandAction, type CommandOption } from '../../../application/plugins/command-metadata.ts';
import { SYNC_FIELDS } from '../../../domain/connectors/items.ts';
import { changesOutput } from '../../../application/plugins/output-schemas.ts';

/** The backlog selection every action accepts: `--base`, `--view` and `--today`. */
export const selectionOptions: Readonly<Record<string, CommandOption>> = {
  base: option.string('The .base file of the backlog; discovered when it is the only one with a product-backlog view.'),
  view: option.string('The product-backlog view of the base.'),
  today: option.string('The date used for started/finished stamps, iteration defaults and release dates (YYYY-MM-DD); default today.'),
};

const ifMatch = option.string('The revision of the item note the write is planned against.');
const read = { mutating: false };
/** Every write returns its guarded batch, `{dryRun, changes}`, beside the item it wrote. */
const written = { output: changesOutput() };
/** Writes that converge: repeating the identical invocation finds the target state and changes nothing. */
const settled = { idempotent: true, ...written };
/** Items, iterations and releases are named by vault path (with or without .md), link text, title or pbl-id. */
const item = { name: 'item', description: 'The item: a vault path, link text, title or pbl-id.', required: true } as const;
const releaseName = { name: 'release', description: 'The release: a vault path, link text, title or pbl-id.', required: true } as const;
const direction = option.string('Push vault changes, pull remote changes, or both (default).', { enum: ['push', 'pull', 'both'] });

/**
 * The backlog actions with the options each accepts besides the selection; `iteration`, `release` and `sync`
 * forms are sub-actions, so each declares exactly its own options.
 */
export const backlogActions: Readonly<Record<string, CommandAction>> = {
  init: {
    description: 'Write the plugin\'s Product Backlog.base scaffold into a folder (default docs).', usage: 'backlog init [--folder docs]', ...written, args: [],
    options: { folder: option.string('The backlog folder (default docs).') },
  },
  list: {
    description: 'Every item by global rank as JSON.', usage: 'backlog list [--context]', ...read, args: [],
    options: { context: option.boolean('Include read-only context rows (ancestors outside the filter).') },
  },
  tree: { description: 'The hierarchy in sibling rank order, context ancestors included.', usage: 'backlog tree', ...read, args: [] },
  board: { description: 'Board columns by state with WIP limits and the no-state column.', usage: 'backlog board', ...read, args: [] },
  show: { description: 'One item with its ancestors, children, prerequisites and dependents.', usage: 'backlog show <item>', ...read, args: [item] },
  check: { description: 'Report parent and dependency cycles, broken links, unresolved memberships, configuration and field problems, rank ties.', usage: 'backlog check', ...read, args: [] },
  add: {
    description: 'Create an item note exactly as the plugin does: sanitized name, type folder, pbl-id, key order and end-of-siblings rank.',
    usage: 'backlog add <type> <title> [--parent item] [--folder directory] [--state state] [--iteration iteration] [--release release] [--assignee resource] [--tags tags]', ...written,
    args: [{ name: 'type', description: 'The item type, such as Epic or Story.', required: true }, { name: 'title', description: 'The item title; quote a title with spaces.', required: true }],
    options: {
      parent: option.string('The parent item.'),
      folder: option.string('The folder of the new note instead of its type folder.'),
      state: option.string('The workflow state.'),
      iteration: option.string('The iteration to plan the item in.'),
      release: option.string('The release the item ships in.'),
      assignee: option.string('A Resource note.'),
      tags: option.string('Tags separated by commas or spaces; a leading # is optional.'),
    },
  },
  move: {
    description: 'Reparent or reorder one item with the plugin\'s rank arithmetic; writes only its parent and order.',
    usage: 'backlog move <item> [--parent item | --top] [--before item | --after item | --first | --last] [--if-match revision]', ...settled, args: [item],
    options: {
      parent: option.string('The new parent.'),
      top: option.boolean('Make the item a top-level item (no parent).'),
      before: option.string('Place before this sibling.'),
      after: option.string('Place after this sibling.'),
      first: option.boolean('Place first among the siblings.'),
      last: option.boolean('Place last among the siblings (the default).'),
      'if-match': ifMatch,
    },
  },
  ranks: { description: 'seed (tree preorder) or respace (current rank order) ranks 1000 apart.', usage: 'backlog ranks seed|respace', ...settled,
    args: [{ name: 'mode', description: 'seed or respace.', required: true, enum: ['seed', 'respace'] }] },
  set: {
    description: 'Set state (with started/finished stamps), horizon, priority, risk, dates, assignee or type; an empty value clears.',
    usage: 'backlog set <item> [--state state] [--horizon horizon] [--priority priority] [--risk risk] [--start date] [--due date] [--assignee resource] [--type type] [--if-match revision]', ...settled, args: [item],
    options: {
      state: option.string('The workflow state.'),
      horizon: option.string('The roadmap horizon (Now, Next, Later…).'),
      priority: option.string('The priority.'),
      risk: option.string('The risk.'),
      start: option.string('The planned start date.'),
      due: option.string('The planned target date.'),
      assignee: option.string('A Resource note.'),
      type: option.string('The new type (canonical spelling is written).'),
      'if-match': ifMatch,
    },
  },
  depend: {
    description: 'Add a dependsOn link unless it closes a dependency loop.', usage: 'backlog depend <item> --on <item> [--if-match revision]', ...settled, args: [item],
    options: { on: option.string('The prerequisite item.', { required: true }), 'if-match': ifMatch },
  },
  undepend: {
    description: 'Remove a dependsOn entry; the key is deleted when the list empties.', usage: 'backlog undepend <item> --on <item> [--if-match revision]', ...settled, args: [item],
    options: { on: option.string('The prerequisite item.', { required: true }), 'if-match': ifMatch },
  },
  'iteration add': {
    description: 'Add an iteration with the plugin\'s name and date defaults.', usage: 'backlog iteration add [--name name] [--goal goal] [--start date] [--due date] [--length days]', ...written, args: [],
    options: {
      name: option.string('The name instead of "<N> - Iteration".'),
      goal: option.string('The iteration goal.'),
      start: option.string('The planned start date.'),
      due: option.string('The planned target date.'),
      length: option.string('The length in days (default iterationLengthDays, 14).'),
    },
  },
  'iteration assign': {
    description: 'Plan an item in an iteration.', usage: 'backlog iteration assign <item> <iteration> [--if-match revision]', ...settled,
    args: [item, { name: 'iteration', description: 'The iteration: a vault path, link text, title or pbl-id.', required: true }],
    options: { 'if-match': ifMatch },
  },
  'release add': {
    description: 'Add a release note.', usage: 'backlog release add <name> [--release-version version] [--target-date date] [--status status] [--description text]', ...written,
    args: [{ name: 'name', description: 'The release name.', required: true }],
    options: {
      'release-version': option.string('The version (the release view\'s versionProperty).'),
      'target-date': option.string('The target date.'),
      status: option.string('The release status.'),
      description: option.string('The description.'),
    },
  },
  'release join': { description: 'Plan an item in a release.', usage: 'backlog release join <item> <release> [--if-match revision]', ...settled, args: [item, releaseName], options: { 'if-match': ifMatch } },
  // A repeat finds the release released and is refused, so it changes nothing.
  'release mark-released': { description: 'Mark a release released.', usage: 'backlog release mark-released <release> [--if-match revision]', ...settled, args: [releaseName], options: { 'if-match': ifMatch } },
  'release readiness': { description: 'Report how ready a release is.', usage: 'backlog release readiness <release>', ...read, args: [releaseName] },
  'release notes': { description: 'Write the generated release notes of a release; an unchanged repeat writes nothing.', usage: 'backlog release notes <release>', ...settled, args: [releaseName] },
  'release list': { description: 'List the releases.', usage: 'backlog release list', ...read, args: [] },
  sync: {
    description: 'Two-way sync of every view bound to a connection (view option connection: <id>) with explicit conflicts.', usage: 'backlog sync [--direction push|pull|both]', args: [],
    options: { direction },
  },
  'sync status': {
    description: 'Read both sides of every bound view without writing.', usage: 'backlog sync status [--direction push|pull|both]', ...read, args: [],
    options: { direction },
  },
  'sync resolve': {
    description: 'Settle a sync conflict of one item with the local or the remote value.', usage: 'backlog sync resolve <item> --take local|remote [--field fields]', args: [item],
    options: {
      take: option.string('Settle the conflict with the local or the remote value.', { enum: ['local', 'remote'], required: true }),
      field: option.string(`Comma-separated fields to settle (${SYNC_FIELDS.join(', ')}, property:<key>); default every conflicting field.`),
    },
  },
};
