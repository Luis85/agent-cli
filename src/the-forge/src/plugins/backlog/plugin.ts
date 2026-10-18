import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import type { EventDefinition } from '../../application/plugins/events.ts';
import { isRecord } from '../../domain/shared/errors.ts';
import type { BasesQueryService } from './application/session.ts';
import type { ConnectorHub } from '../../application/connectors/contract.ts';
import { stringifyYaml } from './infrastructure/yaml.ts';
import { hashText } from './infrastructure/hash.ts';
import { followRename, type SyncActivity } from './application/sync-store.ts';
import { editFrontmatter } from './infrastructure/frontmatter.ts';
import { backlogSkill } from './infrastructure/skill.ts';
import { watchSignals } from './infrastructure/signals.ts';
import { backlogCommand } from './presentation/command.ts';
import { de, backlogStrings } from './presentation/strings.ts';

const payload = (keys: readonly string[]) => (value: unknown): value is Record<string, unknown> => isRecord(value) && keys.every(key => typeof value[key] === 'string');
const events: EventDefinition[] = [
  { id: 'backlog.item-created', description: 'A backlog item, iteration or release note was created: {path, title, type, id, parent?, order?}.', validate: payload(['path', 'title', 'type']) },
  { id: 'backlog.item-moved', description: 'An item was reparented or reordered: {path, parent, order, previousParent, previousOrder}.', validate: payload(['path']) },
  { id: 'backlog.state-changed', description: 'An item changed its workflow state: {path, title, from, to, started?, finished?}.', validate: payload(['path', 'title']) },
  { id: 'backlog.released', description: 'A release was marked released: {path, name, status, released}.', validate: payload(['path', 'name', 'status', 'released']) },
  { id: 'backlog.synced', description: 'A bound view finished syncing with its connection: {base, view, connection, created, updated, pulled, conflicts, left (notes that left the sync set of the connection), failed}.', validate: payload(['base', 'view', 'connection']) },
];

const today = () => { const now = new Date(); return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }; };

/**
 * The `backlog` core plugin: a product backlog compatible with the Obsidian Product Backlog view (backlog-view
 * 0.10.0 with its global rank). The backlog's `.base` view options are its configuration; results come from the
 * `bases` plugin's `bases.query` service, links from the kernel metadata cache, and every write is a guarded
 * Workspace batch. `plugins.settings.backlog.base`/`view` select the default backlog.
 */
export const backlogPlugin: CorePlugin = {
  manifest: {
    id: 'backlog', name: 'Backlog', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
    description: 'Plan a product backlog compatible with the Obsidian Product Backlog view: hierarchy, ranks, states, iterations, releases and dependencies.',
  },
  strings: backlogStrings,
  create: host => {
    const activity: SyncActivity = { syncing: false };
    return {
      requires: ['bases.query'],
      optional: ['connector.hub'],
      commands: [backlogCommand(context => {
        const { services } = context;
        const ports = { stringifyYaml, editFrontmatter, today, hash: hashText };
        return { bases: services.get<BasesQueryService>('bases.query'), ports, sync: () => ({ bases: services.get<BasesQueryService>('bases.query'), ports, hub: services.get<ConnectorHub>('connector.hub'), activity, lock: host.locks(context.workspaceRoot), interrupts: watchSignals }) };
      })],
      // Sync state files stay keyed by note path when notes or folders are renamed through Forge.
      onload(context) {
        if (!context.services.has('connector.hub')) return;
        const hub = context.services.get<ConnectorHub>('connector.hub');
        context.app.vault.on('rename', async ({ path, oldPath, kind }) => { if (!activity.syncing) await followRename(context.workspace, hub.ids(), oldPath, path, kind); });
      },
      events,
      skills: [backlogSkill],
      settings: {
        type: 'object', additionalProperties: false,
        properties: {
          base: { type: 'string', minLength: 1, description: 'The default .base file of the backlog command, relative to the command scope.' },
          view: { type: 'string', minLength: 1, description: 'The default product-backlog view of that base.' },
        },
      },
      errors: [
        { code: 'BACKLOG_NOT_FOUND', category: 'not-found', summary: 'The backlog or the backlog item was not found.', hint: 'Create a backlog with backlog init, pass --base and --view, or check the item with backlog list.' },
        { code: 'BACKLOG_AMBIGUOUS', category: 'input', summary: 'The selection matches several backlogs or items.', hint: 'Pick one of error.details.candidates with --base and --view, or pass the full path.' },
        { code: 'BACKLOG_CONFIG_PROBLEM', category: 'input', summary: 'The backlog configuration in the .base file blocks this operation.', hint: 'Fix the problem named in the message in the .base view options, then rerun the command.' },
        { code: 'BACKLOG_WRITE_REFUSED', category: 'conflict', summary: 'The backlog refuses this write.', hint: 'error.details.reason names the rule; choose a fitting item, type or value, or bind the missing property.' },
        { code: 'BACKLOG_NO_GAP', category: 'conflict', summary: 'No rank is free between the neighbours.', hint: 'Run backlog ranks respace (or backlog ranks seed when ranks are missing), then repeat the move.' },
        { code: 'SYNC_CONFLICT', category: 'conflict', summary: 'The remote work item changed while it was being synced.', hint: 'Check the state with backlog sync status, then repeat the sync or the resolution.', retryable: true },
        { code: 'SYNC_INTERRUPTED', category: 'interrupted', summary: 'A signal stopped the sync at a safe point (exit 130 for SIGINT, 143 for SIGTERM); its locks are released.', hint: 'Every remote item created so far is recorded in the sync state; run backlog sync again to finish.' },
      ],
      strings: { de },
    };
  },
};
