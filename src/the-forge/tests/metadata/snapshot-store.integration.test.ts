import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MetadataChange, MetadataParser } from '../../src/application/metadata/ports.ts';
import { VaultMetadata } from '../../src/application/metadata/vault-metadata.ts';
import { ScopedFiles } from '../../src/application/workspace/scoped-files.ts';
import type { FileRepository } from '../../src/application/workspace/ports.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { ObsidianMetadataParser } from '../../src/infrastructure/metadata/parser.ts';
import { snapshotFormat } from '../../src/domain/metadata/snapshot.ts';
import { NodeMetadataSnapshotStore, snapshotFile } from '../../src/infrastructure/metadata/snapshot-store.ts';
import { NodeFiles, stampedFiles } from '../../src/infrastructure/workspace/files.ts';
import { metadataIndex, metadataState } from '../support/metadata.ts';

let root: string, program: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'forge-snapshots-')));
  program = join(root, 'bin/forge.js');
  await mkdir(join(root, 'bin'));
  await writeFile(program, 'build 1');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const put = async (path: string, content: string) => {
  await mkdir(join(root, path, '..'), { recursive: true });
  await writeFile(join(root, path), content);
};

/**
 * One invocation over the workspace root (or a project directory): a counting repository and parser, the real store,
 * load and persist. `later` moves the listing clock forward, as if the files were written long before.
 */
async function invocation(options: { later?: number; save?: boolean; directory?: string } = {}) {
  const files = await NodeFiles.at(root);
  const scoped: FileRepository = options.directory ? new ScopedFiles(files, options.directory) : files;
  const reads: string[] = [], parsed: string[] = [];
  const repository = Object.assign(Object.create(scoped) as FileRepository, { read: (path: string) => { reads.push(path); return scoped.read(path); } });
  const parser = new ObsidianMetadataParser(new ObsidianDocuments());
  const counting: MetadataParser = { indexes: path => parser.indexes(path), parse: (path, bytes) => { parsed.push(path); return parser.parse(path, bytes); } };
  const file = snapshotFile(options.directory ?? null);
  const stampedPaths: string[] = [];
  const store = new NodeMetadataSnapshotStore(root, file, program, async stamped => {
    const listing = await stampedFiles(files, options.directory, path => stamped(path) && stampedPaths.push(path) > 0);
    return { ...listing, checkedAtMs: listing.checkedAtMs + (options.later ?? 0) };
  });
  const metadata = new VaultMetadata(repository, counting, { workspaceRoot: !options.directory, snapshots: { store, key: 'forge test; parser 1', save: options.save ?? true } });
  const cache = await metadata.load();
  await metadata.persist();
  const fresh = metadataState(await metadataIndex(scoped, { workspaceRoot: !options.directory }).load());
  return { cache, state: metadataState(cache), fresh, reads: reads.sort(), parsed: parsed.sort(), stamped: stampedPaths.sort(), file: join(root, file) };
}

/** A modification time in whole seconds, which every filesystem stores and restores exactly. */
const pastSeconds = 1_700_000_000;

