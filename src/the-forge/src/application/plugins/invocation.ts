import { forgeError, summarizeError } from '../../domain/shared/errors.ts';
import type { EventBus } from './events.ts';
import { publishHostEvent, type HostEventMap } from './host-events.ts';

/** Resolve result serialization while plugins can still observe the command outcome. */
export async function invokeCommand(events: EventBus, metadata: Omit<HostEventMap['command.started'], 'operationId'>, activate: () => Promise<void>, run: () => unknown | Promise<unknown>): Promise<unknown> {
  const operation = { ...metadata, operationId: events.nextOperationId() };
  await publishHostEvent(events, 'command.started', operation);
  try {
    await activate();
    const data = await run();
    let snapshot: unknown;
    try {
      const serialized = JSON.stringify(data);
      snapshot = serialized === undefined ? undefined : JSON.parse(serialized);
    } catch {
      throw forgeError('INVALID_RESULT', 'Command returned non-serializable data. Inspect committed events before retrying.');
    }
    await publishHostEvent(events, 'command.succeeded', operation);
    return snapshot;
  } catch (error) {
    await publishHostEvent(events, 'command.failed', { ...operation, error: summarizeError(error) });
    throw error;
  }
}

/** Plugins are active: queued `onLayoutReady` callbacks run in order, then `workspace.layout-ready` is published. */
export async function announceLayoutReady(events: EventBus): Promise<void> {
  await events.markLayoutReady();
  await publishHostEvent(events, 'workspace.layout-ready', {});
}

/** Invocation end, before plugins unload: publish `workspace.quit`, then run best-effort quit tasks. Never throws. */
export async function quitInvocation(events: EventBus): Promise<void> {
  try {
    await publishHostEvent(events, 'workspace.quit', {});
    await events.runQuitTasks();
  } catch { /* Quit is best effort and cannot replace the command result. */ }
}
