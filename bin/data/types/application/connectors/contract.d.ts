import type { JsonSchema } from '../../domain/schema/json-schema.ts';
import type { ConnectorMapping, RemoteDraft, RemoteItem, RemotePatch } from '../../domain/connectors/items.ts';
/**
 * The platform-neutral backlog connector contract. A connector maps one external work tracker (Azure DevOps Boards
 * first; GitHub and Jira later) onto neutral remote items; the backlog sync engine compares and writes them without
 * knowing the platform. Connectors are plugin services registered with the `connectors` hub service.
 */
/**
 * One configured connection profile (`plugins.settings.connector.connections.<id>`). `settings` holds the complete
 * validated profile, including platform-specific fields. `token()` reads the credential from the environment
 * variable named by `tokenEnv` when a request needs it; it is never serialized, logged or returned.
 */
export interface Connection {
    id: string;
    platform: string;
    tokenEnv: string;
    /** The frontmatter key that holds the remote item URL. */
    linkProperty: string;
    /** The frontmatter key of the neutral effort field. */
    effortProperty: string;
    /** The frontmatter key of the neutral area field. */
    areaProperty: string;
    settings: Readonly<Record<string, unknown>>;
    token(): string;
}
/** A connector's self-description for `connectors list|inspect`. */
export interface ConnectorDescription {
    platform: string;
    name: string;
    description: string;
    /** Profile defaults: the credential variable and the frontmatter link key. */
    defaults: {
        tokenEnv: string;
        linkProperty: string;
    };
    /** JSON Schema of the platform's connection profile, validated by the hub. */
    connectionSchema: JsonSchema;
    /** A short, secret-free summary of a profile (organization, project, process). */
    summary(connection: Connection): Record<string, unknown>;
    /** Diagnostics about a valid profile that deserve a second look (for example an unexpected host); empty when none. */
    warnings(connection: Connection): string[];
}
/** The result of an authenticated, read-only probe. */
export interface ProbeResult {
    ok: true;
    target: Record<string, unknown>;
}
/** One platform. Every member that talks to the platform is read-only except `create` and `update`. */
export interface BacklogConnector {
    readonly id: string;
    describe(): ConnectorDescription;
    /** The connection's mapping: the process defaults merged with its `mappings` overrides. */
    mapping(connection: Connection): ConnectorMapping;
    /** The web URL of a remote item, and the remote id a URL names for this connection (null when it is foreign). */
    link(connection: Connection, id: string): string;
    idFromLink(connection: Connection, url: string): string | null;
    test(connection: Connection): Promise<ProbeResult>;
    /** The readable remote items with these ids; ids that do not exist or are not readable are left out. */
    query(connection: Connection, ids: readonly string[]): Promise<RemoteItem[]>;
    /**
     * Creates an item and returns it as stored. Platforms that create items in an initial state follow up with an
     * update to the drafted state; if that follow-up fails, the created item is still returned (in its initial
     * state), so the caller never loses the new id.
     */
    create(connection: Connection, item: RemoteDraft): Promise<RemoteItem>;
    /** Applies `patch` only while the remote item is still at `expectedRev`; otherwise fails with `details.reason: 'stale-revision'`. */
    update(connection: Connection, id: string, patch: RemotePatch, expectedRev: string): Promise<RemoteItem>;
}
/** A connection bound to its platform connector. */
export interface BoundConnection {
    connection: Connection;
    connector: BacklogConnector;
}
/** Payloads of the hub's `connector.*` events. */
export interface ConnectorEventPayloads {
    pushed: {
        connection: string;
        platform: string;
        path: string;
        remoteId: string;
        url: string;
        operation: 'create' | 'update';
        fields: string[];
    };
    pulled: {
        connection: string;
        platform: string;
        path: string;
        remoteId: string;
        url: string;
        fields: string[];
    };
    conflict: {
        connection: string;
        platform: string;
        path: string;
        remoteId: string;
        url: string;
        fields: string[];
    };
}
/** The `connectors` hub service: connection profiles from workspace config and the registered platform connectors. */
export interface ConnectorHub {
    register(connector: BacklogConnector): void;
    /** The connection with its connector; CONNECTOR_NOT_FOUND or CONNECTION_INVALID otherwise. */
    connection(id: string): BoundConnection;
    /** Configured connection ids in config order. */
    ids(): string[];
    /** Publishes a `connector.*` event (owned by the hub's plugin) after a committed sync step. */
    report<Name extends keyof ConnectorEventPayloads>(name: Name, payload: ConnectorEventPayloads[Name]): Promise<void>;
}
