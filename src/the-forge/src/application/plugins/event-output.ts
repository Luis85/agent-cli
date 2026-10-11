import { ensure } from '../../domain/shared/errors.ts';
import type { EventRecord } from './events.ts';

/** How much invocation history a response envelope carries. Delivery and replay always see everything. */
export const eventOutputLevels = ['none', 'changes', 'all'] as const;
export type EventOutput = typeof eventOutputLevels[number];

/** The level `--events` names; another value fails with INVALID_OPTION_VALUE, as for any declared enum. */
export function eventOutput(value: string): EventOutput {
  ensure((eventOutputLevels as readonly string[]).includes(value), 'INVALID_OPTION_VALUE', `--events must be one of: ${eventOutputLevels.join(', ')}.`, { option: 'events', value, allowed: [...eventOutputLevels] });
  return value as EventOutput;
}

/** The single definition of a committed change record in response output: every `vault.*` record. */
export function isChangeRecord(record: EventRecord): boolean {
  return record.id.startsWith('vault.');
}

export function selectEventOutput(history: readonly EventRecord[], level: EventOutput): EventRecord[] {
  if (level === 'all') return [...history];
  return level === 'changes' ? history.filter(isChangeRecord) : [];
}
