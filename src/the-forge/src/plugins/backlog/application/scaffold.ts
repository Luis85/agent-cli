import type { CommandContext } from '../../../application/plugins/registry.ts';
import { baseFileContent, basePath } from '../domain/notes.ts';

/**
 * `backlog init`: backlog-view's "Create backlog" command. Writes `<folder>/Product Backlog.base` (then ` 1`,
 * ` 2`… when taken) with the plugin's exact scaffold: the folder filter, Markdown only, one `product-backlog`
 * view named Backlog with the folder as its home folder.
 */
export async function initBacklog(context: CommandContext, folderInput = 'docs') {
  const cache = await context.metadata.load();
  const taken = new Set(cache.files().map(file => file.toLowerCase()));
  const { folder, path } = basePath(folderInput, candidate => taken.has(candidate.toLowerCase()));
  const content = baseFileContent(folder);
  const result = await context.workspace.write([{ path, bytes: new TextEncoder().encode(content) }], { diff: true });
  return { ...result, path, folder, view: 'Backlog' };
}
