import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { MetadataCacheEvents } from '../../src/application/metadata/cache-events.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { createApp } from '../../src/application/vault/app.ts';
import type { ProjectInfo } from '../../src/application/projects/projects.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { metadataIndex } from './metadata.ts';

/** Writes UTF-8 files below `root`, creating their folders. */
export async function writeVault(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

/**
 * A filesystem vault composed as `main.ts` binds a command scope: a guarded workspace whose commits update the
 * metadata index and publish metadataCache events, and the `app` facade over both.
 */
export async function vaultScope(root: string, options: { dryRun?: boolean; project?: ProjectInfo | null } = {}) {
  const events = new EventBus(new NodeEventScope());
  registerHostEvents(events);
  const files = await NodeFiles.at(root);
  const metadata = metadataIndex(files);
  const workspace = new Workspace(files, new ObsidianDocuments(), events, options.dryRun === true, files.root, new MetadataCacheEvents(events, metadata));
  const app = createApp({ workspace, metadata, events, project: options.project ?? null });
  /** `[id, path]` of every vault and metadataCache record so far. */
  const records = () => events.history.filter(record => /^(vault|metadataCache)\./.test(record.id))
    .map(record => [record.id, (record.payload as { path?: string }).path] as const);
  return { events, files, metadata, workspace, app, records };
}
