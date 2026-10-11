import { describe, expect, it } from 'vitest';
import { fill } from '../../src/domain/shared/messages.ts';
import { syncMessages, syncWarnings, type SyncMessage, type SyncWarning } from '../../src/plugins/backlog/domain/messages.ts';
import { germanSyncMessages, germanSyncWarnings, localizedSync, syncWarningText } from '../../src/plugins/backlog/presentation/messages.ts';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]!).sort();
const view = (skipped: Array<Record<string, string> & { reason: string }>, failed: Array<Record<string, string> & { message: string }>) => ({ base: 'Backlog.base', view: 'Backlog', skipped, failed });

describe('backlog sync messages', () => {
  it('have a distinct German text with the same placeholders for every English one', () => {
    for (const key of Object.keys(syncMessages) as SyncMessage[]) {
      expect(germanSyncMessages[key], key).not.toBe(syncMessages[key]);
      expect(placeholders(germanSyncMessages[key]), key).toEqual(placeholders(syncMessages[key]));
    }
  });

  it('have a distinct German warning with the same placeholders for every English one', () => {
    for (const key of Object.keys(syncWarnings) as SyncWarning[]) {
      expect(germanSyncWarnings[key], key).not.toBe(syncWarnings[key]);
      expect(placeholders(germanSyncWarnings[key]), key).toEqual(placeholders(syncWarnings[key]));
      expect(syncWarningText('en')(key, { lock: 'L' }), key).toBe(fill(syncWarnings[key], { lock: 'L' }));
    }
  });

  it('render each filled template in German from its own key, whatever the catalog order', () => {
    for (const key of Object.keys(syncMessages) as SyncMessage[]) {
      const params = Object.fromEntries(placeholders(syncMessages[key]).map(name => [name, `${name}-value`]));
      const [german] = localizedSync({ views: [view([{ reason: fill(syncMessages[key], params) }], [])] }, 'de').views[0]!.skipped;
      expect(german!.reason, key).toBe(fill(germanSyncMessages[key], params));
    }
  });

  it('localizes skip reasons and Forge failures but keeps codes, values and remote diagnostics', () => {
    const result = { counts: { failed: 2 }, views: [view(
      [{ path: 'Copy.md', code: 'duplicate-link', reason: fill(syncMessages.duplicateLinkCopy, { holder: 'Story.md', id: '42', property: 'ado' }) }],
      [{ path: 'Story.md', code: 'SYNC_CONFLICT', message: syncMessages.remoteChanged }, { path: 'Bug.md', code: 'CONNECTOR_REQUEST_FAILED', message: 'TF401232: Work item 7 does not exist.' }],
    )] };
    const german = localizedSync(result, 'de');
    expect(german.views[0]!.skipped).toEqual([{ path: 'Copy.md', code: 'duplicate-link', reason: 'Story.md synchronisiert bereits das Remote-Element 42; entfernen oder ändern Sie ado in dieser Kopie' }]);
    expect(german.views[0]!.failed).toEqual([
      { path: 'Story.md', code: 'SYNC_CONFLICT', message: 'Das Remote-Element wurde während der Synchronisierung geändert; führen Sie die Synchronisierung erneut aus.' },
      result.views[0]!.failed[1],
    ]);
    expect(german.counts).toBe(result.counts);
    expect(localizedSync(result, 'en')).toBe(result);
  });
});
