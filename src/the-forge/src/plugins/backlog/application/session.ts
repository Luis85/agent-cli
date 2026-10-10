import type { CommandContext } from '../../../application/plugins/registry.ts';
import type { MetadataCache } from '../../../application/metadata/ports.ts';
import { AppError, isRecord } from '../../../domain/shared/errors.ts';
import { backlogError } from '../domain/errors.ts';
import { ownValue, readString, type CivilDate, type Frontmatter } from '../domain/fields.ts';
import type { NoteSource } from '../domain/items.ts';
import { buildModel, type BacklogItem, type BacklogModel } from '../domain/model.ts';
import { resolveReleaseSettings, resolveSettings, type ReleaseSettings, type ViewOptions } from '../domain/settings-resolve.ts';
import type { BacklogSettings } from '../domain/settings.ts';

/** The `bases` plugin's declared query service: a view's result files in result order. */
export interface BasesQueryService {
  query(context: CommandContext, path: string, options: { view?: string }): Promise<{ files: string[]; view: string }>;
}
/**
 * Ports the plugin entry wires: Obsidian-style YAML serialization of a new note, a frontmatter edit that rewrites
 * only the changed entries (`frontmatter` is the complete new property set), and the clock.
 */
export interface BacklogPorts {
  stringifyYaml(value: Frontmatter): string;
  /** A stable digest of text (the sync engine's field hashes). */
  hash(text: string): string;
  editFrontmatter(text: string, frontmatter: Frontmatter, changes: Frontmatter, removed: readonly string[]): string;
  today(): CivilDate;
}
/** Which backlog to open: `--base`/`--view`, else `plugins.settings.backlog`, else the single backlog view of the scope. */
export interface Selection { base?: string; view?: string; today?: CivilDate }

export const BACKLOG_VIEW = 'product-backlog';
const RELEASE_VIEW = 'product-release';

export interface View { name: string; type: string; options: ViewOptions }
export interface BaseFile { path: string; views: View[] }

/** One opened backlog: the base and view, their resolved settings and the model the view's results build. */
export interface BacklogSession {
  context: CommandContext; ports: BacklogPorts; cache: MetadataCache; source: NoteSource;
  base: BaseFile; view: View; settings: BacklogSettings; model: BacklogModel; today: CivilDate;
  /** The base's first `product-release` view, if any. */
  releaseView: { name: string; settings: ReleaseSettings; options: ViewOptions } | null;
  results: string[];
}

function views(data: unknown): View[] {
  if (!isRecord(data) || !Array.isArray(data.views)) return [];
  return data.views.filter(isRecord).map(view => ({ name: String(view.name), type: String(view.type), options: view }));
}

export async function readBase(context: CommandContext, path: string): Promise<BaseFile> {
  const file = await context.workspace.files.read(path);
  const document = context.workspace.codec.inspect(path, file.bytes) as { data: unknown };
  return { path, views: views(document.data) };
}

/** Every `.base` file of the scope with a `product-backlog` view; unreadable bases are skipped. */
export async function discover(context: CommandContext, cache: MetadataCache): Promise<BaseFile[]> {
  const found: BaseFile[] = [];
  for (const path of cache.files().filter(file => file.toLowerCase().endsWith('.base'))) {
    try {
      const base = await readBase(context, path);
      if (base.views.some(view => view.type === BACKLOG_VIEW)) found.push(base);
    } catch (error) { if (!(error instanceof AppError)) throw error; }
  }
  return found;
}

/** Views bound to a connection (`connection: <id>`) define sync sets; without a named view, unbound views are preferred. */
export const isBound = (view: View) => typeof view.options.connection === 'string' && view.options.connection.trim() !== '';
function preferUnbound<T extends { view: View }>(candidates: T[]): T[] {
  const unbound = candidates.filter(candidate => !isBound(candidate.view));
  return unbound.length > 0 ? unbound : candidates;
}

async function selectView(context: CommandContext, cache: MetadataCache, selection: Selection): Promise<{ base: BaseFile; view: View }> {
  if (selection.base === undefined) {
    const bases = await discover(context, cache);
    const candidates = preferUnbound(bases.flatMap(base => base.views.filter(view => view.type === BACKLOG_VIEW && (selection.view === undefined || view.name === selection.view)).map(view => ({ base, view }))));
    if (candidates.length === 0) throw backlogError('BACKLOG_NOT_FOUND', 'No .base file in this scope has a product-backlog view; run backlog init or pass --base.', { scope: context.root });
    if (candidates.length > 1) throw backlogError('BACKLOG_AMBIGUOUS', `${candidates.length} product-backlog views exist; pass --base and --view, or set plugins.settings.backlog.base.`, { candidates: candidates.map(({ base, view }) => ({ base: base.path, view: view.name })) });
    return candidates[0]!;
  }
  let base: BaseFile;
  try { base = await readBase(context, selection.base); }
  catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') throw backlogError('BACKLOG_NOT_FOUND', `The base ${selection.base} does not exist.`, { base: selection.base });
    throw error;
  }
  const backlogViews = base.views.filter(view => view.type === BACKLOG_VIEW);
  const matches = selection.view === undefined ? preferUnbound(backlogViews.map(view => ({ view }))).map(entry => entry.view) : backlogViews.filter(view => view.name === selection.view);
  if (matches.length === 0) throw backlogError('BACKLOG_NOT_FOUND', `${base.path} has no product-backlog view${selection.view === undefined ? '' : ` named ${selection.view}`}.`, { base: base.path, views: backlogViews.map(view => view.name) });
  if (matches.length > 1) throw backlogError('BACKLOG_AMBIGUOUS', `${base.path} has ${matches.length} product-backlog views; pass --view.`, { base: base.path, candidates: matches.map(view => ({ base: base.path, view: view.name })) });
  return { base, view: matches[0]! };
}

