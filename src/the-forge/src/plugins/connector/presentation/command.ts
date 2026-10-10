import type { Command } from '../../../application/plugins/registry.ts';
import { arity } from '../../../application/plugins/command-input.ts';
import type { BoundConnection } from '../../../application/connectors/contract.ts';
import { ensure } from '../../../domain/shared/errors.ts';
import { tokenSet, type Hub } from '../application/hub.ts';

const actions = ['list', 'inspect', 'test'];

/** A connection as JSON: the secret-free profile summary; never the credential, only whether its variable is set. */
function connectionJson({ connection, connector }: BoundConnection, environment: (name: string) => string | undefined) {
  return {
    id: connection.id, platform: connection.platform, tokenEnv: connection.tokenEnv, tokenSet: tokenSet(connection, environment),
    linkProperty: connection.linkProperty, effortProperty: connection.effortProperty, ...connector.describe().summary(connection),
  };
}

/** The `connectors` command: list, inspect and probe the connection profiles of `plugins.settings.connector`. */
export function connectorsCommand(hub: Hub, environment: (name: string) => string | undefined): Command {
  return {
    id: 'connectors',
    description: 'List, inspect and test the backlog connector connections configured in plugins.settings.connector.connections.',
    usage: 'connectors list | inspect <id> | test <id>',
    scope: 'workspace', discovery: false, mutating: false, defaultAction: 'list',
    actions: {
      list: { description: 'Every connection with its platform, validity and whether its token variable is set.' },
      inspect: { description: 'One connection with its resolved type, state and field mappings.' },
      test: { description: 'An authenticated, read-only probe of one connection.' },
    },
    args: [
      { name: 'action', description: actions.join(', '), enum: actions },
      { name: 'id', description: 'The connection id (inspect, test).' },
    ],
    errors: ['CONNECTOR_NOT_FOUND', 'CONNECTION_INVALID', 'CONNECTOR_AUTH_FAILED', 'CONNECTOR_REQUEST_FAILED'],
    async run(args) {
      const [action = 'list', ...rest] = args;
      ensure(actions.includes(action), 'INVALID_ARGUMENT', `Use connectors ${actions.join(', connectors ')}.`);
      if (action === 'list') {
        arity(rest, 0);
        return {
          platforms: hub.platforms(),
          connections: hub.statuses().map(status => ({
            ...(status.bound ? connectionJson(status.bound, environment) : { id: status.profile.id, platform: status.profile.platform }),
            available: status.connector !== null, valid: status.issues.length === 0, issues: status.issues,
          })),
        };
      }
      arity(rest, 1);
      const bound = hub.connection(rest[0]!);
      if (action === 'inspect') {
        const description = bound.connector.describe();
        return { connection: connectionJson(bound, environment), platform: { id: description.platform, name: description.name, description: description.description }, mapping: bound.connector.mapping(bound.connection) };
      }
      const probe = await bound.connector.test(bound.connection);
      return { connection: bound.connection.id, platform: bound.connection.platform, ok: probe.ok, target: probe.target };
    },
  };
}
