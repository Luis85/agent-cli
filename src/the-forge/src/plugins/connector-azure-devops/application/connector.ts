import type { BacklogConnector, Connection, ConnectorDescription, ProbeResult } from '../../../application/connectors/contract.ts';
import type { ConnectorMapping, RemoteDraft, RemoteItem, RemotePatch } from '../../../domain/connectors/items.ts';
import type { HttpClient, HttpResponse } from '../../../application/connectors/http.ts';
import type { JsonSchema } from '../../../domain/schema/json-schema.ts';
import { isRecord } from '../../../domain/shared/errors.ts';
import { redact } from '../../../domain/connectors/secrets.ts';
import { PROCESSES, processMapping, unknownFields, type MappingOverrides, type Process } from '../domain/processes.ts';
import { createOperations, remoteItem, updateOperations, type DescriptionFormat, type PatchContext } from '../domain/work-items.ts';

const API_VERSION = '7.1';
const BATCH_SIZE = 200;
// No user info (`user@host`): credentials come only from tokenEnv.
const organizationPattern = '^(https://[^\\s/?#@]+|http://(localhost|127\\.0\\.0\\.1|\\[::1\\])(:\\d+)?)(/[^\\s/?#@]+)*/?$';

const connectionSchema: JsonSchema = {
  type: 'object', additionalProperties: false, required: ['organization', 'project'],
  properties: {
    organization: { type: 'string', pattern: organizationPattern, description: 'The organization URL, for example https://dev.azure.com/contoso (https without user info; http only for localhost). The token is sent to this host.' },
    project: { type: 'string', minLength: 1, description: 'The project name.' },
    areaPath: { type: 'string', minLength: 1, description: 'The default area path: notes without an area property sync to it.' },
    iterationRoot: { type: 'string', minLength: 1, description: 'The iteration path under which iteration notes map by name, for example Trailhead or Trailhead\\Sprints.' },
    process: { type: 'string', enum: [...PROCESSES], default: 'agile', description: 'The process whose type, state and field defaults apply.' },
    descriptionFormat: { type: 'string', enum: ['markdown', 'html'], default: 'markdown', description: 'markdown syncs the note body both ways; html pushes converted HTML only (Azure DevOps Server).' },
  },
};

type ErrorCode = 'CONNECTOR_AUTH_FAILED' | 'CONNECTOR_REQUEST_FAILED';
const failure = (code: ErrorCode, message: string, details: Record<string, unknown>) => Object.assign(new Error(message), { code, details });
const setting = (connection: Connection, key: string) => (typeof connection.settings[key] === 'string' ? connection.settings[key] : undefined);
const organizationOf = (connection: Connection) => setting(connection, 'organization')!.replace(/\/+$/, '');
/** The connection's default area: its `areaPath`, else the project root. */
const defaultArea = (connection: Connection) => setting(connection, 'areaPath') ?? setting(connection, 'project')!;
/**
 * Iteration and area paths are required in Azure DevOps: an item without an iteration sits at the project root, and
 * one without an area in the connection's default area.
 */
function withDefaults<T extends { iteration?: string | null; area?: string | null }>(connection: Connection, change: T): T {
  return { ...change, ...(change.iteration === null ? { iteration: setting(connection, 'project')! } : {}), ...(change.area === null ? { area: defaultArea(connection) } : {}) };
}
const knownHost = (host: string) => host === 'dev.azure.com' || host.endsWith('.visualstudio.com');

/** Azure DevOps Boards over the Work Items REST API (api-version 7.1) with a personal access token. */
export class AzureDevOpsConnector implements BacklogConnector {
  readonly id = 'azure-devops';
  constructor(private readonly http: HttpClient) {}

