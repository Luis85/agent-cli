/**
 * English templates of the `backlog check` problem messages and the configuration problems it reports, filled with
 * `fill` from the kernel message helpers. The presentation renders them in the response language from the same
 * keys; a template that another template's text could also match is listed first.
 */
export const checkMessages = {
  parentCycle: '{title} closes a parent loop; the loop is cut here and the note shows as a root.',
  unresolvedParent: 'The parent of {title} does not resolve to a loaded note.',
  dependencyCycle: '{title} depends on {target}, which closes a dependency loop.',
  unresolvedDependency: '{title} depends on {target}, which does not resolve to a loaded item.',
  brokenIteration: 'The iteration of {title} ({iteration}) is not an Iteration note.',
  brokenAssignee: 'The assignee of {title} ({assignee}) is not a Resource note.',
  fieldNotHeldUntyped: 'This type {title} may not hold {key}.',
  fieldNotHeld: '{type} {title} may not hold {key}.',
  unreadableValue: '{title} has an unreadable {key}; the plugin shelves it.',
  reversedSpan: '{title} starts after its target date.',
  unresolvedMembership: 'The release membership of {path} does not resolve to exactly one Release note of this base.',
  rankTie: '{count} items share rank {rank}; ties follow result order.',
  unrankedOne: '1 item has no rank and sorts last; run backlog ranks seed.',
  unranked: '{count} items have no rank and sort last; run backlog ranks seed.',
  sharedKey: 'The properties {roles} all use the key "{key}".',
  sharedReleaseKey: 'The release properties {roles} all use the key "{key}".',
  releasedDateIsTarget: 'The released date and the target date share the key "{key}".',
  releasedTransition: 'The released transition value "{value}" is not one of the released status values.',
  membershipCollision: 'The release membership key "{key}" is also the {role} property.',
} as const satisfies Record<string, string>;

export type CheckMessage = keyof typeof checkMessages;

/**
 * English templates of the `backlog sync` skip reasons (`skipped[].reason`) and of the Forge's own per-item failure
 * (`failed[].message`); a remote failure's message is its diagnostic as raised. Longer templates come first, since a
 * shorter one could also match their text.
 */
export const syncMessages = {
  duplicateLinkCopy: '{holder} already syncs remote item {id}; remove or change {property} in this copy',
  duplicateLinkNotes: '{count} notes link remote item {id}; keep {property} in one of them',
  duplicateLink: '{holder} already syncs remote item {id}',
  unmappedType: 'type {type} has no remote type mapping',
  untyped: 'the note has no type, so it has no remote type mapping',
  foreignLink: '{property} links an item of another connection',
  remoteFormatUnknown: 'the remote description changed but is not known to be Markdown, so it is not pulled; edit the note or run backlog sync resolve with --field description',
  unexpressible: "the note's {field} cannot be expressed on this connection, so the remote value is not pulled over it",
  unreadableRemote: "the remote {field} cannot be read, so the note's value is not pushed over it",
  remoteMissing: 'remote item {id} no longer exists or is not readable',
  serverKept: "the platform stored {stored} instead of {sent}; the next sync pushes the note's value again",
  serverApplied: 'the platform applied {value}; a pull takes it into the note',
  notCreated: 'not synced yet; a push creates it',
  predecessorNotCreated: 'a predecessor was not created in this run; the links follow on the next sync',
  unmappedRemoteType: 'remote type {type} has no local type mapping; add it to mappings.types',
  unsyncedParent: 'remote parent {parent} is not synced on this connection',
  unsyncedDependency: 'remote predecessor {ids} is not synced on this connection',
  missingIteration: 'no iteration note named {name}',
  titleTaken: '{path} already exists',
  remoteChanged: 'The remote item changed during the sync; run the sync again.',
  linksChanged: "The remote item's links changed on the other end during the update, so a link may have been removed in place of another. The next sync reports the parent and dependencies as conflicts where the two sides differ; compare them and run backlog sync resolve.",
} as const satisfies Record<string, string>;

export type SyncMessage = keyof typeof syncMessages;