/** Rewrites a file in place with content of the same size and restores its modification time, so only its status change shows. */
async function sneakyEdit(path: string, content: string) {
  const before = await stat(join(root, path), { bigint: true });
  expect(Buffer.byteLength(content)).toBe(Number(before.size));
  expect(before.mtimeNs).toBe(BigInt(pastSeconds) * 1_000_000_000n);
  for (let attempt = 0; ; attempt++) {
    await writeFile(join(root, path), content);
    await utimes(join(root, path), pastSeconds, pastSeconds);
    // The status-change time must move on; on a coarse clock, rewrite until it does.
    if ((await stat(join(root, path), { bigint: true })).ctimeNs !== before.ctimeNs || attempt > 50) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  expect((await stat(join(root, path), { bigint: true })).mtimeNs).toBe(before.mtimeNs);
}

beforeEach(async () => {
  await put('Notes/Plan.md', '# Plan\nSee [[Ideas]] and [[Missing]]. #plan\n');
  await put('Notes/Ideas.md', '---\naliases: [Brainstorm]\n---\nBack to [[Plan]].\n');
  await put('image.png', 'bytes');
  await put('bin/config.json', '{}');
  await utimes(join(root, 'Notes/Plan.md'), pastSeconds, pastSeconds);
});

describe('metadata snapshots in the workspace cache folder', () => {
  it('stores parse results outside the vault and listings, and reuses unchanged files without reading them', async () => {
    const first = await invocation({ later: 10_000 });
    expect(first.parsed).toEqual(['Notes/Ideas.md', 'Notes/Plan.md']);
    // Only the files the index parses need a stamp; attachments and the workspace distribution are listed by name.
    expect(first.stamped).toEqual(['Notes/Ideas.md', 'Notes/Plan.md']);
    expect(first.state).toEqual(first.fresh);
    expect(first.file).toBe(join(root, `.forge/cache/metadata.v${snapshotFormat}.workspace.json`));
    expect(await readFile(join(root, '.forge/cache/.gitignore'), 'utf8')).toBe('*\n');
    expect(first.cache.files()).toEqual(['Notes/Ideas.md', 'Notes/Plan.md', 'image.png']);
    const listed = await (await NodeFiles.at(root)).list();
    expect(listed.filter(path => path.startsWith('.forge'))).toEqual([]);

    const second = await invocation({ later: 10_000 });
    expect(second.reads).toEqual([]);
    expect(second.parsed).toEqual([]);
    expect(second.state).toEqual(second.fresh);
  });

  it('notices an external edit of the same size with a restored modification time', async () => {
    await invocation();
    // Immediately after the first run the files are inside the racy window and are re-read by content.
    await sneakyEdit('Notes/Plan.md', '# Plan\nSee [[Ideas]] and [[Mizzing]]. #plan\n');
    const racy = await invocation();
    expect(racy.parsed).toEqual(['Notes/Plan.md']);
    expect(racy.state).toEqual(racy.fresh);
    expect(racy.cache.unresolvedLinks['Notes/Plan.md']).toEqual({ Mizzing: 1 });

    // Long after the snapshot, the status-change time in the stamp alone reveals the edit.
    await invocation({ later: 10_000 });
    await sneakyEdit('Notes/Plan.md', '# Plan\nSee [[Ideas]] and [[Mending]]. #plan\n');
    const settled = await invocation({ later: 20_000 });
    expect(settled.reads).toEqual(['Notes/Plan.md']);
    expect(settled.cache.unresolvedLinks['Notes/Plan.md']).toEqual({ Mending: 1 });
    expect(settled.state).toEqual(settled.fresh);
  });

  it('saves the snapshot after a commit that only moves, creates or deletes a file the index does not parse', async () => {
    const first = await invocation({ later: 10_000 });
    const storedPaths = async () => (JSON.parse((await readFile(first.file, 'utf8')).split('\n')[1]!) as { links: { paths: string[] } }).links.paths;
    expect(await storedPaths()).toContain('image.png');
    /** A mutating command: it loads the index, commits `change` and tells the index, then persists. Whether it saved. */
    const commit = async (change: () => Promise<void>, changes: MetadataChange[]) => {
      const files = await NodeFiles.at(root);
      const store = new NodeMetadataSnapshotStore(root, snapshotFile(null), program, async stamped => {
        const listing = await stampedFiles(files, undefined, stamped);
        return { ...listing, checkedAtMs: listing.checkedAtMs + 10_000 };
      });
      const metadata = new VaultMetadata(files, new ObsidianMetadataParser(new ObsidianDocuments()), { workspaceRoot: true, snapshots: { store, key: 'forge test; parser 1', save: true } });
      await metadata.load();
      const loaded = (await stat(first.file, { bigint: true })).mtimeNs;
      await change();
      await metadata.update(changes);
      await metadata.persist();
      return (await stat(first.file, { bigint: true })).mtimeNs !== loaded;
    };
    expect(await commit(() => rename(join(root, 'image.png'), join(root, 'picture.png')), [{ operation: 'renamed', oldPath: 'image.png', path: 'picture.png' }])).toBe(true);
    expect(await storedPaths()).toEqual(expect.arrayContaining(['picture.png']));
    expect(await storedPaths()).not.toContain('image.png');
    expect(await commit(() => writeFile(join(root, 'diagram.png'), 'bytes'), [{ operation: 'created', path: 'diagram.png' }])).toBe(true);
    expect(await storedPaths()).toContain('diagram.png');
    expect(await commit(() => rm(join(root, 'diagram.png')), [{ operation: 'deleted', path: 'diagram.png' }])).toBe(true);
    expect(await storedPaths()).not.toContain('diagram.png');
  });

  it('follows external renames, deletions and new files', async () => {
    await invocation({ later: 10_000 });
    await mkdir(join(root, 'Archive'));
    await rename(join(root, 'Notes/Plan.md'), join(root, 'Archive/Plan.md'));
    await rm(join(root, 'Notes/Ideas.md'));
    await put('New.md', 'Links [[Plan]] and [[Brainstorm]].\n');
    const next = await invocation({ later: 20_000 });
    expect(next.parsed).toEqual(['New.md']);
    expect(next.state).toEqual(next.fresh);
    expect(next.cache.resolvedLinks['New.md']).toEqual({ 'Archive/Plan.md': 1 });
    expect(next.cache.unresolvedLinks['New.md']).toEqual({ Brainstorm: 1 });
    expect(Object.keys(JSON.parse((await readFile(next.file, 'utf8')).split('\n')[1]!).files).sort()).toEqual(['Archive/Plan.md', 'New.md']);
  });

  it('rebuilds from a truncated, corrupted, foreign or other-build snapshot without failing', async () => {
    const { file } = await invocation({ later: 10_000 });
    const text = await readFile(file, 'utf8');
    const body = (content: string) => JSON.parse(content.slice(content.indexOf('\n') + 1)) as { files: unknown };
    const damaged = [text.slice(0, text.length / 2), text.replace('#plan', '#plam'), 'not a snapshot', '', text.replace('forge-metadata-snapshot', 'other-tool')];
    for (const content of damaged) {
      await writeFile(file, content);
      const rebuilt = await invocation({ later: 10_000 });
      expect(rebuilt.parsed).toEqual(['Notes/Ideas.md', 'Notes/Plan.md']);
      expect(rebuilt.state).toEqual(rebuilt.fresh);
      expect(body(await readFile(file, 'utf8')).files).toEqual(body(text).files);
    }
    // A new build of the program never trusts results of the previous one.
    await writeFile(program, 'build 2 differs');
    expect((await invocation({ later: 10_000 })).parsed).toEqual(['Notes/Ideas.md', 'Notes/Plan.md']);
  });

  it('leaves no snapshot behind during a dry run', async () => {
    const dry = await invocation({ save: false });
    expect(dry.parsed).toHaveLength(2);
    await expect(lstat(join(root, '.forge'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses to read or write through a symlinked cache folder', async () => {
    const elsewhere = await realpath(await mkdtemp(join(tmpdir(), 'forge-elsewhere-')));
    try {
      await mkdir(join(root, '.forge'));
      await symlink(elsewhere, join(root, '.forge/cache'), 'junction');
      const files = await NodeFiles.at(root);
      const store = new NodeMetadataSnapshotStore(root, snapshotFile(null), program, stamped => stampedFiles(files, undefined, stamped));
      const metadata = new VaultMetadata(files, new ObsidianMetadataParser(new ObsidianDocuments()), { workspaceRoot: true, snapshots: { store, key: 'k', save: true } });
      await metadata.load();
      await expect(metadata.persist()).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
      expect(await store.load()).toBeNull();
    } finally { await rm(elsewhere, { recursive: true, force: true }); }
  });

  it('keeps one snapshot per project directory with project-relative paths', async () => {
    await put('projects/app/Docs/Guide.md', 'See [[Readme]].\n');
    await put('projects/app/Readme.md', '# Readme\n');
    await put('projects/app/.forge/cache/kept.json', 'project content');
    const project = await invocation({ directory: 'projects/app', later: 10_000 });
    expect(project.file).toBe(join(root, `.forge/cache/metadata.v${snapshotFormat}.project.projects%2Fapp.json`));
    expect(project.cache.files()).toEqual(['Docs/Guide.md', 'Readme.md']);
    expect(project.cache.resolvedLinks['Docs/Guide.md']).toEqual({ 'Readme.md': 1 });
    const listing = await stampedFiles(await NodeFiles.at(root), 'projects/app', path => path.endsWith('.md'));
    expect(listing.files.map(file => [file.path, 'stamp' in file])).toEqual([['.forge/cache/kept.json', false], ['Docs/Guide.md', true], ['Readme.md', true]]);
    expect((await invocation({ directory: 'projects/app', later: 10_000 })).reads).toEqual([]);
  });
});