  describe(): ConnectorDescription {
    return {
      platform: this.id, name: 'Azure DevOps Boards', description: 'Work items of one Azure DevOps project through the Work Items REST API 7.1.',
      defaults: { tokenEnv: 'AZURE_DEVOPS_EXT_PAT', linkProperty: 'azure-devops' }, connectionSchema,
      summary: connection => ({
        organization: organizationOf(connection), project: setting(connection, 'project'), process: setting(connection, 'process'),
        descriptionFormat: setting(connection, 'descriptionFormat'),
        ...(setting(connection, 'areaPath') ? { areaPath: setting(connection, 'areaPath') } : {}),
        ...(setting(connection, 'iterationRoot') ? { iterationRoot: setting(connection, 'iterationRoot') } : {}),
      }),
      warnings: connection => {
        let host: string;
        try { host = new URL(organizationOf(connection)).hostname.toLowerCase(); } catch { return []; }
        return knownHost(host) ? [] : [`organization host ${host} is neither dev.azure.com nor *.visualstudio.com; the token in ${connection.tokenEnv} is sent there (expected only for Azure DevOps Server).`];
      },
    };
  }

  mapping(connection: Connection): ConnectorMapping {
    const overrides = (isRecord(connection.settings.mappings) ? connection.settings.mappings : {}) as MappingOverrides;
    const unknown = unknownFields(overrides);
    if (unknown.length > 0) throw Object.assign(new Error(`Connection ${connection.id} maps unknown fields: ${unknown.join(', ')}.`), { code: 'CONNECTION_INVALID', details: { connection: connection.id, issues: unknown.map(name => `mappings.fields.${name}: not a neutral field`) } });
    return processMapping((setting(connection, 'process') ?? 'agile') as Process, overrides);
  }

  link(connection: Connection, id: string): string {
    return `${organizationOf(connection)}/${encodeURIComponent(setting(connection, 'project')!)}/_workitems/edit/${id}`;
  }

  idFromLink(connection: Connection, url: string): string | null {
    const match = /^(.*)\/_workitems\/edit\/(\d+)\/?$/i.exec(url.trim());
    if (!match) return null;
    const expected = `${organizationOf(connection)}/${setting(connection, 'project')}`.toLowerCase();
    let prefix: string;
    try { prefix = decodeURIComponent(match[1]!).toLowerCase(); } catch { return null; }
    return prefix === expected ? match[2]! : null;
  }

  async test(connection: Connection): Promise<ProbeResult> {
    const project = setting(connection, 'project')!;
    const json = await this.call(connection, 'GET', `${organizationOf(connection)}/_apis/projects/${encodeURIComponent(project)}?includeCapabilities=true&api-version=${API_VERSION}`);
    const capabilities = isRecord(json.capabilities) && isRecord(json.capabilities.processTemplate) ? json.capabilities.processTemplate : {};
    const processName = typeof capabilities.templateName === 'string' ? capabilities.templateName : null;
    return {
      ok: true,
      target: {
        organization: organizationOf(connection), project: json.name ?? project, projectId: json.id ?? null, state: json.state ?? null, process: processName,
        ...(processName !== null && setting(connection, 'process') !== 'custom' ? { processMatches: processName.toLowerCase() === setting(connection, 'process') } : {}),
      },
    };
  }

  async query(connection: Connection, ids: readonly string[]): Promise<RemoteItem[]> {
    const items: RemoteItem[] = [];
    const context = this.context(connection);
    for (let start = 0; start < ids.length; start += BATCH_SIZE) {
      // The batch read is a read-only POST, safe to retry when throttled.
      const json = await this.call(connection, 'POST', this.projectUrl(connection, `workitemsbatch?api-version=${API_VERSION}`), { ids: ids.slice(start, start + BATCH_SIZE).map(Number), $expand: 'relations', errorPolicy: 'omit' }, { retry: true });
      for (const entry of Array.isArray(json.value) ? json.value : []) if (isRecord(entry)) items.push(remoteItem(entry, context, id => this.link(connection, id)));
    }
    return items;
  }

