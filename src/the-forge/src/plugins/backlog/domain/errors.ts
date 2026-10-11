/** The `backlog` plugin's registered failure codes; the host maps them to their catalog entries. */
export type BacklogErrorCode = 'BACKLOG_NOT_FOUND' | 'BACKLOG_AMBIGUOUS' | 'BACKLOG_CONFIG_PROBLEM' | 'BACKLOG_WRITE_REFUSED' | 'BACKLOG_NO_GAP' | 'SYNC_CONFLICT';

export function backlogError(code: BacklogErrorCode, message: string, details?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
}

/** Why a write was refused; `details.reason` carries it. */
export type RefusalReason =
  | 'resource' | 'field-not-held' | 'not-a-release' | 'not-a-resource' | 'not-an-iteration' | 'reversed-span' | 'outside-filter'
  | 'parent-cycle' | 'projection' | 'marker' | 'dependency-cycle' | 'reserved-type' | 'use-release-add' | 'already-released'
  | 'unreadable' | 'foreign-release-notes' | 'unbound-property';

export function refused(reason: RefusalReason, message: string, details: Record<string, unknown> = {}): Error {
  return backlogError('BACKLOG_WRITE_REFUSED', message, { reason, ...details });
}
