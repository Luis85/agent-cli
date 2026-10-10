import type { BacklogConnector, BoundConnection, Connection, ConnectorEventPayloads, ConnectorHub } from '../../../application/connectors/contract.ts';
import type { EventChannel } from '../../../application/plugins/events.ts';
import { validateJsonValue } from '../../../domain/schema/json-schema.ts';
import { isRecord } from '../../../domain/shared/errors.ts';
import { CONNECTION_ID, profiles, type Profile } from '../domain/profiles.ts';

type ConnectorErrorCode = 'CONNECTOR_NOT_FOUND' | 'CONNECTION_INVALID' | 'CONNECTOR_AUTH_FAILED' | 'CONNECTOR_REQUEST_FAILED';
function connectorError(code: ConnectorErrorCode, message: string, details?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
}

/** A profile's state for `connectors list`: whether its platform is available and its profile valid. */
export interface ConnectionStatus { profile: Profile; connector: BacklogConnector | null; issues: string[]; bound: BoundConnection | null }

/**
 * The `connectors` service. Platform connectors register here when they load; connection profiles come from the
 * `connector` plugin's settings, which the plugin binds on activation together with its event channel, so only the
 * owning plugin publishes `connector.*` events.
 */
export class Hub implements ConnectorHub {
  private readonly connectors = new Map<string, BacklogConnector>();
  private settings: Readonly<Record<string, unknown>> | null = null;
  private events: EventChannel | null = null;

  constructor(private readonly environment: (name: string) => string | undefined) {}

  bind(settings: Readonly<Record<string, unknown>> | null, events: EventChannel): void {
    this.settings = settings;
    this.events = events;
  }

  register(connector: BacklogConnector): void {
    if (this.connectors.has(connector.id)) throw connectorError('CONNECTION_INVALID', `Two connectors register the platform ${connector.id}.`, { platform: connector.id });
    this.connectors.set(connector.id, connector);
  }

  platforms(): string[] { return [...this.connectors.keys()].sort(); }
  ids(): string[] { return profiles(this.settings).map(profile => profile.id); }

  /** Every profile with its validation result, for listing; never throws for one bad profile. */
  statuses(): ConnectionStatus[] {
    return profiles(this.settings).map(profile => {
      const connector = this.connectors.get(profile.platform) ?? null;
      if (connector === null) return { profile, connector, issues: [`platform ${profile.platform} is not available; enable its connector plugin`], bound: null };
      const { connection, issues } = this.build(profile, connector);
      return { profile, connector, issues, bound: issues.length === 0 ? { connection, connector } : null };
    });
  }

  connection(id: string): BoundConnection {
    const profile = profiles(this.settings).find(entry => entry.id === id);
    if (profile === undefined) throw connectorError('CONNECTOR_NOT_FOUND', `No connection ${id} is configured in plugins.settings.connector.connections.`, { connection: id, connections: this.ids() });
    const connector = this.connectors.get(profile.platform);
    if (connector === undefined) throw connectorError('CONNECTOR_NOT_FOUND', `Connection ${id} uses the platform ${profile.platform}, which no enabled connector provides.`, { connection: id, platform: profile.platform, platforms: this.platforms() });
    const { connection, issues } = this.build(profile, connector);
    if (issues.length > 0) throw connectorError('CONNECTION_INVALID', `Connection ${id} is invalid: ${issues.join('; ')}`, { connection: id, issues });
    return { connection, connector };
  }

  async report<Name extends keyof ConnectorEventPayloads>(name: Name, payload: ConnectorEventPayloads[Name]): Promise<void> {
    await this.events?.emit(`connector.${name}`, payload);
  }

  private build(profile: Profile, connector: BacklogConnector): { connection: Connection; issues: string[] } {
    const description = connector.describe();
    const path = `plugins.settings.connector.connections.${profile.id}`;
    const checked = validateJsonValue(description.connectionSchema, profile.specific, path);
    const issues = [...(CONNECTION_ID.test(profile.id) ? [] : [`${path}: connection ids are lowercase kebab-case`]), ...checked.issues];
    const tokenEnv = profile.tokenEnv ?? description.defaults.tokenEnv;
    const environment = this.environment;
    const settings = { ...(isRecord(checked.value) ? checked.value : {}), platform: profile.platform, tokenEnv, mappings: profile.mappings };
    const connection: Connection = {
      id: profile.id, platform: profile.platform, tokenEnv,
      linkProperty: profile.linkProperty ?? description.defaults.linkProperty, effortProperty: profile.effortProperty, areaProperty: profile.areaProperty, settings,
      token() {
        const value = environment(tokenEnv)?.trim();
        if (!value) throw connectorError('CONNECTOR_AUTH_FAILED', `Set the environment variable ${tokenEnv} to an access token for connection ${profile.id}.`, { connection: profile.id, tokenEnv });
        return value;
      },
    };
    return { connection, issues };
  }
}

/** Whether a connection's credential variable is set, without reading it into any output. */
export function tokenSet(connection: Pick<Connection, 'tokenEnv'>, environment: (name: string) => string | undefined): boolean {
  return (environment(connection.tokenEnv)?.trim() ?? '') !== '';
}
