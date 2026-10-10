import { forgeError, errorMessage, AppError, ensure, isRecord } from '../../../domain/shared/errors.ts';
import { vaultPath } from '../../../domain/documents/file.ts';
import { claudePluginCapabilities, validateClaudePlugin } from '../domain/plugins.ts';
import { validateClaudeHooks } from '../../../domain/claude/hooks.ts';
import type { ClaudeAgentCodec } from './agents.ts';
import type { Workspace } from '../../../application/workspace/workspace.ts';

const manifestPath = '.claude-plugin/plugin.json';
type AssetKind = 'agent' | 'hooks' | 'mcp' | 'lsp' | 'settings' | 'other';
interface Reference { path: string; kind: AssetKind; file: boolean }
interface Diagnostic { path: string; severity: 'error' | 'warning'; message: string }

function decode(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw forgeError('INVALID_ENCODING', 'Claude plugin text assets must be valid UTF-8.'); }
}
function json(bytes: Uint8Array, path: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(decode(bytes)); }
  catch (error) { throw forgeError('INVALID_CLAUDE_PLUGIN', `${path}: ${errorMessage(error)}`); }
  ensure(isRecord(value), 'INVALID_CLAUDE_PLUGIN', `${path} must contain a JSON object.`);
  return value;
}
function nativeReferences(manifest: Record<string, unknown>): Reference[] {
  const result: Reference[] = [];
  const add = (value: unknown, kind: AssetKind = 'other', file = false) => {
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (typeof entry !== 'string' || entry.startsWith('https://')) continue;
      const path = entry.replace(/^\.\//, '').replace(/\/+$/, '');
      result.push({ path: path === '.' ? '' : path, kind, file });
    }
  };
  for (const key of ['skills', 'outputStyles', 'workflows', 'themes']) add(manifest[key]);
  add(manifest.agents, 'agent', true);
  add(manifest.types, 'other', true);
  add(manifest.hooks, 'hooks', true);
  add(manifest.lspServers, 'lsp', true);
  add(manifest.mcpServers, 'mcp', true);
  add(manifest.monitors, 'other', true);
  if (isRecord(manifest.commands)) {
    for (const entry of Object.values(manifest.commands)) if (isRecord(entry)) add(entry.source, 'other', true);
  } else add(manifest.commands);
  if (isRecord(manifest.experimental)) {
    add(manifest.experimental.themes);
    add(manifest.experimental.monitors, 'other', true);
    add(Array.isArray(manifest.experimental.evals) ? manifest.experimental.evals[0] : manifest.experimental.evals);
  }
  return result;
}

/** Manage authored plugin files; installed plugins and their runtime lifecycle belong to Claude. */
export class ClaudePluginService {
  constructor(private readonly workspace: Workspace, private readonly agentCodec: ClaudeAgentCodec) {}

  async create(directory: string, manifest: unknown) {
    validateClaudePlugin(manifest);
    return this.saveManifest(directory, manifest);
  }

