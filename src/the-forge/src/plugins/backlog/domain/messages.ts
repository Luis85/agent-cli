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
