import type { CommandContext } from '../../../application/plugins/registry.ts';
import { option, type CommandFlags, type CommandOption } from '../../../application/plugins/command-metadata.ts';
import { arity, value } from '../../../application/plugins/command-input.ts';
import { ensure } from '../../../domain/shared/errors.ts';
import { SYNC_FIELDS } from '../../../domain/connectors/items.ts';
import type { CivilDate } from '../domain/fields.ts';
import type { Direction } from '../application/sync-plan.ts';
import { runSync, type SyncServices } from '../application/sync-run.ts';

/** The `backlog sync` options besides the backlog selection. */
export const syncOptions: Readonly<Record<string, CommandOption>> = {
  direction: option.string('sync: push vault changes, pull remote changes, or both (default).', { enum: ['push', 'pull', 'both'] }),
  take: option.string('sync resolve: settle the conflict with the local or the remote value.', { enum: ['local', 'remote'] }),
  field: option.string(`sync resolve: comma-separated fields to settle (${SYNC_FIELDS.join(', ')}, property:<key>); default every conflicting field.`),
};

/** Which options each sync form accepts besides `--base`, `--view` and `--today`. */
export function syncAccepted(sub: string | undefined): string[] {
  return sub === 'resolve' ? ['take', 'field'] : ['direction'];
}

/**
 * `backlog sync [--direction …]`, `backlog sync status` and `backlog sync resolve <item> --take local|remote
 * [--field a,b]`; `--base`/`--view` narrow the bound views.
 */
export function syncAction(rest: string[], flags: CommandFlags, context: CommandContext, services: SyncServices, selection: { base?: string; view?: string; today?: CivilDate }) {
  const [sub, ...args] = rest;
  const direction = (value(flags, 'direction') ?? 'both') as Direction;
  ensure(['push', 'pull', 'both'].includes(direction), 'INVALID_ARGUMENT', '--direction must be push, pull or both.');
  if (sub === undefined) return runSync(context, services, { ...selection, direction, mode: 'sync' });
  if (sub === 'status') { arity(args, 0); return runSync(context, services, { ...selection, direction, mode: 'status' }); }
  ensure(sub === 'resolve', 'INVALID_ARGUMENT', 'Use backlog sync, backlog sync status or backlog sync resolve <item> --take local|remote.');
  arity(args, 1);
  const take = value(flags, 'take', true)!;
  ensure(take === 'local' || take === 'remote', 'INVALID_ARGUMENT', '--take must be local or remote.');
  const fields = value(flags, 'field')?.split(',').map(field => field.trim()).filter(Boolean) ?? null;
  ensure(fields === null || fields.length > 0, 'INVALID_ARGUMENT', '--field needs at least one field name.');
  return runSync(context, services, { ...selection, direction: 'both', mode: 'sync', resolve: { item: args[0]!, take, fields } });
}
