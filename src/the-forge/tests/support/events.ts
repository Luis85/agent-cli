import { isChangeRecord } from '../../src/application/plugins/event-output.ts';

/** Select committed `vault.*` change records while retaining lifecycle events in CLI responses. */
export function committedEvents<Event extends { id: string; payload?: unknown }>(events: readonly Event[]): Event[] {
  return events.filter(event => isChangeRecord({ id: event.id, payload: event.payload }));
}

/** Committed file records only, omitting folder records for newly created parent directories. */
export function committedFileEvents<Event extends { id: string; payload?: unknown }>(events: readonly Event[]): Event[] {
  return committedEvents(events).filter(event => (event.payload as { kind?: string } | undefined)?.kind === 'file');
}
