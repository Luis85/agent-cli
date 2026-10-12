import type { Command } from '../../application/plugins/registry.ts';
import { arity, integer, value } from '../../application/plugins/command-input.ts';
import { option } from '../../application/plugins/command-metadata.ts';
import type { ServerController } from '../../application/server/contracts.ts';
import type { JsonSchema } from '../../domain/schema/json-schema.ts';
import { ensure } from '../../domain/shared/errors.ts';

const statusOutput: JsonSchema = {
  type: 'object', required: ['running', 'stale', 'server', 'url', 'webviews'], additionalProperties: false,
  properties: {
    running: { type: 'boolean', description: 'The saved server passed its authenticated identity check.' },
    stale: { type: 'boolean', description: 'Saved state exists, but its server could not be verified as running.' },
    server: { oneOf: [{ type: 'null' }, {
      type: 'object', required: ['pid', 'startedAt', 'host', 'port', 'version', 'nodeVersion', 'uptimeSeconds'], additionalProperties: false,
      properties: {
        pid: { type: 'integer', minimum: 1 }, startedAt: { type: 'string' }, host: { const: '127.0.0.1' },
        port: { type: 'integer', minimum: 1, maximum: 65535 }, version: { type: 'string' },
        nodeVersion: { type: 'string' }, uptimeSeconds: { type: 'number', minimum: 0 },
      },
    }] },
    url: { description: 'Local launch link containing an access token; null when stopped. Use start --webview <id> for a view-specific link.', oneOf: [{ type: 'string' }, { type: 'null' }] },
    webviews: { type: 'array', items: {
      type: 'object', required: ['id', 'name', 'path'], additionalProperties: false,
      properties: { id: { type: 'string' }, name: { type: 'string' }, path: { type: 'string' } },
    } },
    dryRun: { const: true, description: 'Lifecycle preview only; no process or saved state changes.' },
    changed: { type: 'boolean', description: 'Whether lifecycle state changed, or would change during a dry run.' },
  },
};
const lifecycleOutput: JsonSchema = { ...statusOutput, required: [...statusOutput.required!, 'changed'] };

/** The injected controller owns processes; CLI metadata owns workspace routing and dry-run propagation. */
export function serverCommands(controller: ServerController): Command[] {
  return [{
    id: 'server', description: 'Manage the workspace localhost server and discover its installed webviews.',
    usage: 'server [status | start [--port 0..65535] [--webview <id>] [--dry-run] | stop [--dry-run]]',
    scope: 'workspace', discovery: true, mutating: false, defaultAction: 'status', unknownAction: 'INVALID_ARGUMENT',
    args: [{ name: 'action', description: 'status (default), start or stop.', enum: ['status', 'start', 'stop'] }],
    output: statusOutput,
    actions: {
      status: { description: 'Inspect the workspace server and discover installed webviews, including while stopped.', mutating: false },
      start: {
        description: 'Start or reuse the localhost server and return its authenticated URL; no browser opens.',
        mutating: true, destructive: false, idempotent: true, output: lifecycleOutput,
        options: {
          port: option.string('TCP port from 0 to 65535; 0 chooses an available port. A running server keeps its current port.', { default: '0' }),
          webview: option.string('Installed webview id to include in the launch URL, such as admin.'),
        },
      },
      stop: { description: 'Stop the verified workspace server; repeated stops have no further effect.', mutating: true, destructive: false, idempotent: true, output: lifecycleOutput },
    },
    errors: ['SERVER_START_FAILED', 'SERVER_STOP_FAILED', 'SERVER_STATE_INVALID', 'SERVER_BUSY'],
    async run(args, flags, context) {
      arity(args, 0, 1);
      const action = args[0] ?? 'status';
      ensure(action === 'start' || action === 'stop' || action === 'status', 'INVALID_ARGUMENT', 'Use server status, server start or server stop.');
      ensure(action === 'start' || (flags.port === undefined && flags.webview === undefined), 'INVALID_ARGUMENT', '--port and --webview require server start.');
      if (action === 'status') return controller.status();
      const dryRun = context.workspace.dryRun;
      if (action === 'stop') return controller.stop({ dryRun });
      const port = integer(flags, 'port');
      ensure(port === undefined || port <= 65535, 'INVALID_ARGUMENT', '--port must be an integer from 0 to 65535.');
      const webview = value(flags, 'webview');
      ensure(webview === undefined || /^[a-z][a-z0-9-]*$/.test(webview), 'INVALID_ARGUMENT', '--webview must be a lowercase kebab-case installed webview id.');
      return controller.start({ dryRun, ...(port === undefined ? {} : { port }), ...(webview === undefined ? {} : { webview }) });
    },
  }];
}
