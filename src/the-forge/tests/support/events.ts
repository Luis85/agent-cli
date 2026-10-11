import { isChangeRecord } from '../../src/application/plugins/event-output.ts';
import { renderKernelMessage, type KernelMessage } from '../../src/domain/shared/kernel-messages.ts';

/** Select committed `vault.*` change records while retaining lifecycle events in CLI responses. */
export function committedEvents<Event extends { id: string; payload?: unknown }>(events: readonly Event[]): Event[] {
  return events.filter(event => isChangeRecord({ id: event.id, payload: event.payload }));
}

/** Committed file records only, omitting folder records for newly created parent directories. */
export function committedFileEvents<Event extends { id: string; payload?: unknown }>(events: readonly Event[]): Event[] {
  return committedEvents(events).filter(event => (event.payload as { kind?: string } | undefined)?.kind === 'file');
}

/** A warning as an English response shows it: host messages render from the kernel catalog, plugin text stays. */
export function englishWarning(warning: string | KernelMessage): string {
  return typeof warning === 'string' ? warning : renderKernelMessage(warning);
}
