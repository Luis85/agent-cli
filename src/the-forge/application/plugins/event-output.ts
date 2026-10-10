import { ensure } from '../../domain/shared/errors.ts';
import type { EventRecord } from './events.ts';

/** How much invocation history a response envelope carries. Delivery and replay always see everything. */
export const eventOutputLevels = ['none', 'changes', 'all'] as const;
export type EventOutput = typeof eventOutputLevels[number];

export function eventOutput(value: string): EventOutput {
  ensure((eventOutputLevels as readonly string[]).includes(value), 'INVALID_ARGUMENT', `--events must be one of: ${eventOutputLevels.join(', ')}.`);
  return value as EventOutput;
}

/** The single definition of a committed file-change record in response output. */
export function isChangeRecord(record: EventRecord): boolean {
  return record.id === 'file.created' || record.id === 'file.updated' || record.id === 'file.deleted';
}

export function selectEventOutput(history: readonly EventRecord[], level: EventOutput): EventRecord[] {
  if (level === 'all') return [...history];
  return level === 'changes' ? history.filter(isChangeRecord) : [];
}
