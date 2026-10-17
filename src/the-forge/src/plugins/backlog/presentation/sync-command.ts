import type { CommandContext } from '../../../application/plugins/registry.ts';
import type { CommandFlags } from '../../../application/plugins/command-metadata.ts';
import { arity, value } from '../../../application/plugins/command-input.ts';
import { ensure } from '../../../domain/shared/errors.ts';
import type { CivilDate } from '../domain/fields.ts';
import type { Direction } from '../application/sync-plan.ts';
import { runSync, type SyncRequest, type SyncServices } from '../application/sync-run.ts';
import { localizedSync, syncWarningText } from './messages.ts';

/**
 * `backlog sync [--direction …]`, `backlog sync status` and `backlog sync resolve <item> --take local|remote
 * [--field a,b]`; `--base`/`--view` narrow the bound views.
 */
export function syncAction(rest: string[], flags: CommandFlags, context: CommandContext, services: SyncServices, selection: { base?: string; view?: string; today?: CivilDate }) {
  const [sub, ...args] = rest;
  const direction = (value(flags, 'direction') ?? 'both') as Direction;
  ensure(['push', 'pull', 'both'].includes(direction), 'INVALID_ARGUMENT', '--direction must be push, pull or both.');
  const run = async (request: SyncRequest) => localizedSync(await runSync(context, services, request, syncWarningText(context.language)), context.language);
  if (sub === undefined) return run({ ...selection, direction, mode: 'sync' });
  if (sub === 'status') { arity(args, 0); return run({ ...selection, direction, mode: 'status' }); }
  ensure(sub === 'resolve', 'INVALID_ARGUMENT', 'Use backlog sync, backlog sync status or backlog sync resolve <item> --take local|remote.');
  arity(args, 1);
  const take = value(flags, 'take', true)!;
  ensure(take === 'local' || take === 'remote', 'INVALID_ARGUMENT', '--take must be local or remote.');
  const fields = value(flags, 'field')?.split(',').map(field => field.trim()).filter(Boolean) ?? null;
  ensure(fields === null || fields.length > 0, 'INVALID_ARGUMENT', '--field needs at least one field name.');
  return run({ ...selection, direction: 'both', mode: 'sync', resolve: { item: args[0]!, take, fields } });
}