  async inspect(directory: string) {
    const root = vaultPath(directory), prefix = `${root}/`;
    const files = (await this.workspace.files.list()).filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length)).sort();
    try {
      const snapshot = await this.workspace.files.read(`${prefix}${manifestPath}`);
      return { directory: root, manifest: json(snapshot.bytes, manifestPath), revision: snapshot.revision, files };
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'NOT_FOUND') throw error;
      ensure(files.length > 0, 'NOT_FOUND', `No regular plugin files found in ${root}.`);
      return { directory: root, manifest: null, revision: null, inferredName: root.split('/').at(-1)!, files };
    }
  }

  async update(directory: string, manifest: unknown, revision: string) {
    this.requireRevision(revision);
    validateClaudePlugin(manifest);
    return this.saveManifest(directory, manifest, revision);
  }

  async asset(directory: string, path: string) {
    const target = this.path(directory, path), snapshot = await this.workspace.files.read(target);
    let document: unknown, validationError: string | undefined;
    try { document = this.workspace.codec.inspect(target, snapshot.bytes); }
    catch (error) {
      // Broken authored text must still be inspectable so it can be repaired with its revision.
      document = this.workspace.codec.inspect('plugin-asset', snapshot.bytes);
      validationError = errorMessage(error);
    }
    const result = { directory, asset: path, path: target, revision: snapshot.revision, bytes: snapshot.bytes.length, document, ...(validationError ? { validationError } : {}) };
    // A UTF-8 view makes native JSON/Markdown/scripts editable while the document retains lossless binary data.
    try { return { ...result, content: decode(snapshot.bytes) }; }
    catch { return result; }
  }

  async writeAsset(directory: string, path: string, bytes: Uint8Array, revision?: string) {
    const target = this.path(directory, path);
    if (revision !== undefined) this.requireRevision(revision);
    const snapshot = Uint8Array.from(bytes);
    if (path === manifestPath) validateClaudePlugin(json(snapshot, path));
    else {
      const { manifest } = await this.inspect(directory);
      if (manifest !== null) validateClaudePlugin(manifest);
      this.validateAsset(path, snapshot, manifest === null ? [] : nativeReferences(manifest));
    }
    const result = await this.workspace.write([{ path: target, bytes: snapshot, expectedRevision: revision }]);
    return { directory, asset: path, ...result };
  }

  async removeAsset(directory: string, path: string, revision: string) {
    this.requireRevision(revision);
    const target = this.path(directory, path);
    return { directory, asset: path, ...await this.workspace.remove(target, revision) };
  }

  async validate(directory: string) {
    const root = vaultPath(directory), diagnostics: Diagnostic[] = [];
    let inspected: Awaited<ReturnType<ClaudePluginService['inspect']>>;
    try {
      inspected = await this.inspect(root);
      if (inspected.manifest !== null) validateClaudePlugin(inspected.manifest);
    } catch (error) {
      return { directory: root, valid: false, diagnostics: [{ path: manifestPath, severity: 'error' as const, message: errorMessage(error) }], validation: 'structure' };
    }
    const references = inspected.manifest === null ? [] : nativeReferences(inspected.manifest);
    for (const reference of references) {
      if (reference.path === '') continue;
      const exists = reference.file ? inspected.files.includes(reference.path)
        : inspected.files.some(path => path === reference.path || path.startsWith(`${reference.path}/`));
      if (!exists) diagnostics.push({ path: reference.path, severity: reference.file ? 'error' : 'warning', message: reference.file
        ? 'Manifest component file was not found among regular plugin files.'
        : 'No regular files found at this declared component path; it may be empty or missing. Claude Code validation checks directory existence.' });
    }
    for (const path of inspected.files) {
      try {
        const snapshot = await this.workspace.files.read(this.path(root, path));
        const warnings = this.validateAsset(path, snapshot.bytes, references);
        for (const message of warnings) diagnostics.push({ path, severity: 'warning', message });
      } catch (error) {
        diagnostics.push({ path, severity: 'error', message: errorMessage(error) });
      }
    }
    return { ...inspected, valid: !diagnostics.some(item => item.severity === 'error'), diagnostics, validation: 'structure',
      limitations: ['No plugin code, hooks, MCP or LSP servers were executed.', 'Claude Code remains authoritative for runtime compatibility and version-specific fields.'],
    };
  }

  private path(directory: string, path: string): string { return vaultPath(`${vaultPath(directory)}/${vaultPath(path)}`); }
  private requireRevision(revision: string): void {
    ensure(typeof revision === 'string' && revision.length > 0, 'MISSING_ARGUMENT', 'A current revision is required to replace or remove a plugin asset.');
  }
  private async saveManifest(directory: string, manifest: Record<string, unknown>, revision?: string) {
    const path = this.path(directory, manifestPath), content = `${JSON.stringify(manifest, null, 2)}\n`;
    const result = await this.workspace.write([{ path, bytes: new TextEncoder().encode(content), expectedRevision: revision }]);
    return { directory, manifest, ...result, ...(this.workspace.dryRun ? { preview: [{ path, content }] } : {}) };
  }
  private validateAsset(path: string, bytes: Uint8Array, references: Reference[]): string[] {
    const warnings: string[] = [];
    if (path === manifestPath) { validateClaudePlugin(json(bytes, path)); return warnings; }
    const kinds = new Set<AssetKind>(references.filter(reference => reference.path === path).map(reference => reference.kind));
    if (path.startsWith('agents/') && path.endsWith('.md')) kinds.add('agent');
    if (path === 'hooks/hooks.json') kinds.add('hooks');
    if (path === '.mcp.json') kinds.add('mcp');
    if (path === '.lsp.json') kinds.add('lsp');
    if (path === 'settings.json') kinds.add('settings');
    if (kinds.has('agent')) {
      const { metadata } = this.agentCodec.parse(decode(bytes));
      for (const key of claudePluginCapabilities.ignoredPluginAgentFields) {
        if (Object.hasOwn(metadata, key)) warnings.push(`Claude ignores ${key} in plugin agents; use a project/user agent for per-agent configuration.`);
      }
    }
    if (kinds.has('hooks')) {
      const config = json(bytes, path);
      ensure(config.hooks !== undefined || config.modules !== undefined, 'INVALID_CLAUDE_PLUGIN', `${path}: hook files require a hooks wrapper, or modules for a Claude mod.`);
      if (config.hooks !== undefined) validateClaudeHooks(config.hooks);
      if (config.modules !== undefined) ensure(Array.isArray(config.modules) && config.modules.every(entry => typeof entry === 'string'), 'INVALID_CLAUDE_PLUGIN', `${path}: modules must be an array of module paths.`);
    }
    if (kinds.has('mcp') && !/\.(mcpb|dxt)$/.test(path)) {
      const config = json(bytes, path);
      validateClaudePlugin({ name: 'asset-validation', mcpServers: config.mcpServers ?? config });
    }
    if (kinds.has('lsp')) validateClaudePlugin({ name: 'asset-validation', lspServers: json(bytes, path) });
    if (kinds.has('settings')) validateClaudePlugin({ name: 'asset-validation', settings: json(bytes, path) });
    this.workspace.codec.validate(path, bytes);
    return warnings;
  }
}
