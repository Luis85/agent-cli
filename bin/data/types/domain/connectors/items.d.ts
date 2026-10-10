/**
 * The platform-neutral data model of backlog connectors: the neutral sync fields, remote items, drafts, patches and
 * per-connection mappings. The connector port (`application/connectors/contract.ts`) exchanges these values.
 */
/** The neutral fields the sync engine compares per item. */
export declare const SYNC_FIELDS: readonly ["title", "type", "state", "parent", "iteration", "priority", "effort", "tags", "description"];
export type SyncField = typeof SYNC_FIELDS[number];
/** One remote work item in neutral form. Values use the remote vocabulary (type and state names, iteration paths). */
export interface RemoteItem {
    id: string;
    /** The remote revision; updates are guarded with it. */
    rev: string;
    /** The item's web URL, written into the note's link property. */
    url: string;
    type: string;
    title: string;
    state: string | null;
    parentId?: string | null;
    iteration?: string | null;
    area?: string | null;
    priority?: number | null;
    effort?: number | null;
    tags: string[];
    /** Markdown; undefined when the remote description is in a format the connector cannot read back as Markdown. */
    description?: string | null;
    /** Remote ids of predecessors (dependencies), when the platform links them. */
    links?: {
        predecessors: string[];
    };
    /** Further mapped remote fields by remote field reference. */
    fields: Record<string, unknown>;
}
/** A remote item to create: the neutral fields plus mapped extra fields. */
export interface RemoteDraft {
    type: string;
    title: string;
    state?: string | null;
    parentId?: string | null;
    iteration?: string | null;
    area?: string | null;
    priority?: number | null;
    effort?: number | null;
    tags?: string[];
    description?: string | null;
    fields?: Record<string, unknown>;
}
/** Changed fields of an existing remote item; `null` clears a field. */
export type RemotePatch = Partial<Omit<RemoteDraft, 'area'>>;
/** What to query: explicit remote ids, or every item of the connection changed since an ISO timestamp. */
export type RemoteQuery = {
    ids: readonly string[];
} | {
    changedSince: string;
};
/**
 * Resolved mappings of one connection. `types` and `states` map local (backlog) names to remote names; a state key
 * may be qualified with a local type (`Task:Active`). `fields` names the remote field of each neutral field, or
 * null when the field is not synced. `properties` maps extra frontmatter keys to remote fields.
 */
export interface ConnectorMapping {
    types: Record<string, string>;
    states: Record<string, string>;
    fields: Record<SyncField, string | null>;
    properties: Record<string, string>;
}