/** NoteSource over the kernel metadata cache: frontmatter, frontmatter links and `getFirstLinkpathDest`. */
function cacheSource(cache: MetadataCache): NoteSource {
  return {
    frontmatter: path => cache.getFileCache(path)?.frontmatter,
    frontmatterLinks: path => (cache.getFileCache(path)?.frontmatterLinks ?? []).map(link => ({ key: link.key, link: link.link })),
    resolve: (linkpath, sourcePath) => cache.getFirstLinkpathDest(linkpath, sourcePath),
  };
}

/** Builds the model of one view: its Bases results plus context ancestors, read through the metadata cache. */
async function evaluate(context: CommandContext, bases: BasesQueryService, cache: MetadataCache, base: string, view: string, settings: BacklogSettings) {
  const results = (await bases.query(context, base, { view })).files;
  const files = new Set(cache.files());
  return { results, model: buildModel(cacheSource(cache), results, settings, path => files.has(path)) };
}

export async function openBacklog(context: CommandContext, bases: BasesQueryService, ports: BacklogPorts, selection: Selection): Promise<BacklogSession> {
  const cache = await context.metadata.load();
  const { base, view } = await selectView(context, cache, selection);
  const settings = resolveSettings(view.options);
  const release = base.views.find(entry => entry.type === RELEASE_VIEW);
  const { results, model } = await evaluate(context, bases, cache, base.path, view.name, settings);
  return {
    context, ports, cache, source: cacheSource(cache), base, view, settings, model, results, today: selection.today ?? ports.today(),
    releaseView: release ? { name: release.name, settings: resolveReleaseSettings(release.options), options: release.options } : null,
  };
}

/**
 * The release view's own model, as backlog-view's release view builds it: that view's results and options, with
 * its type, parent and order mappings and its membership key as the release key.
 */
export async function openReleaseModel(session: BacklogSession, bases: BasesQueryService) {
  const release = session.releaseView;
  if (release === null) throw backlogError('BACKLOG_CONFIG_PROBLEM', `${session.base.path} has no product-release view; add one to manage releases.`, { base: session.base.path });
  const plan: BacklogSettings = { ...resolveSettings(release.options), typeKey: release.settings.typeKey, parentKey: release.settings.parentKey, orderKey: release.settings.orderKey, releaseKey: release.settings.membershipKey };
  const { model } = await evaluate(session.context, bases, session.cache, session.base.path, release.name, plan);
  return { release, plan, model };
}

/** The live type of a note, read with the backlog's type key. */
export function typeOf(session: BacklogSession, path: string): string | null {
  return readString(ownValue(session.cache.getFileCache(path)?.frontmatter, session.settings.typeKey));
}

/** Whether a path is taken, ignoring letter case, so a new note never collides on case-insensitive filesystems. */
export function pathTaken(session: BacklogSession, path: string): boolean {
  const lower = path.toLowerCase();
  return session.cache.files().some(file => file.toLowerCase() === lower);
}

export const wikilink = (session: BacklogSession, target: string, sourcePath: string) => `[[${session.cache.fileToLinktext(target, sourcePath)}]]`;

/**
 * An item by vault path (with or without `.md`), by link text as Obsidian resolves it from the base, by title
 * (case-insensitive) or by `pbl-id` (`#12` or `12`). Context rows are found too; writers refuse them.
 */
export function findItem(session: BacklogSession, reference: string, model: BacklogModel = session.model): BacklogItem {
  const text = reference.trim();
  const direct = model.byPath.get(text) ?? model.byPath.get(`${text}.md`);
  if (direct) return direct;
  const resolved = session.cache.getFirstLinkpathDest(text.replace(/^\[\[|\]\]$/g, ''), session.base.path);
  if (resolved !== null && model.byPath.has(resolved)) return model.byPath.get(resolved)!;
  const byTitle = [...model.byPath.values()].filter(item => item.title.toLowerCase() === text.toLowerCase());
  const id = /^#?(\d+)$/.exec(text);
  const byId = id ? [...model.byPath.values()].filter(item => item.pblId === Number(id[1])) : [];
  const matches = byTitle.length > 0 ? byTitle : byId;
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw backlogError('BACKLOG_AMBIGUOUS', `${reference} names ${matches.length} backlog items; pass a vault path.`, { reference, candidates: matches.map(item => item.path) });
  throw backlogError('BACKLOG_NOT_FOUND', `${reference} is not an item of ${session.base.path} › ${session.view.name}.`, { reference, base: session.base.path, view: session.view.name });
}
