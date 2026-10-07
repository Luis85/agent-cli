/** Select persisted file notifications while retaining lifecycle events in CLI responses. */
export function committedEvents<Event extends { id: string }>(events: readonly Event[]): Event[] {
  return events.filter(event => ['file.created', 'file.updated', 'file.deleted'].includes(event.id));
}