  /**
   * Work item types start in their initial state, which processes may enforce on create: the item is created without
   * a state and then moved to the drafted state with a revision-guarded update. A failed move still returns the
   * created item. Creates are never retried automatically, so a throttled create cannot create a duplicate.
   */
  async create(connection: Connection, item: RemoteDraft): Promise<RemoteItem> {
    const context = this.context(connection);
    const { state, ...draft } = item;
    const operations = createOperations({ ...withDefaults(connection, draft), area: draft.area ?? defaultArea(connection) }, context);
    const json = await this.call(connection, 'POST', this.projectUrl(connection, `workitems/$${encodeURIComponent(item.type)}?api-version=${API_VERSION}`), operations, { contentType: 'application/json-patch+json' });
    const created = remoteItem(json, context, id => this.link(connection, id));
    if (state === undefined || state === null || state === created.state || context.mapping.fields.state === null) return created;
    try { return await this.update(connection, created.id, { state }, created.rev); }
    catch { return created; }
  }

  async update(connection: Connection, id: string, patch: RemotePatch, expectedRev: string): Promise<RemoteItem> {
    const context = this.context(connection);
    const url = this.projectUrl(connection, `workitems/${encodeURIComponent(id)}`);
    const relations = patch.parentId === undefined ? [] : (await this.call(connection, 'GET', `${url}?$expand=relations&api-version=${API_VERSION}`)).relations;
    const operations = updateOperations(withDefaults(connection, patch), expectedRev, context, Array.isArray(relations) ? relations : []);
    // The update starts with a test of the revision, so repeating it after throttling can never apply it twice.
    const json = await this.call(connection, 'PATCH', `${url}?$expand=relations&api-version=${API_VERSION}`, operations, { contentType: 'application/json-patch+json', retry: true });
    return remoteItem(json, context, item => this.link(connection, item));
  }

  private context(connection: Connection): PatchContext {
    return { mapping: this.mapping(connection), descriptionFormat: (setting(connection, 'descriptionFormat') ?? 'markdown') as DescriptionFormat, organization: organizationOf(connection), defaultArea: defaultArea(connection) };
  }

  private projectUrl(connection: Connection, path: string): string {
    return `${organizationOf(connection)}/${encodeURIComponent(setting(connection, 'project')!)}/_apis/wit/${path}`;
  }

  /** One authenticated JSON request; failures are coded, carry the status and never the token. */
  private async call(connection: Connection, method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown, options: { contentType?: string; retry?: boolean } = {}): Promise<Record<string, unknown>> {
    const contentType = options.contentType ?? 'application/json';
    const token = connection.token();
    const clean = (text: string) => redact(text, [token]);
    let response: HttpResponse;
    try {
      response = await this.http.request({
        method, url,
        headers: { Authorization: `Basic ${btoa(`:${token}`)}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': contentType }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(options.retry === undefined ? {} : { retry: options.retry }),
      });
    } catch (error) {
      throw failure('CONNECTOR_REQUEST_FAILED', clean(error instanceof Error ? error.message : String(error)), { connection: connection.id, status: null });
    }
    const details = { connection: connection.id, status: response.status, method, url: clean(url) };
    if (response.status === 401 || response.status === 403 || response.status === 203 || (response.status >= 300 && response.status < 400)) {
      throw failure('CONNECTOR_AUTH_FAILED', `Azure DevOps refused the token in ${connection.tokenEnv} for connection ${connection.id} (HTTP ${response.status}).`, { ...details, tokenEnv: connection.tokenEnv });
    }
    let json: unknown = null;
    try { json = response.body.trim() === '' ? {} : JSON.parse(response.body); } catch { json = null; }
    if (response.status >= 200 && response.status < 300 && isRecord(json)) return json;
    const message = isRecord(json) && typeof json.message === 'string' ? clean(json.message).slice(0, 300) : `HTTP ${response.status}`;
    const stale = response.status === 412 || /TF26071|\btest\b.*\brev\b|\/rev/i.test(message);
    throw failure('CONNECTOR_REQUEST_FAILED', `Azure DevOps ${method} failed for connection ${connection.id}: ${message}`, { ...details, ...(stale ? { reason: 'stale-revision' } : {}) });
  }
}
