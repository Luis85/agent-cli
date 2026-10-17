import type { Command } from '../../../application/plugins/registry.ts';
import { option } from '../../../application/plugins/command-metadata.ts';
import { arity, value } from '../../../application/plugins/command-input.ts';
import { ensure } from '../../../domain/shared/errors.ts';
import type { JsonSchema } from '../../../domain/schema/json-schema.ts';
import type { WebviewPublication } from '../application/publish.ts';

const nullableRevision: JsonSchema = { oneOf: [{ type: 'string' }, { type: 'null' }] };
const report: JsonSchema = {
  type: 'object', required: ['id', 'source', 'destination', 'built', 'installed', 'revision', 'current', 'files'],
  properties: {
    id: { type: 'string' }, source: { const: 'dist' }, destination: { type: 'string' },
    built: { type: 'boolean' }, installed: { type: 'boolean' }, revision: nullableRevision, current: { type: 'boolean' },
    files: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['path', 'sourceRevision', 'installedRevision', 'status'], properties: {
        path: { type: 'string' }, sourceRevision: nullableRevision, installedRevision: nullableRevision,
        status: { enum: ['missing', 'changed', 'unchanged', 'obsolete'] },
      } } },
    changed: { type: 'boolean' }, checked: { const: true }, dryRun: { type: 'boolean' },
    changes: { type: 'array', items: { type: 'object' } },
  }, additionalProperties: false,
};

export function webviewCommand(publication: WebviewPublication): Command {
  return {
    id: 'webview', description: 'Inspect and publish the selected self-contained webview project.',
    usage: 'webview [inspect | publish [--if-match <revision>] [--check]] [--project <id>]',
    scope: 'project', projectOption: 'project', discovery: false, mutating: false, defaultAction: 'inspect', unknownAction: 'INVALID_ARGUMENT',
    options: { project: option.string('Inspect or publish this project instead of the selected one.') },
    args: [{ name: 'action', description: 'inspect (default) or publish.', enum: ['inspect', 'publish'] }],
    actions: {
      inspect: { description: 'Compare dist with the installed webview and return its current folder revision.', output: report },
      publish: { description: 'Publish dist with revision guards, or check drift without writing with --check.', mutating: true, destructive: true, idempotent: true, output: report,
        options: {
          'if-match': option.string('The installed folder revision from webview inspect; required to replace a changed view.'),
          check: option.boolean('Check publication drift without writing; fail with WEBVIEW_DRIFT when assets differ.'),
        } },
    },
    errors: ['PROJECT_REQUIRED', 'INVALID_ARGUMENT', 'WEBVIEW_INVALID', 'WEBVIEW_BUILD_REQUIRED', 'WEBVIEW_PROJECT_REQUIRED', 'WEBVIEW_DRIFT', 'CONFLICT', 'UNSAFE_PATH', 'INVALID_PATH', 'NOT_FOUND'],
    async run(args, flags, context) {
      arity(args, 0, 1);
      if ((args[0] ?? 'inspect') === 'inspect') return publication.inspect(context);
      const ifMatch = value(flags, 'if-match');
      ensure(!(flags.check && ifMatch !== undefined), 'INVALID_ARGUMENT', '--check does not accept --if-match.');
      ensure(ifMatch === undefined || /^[a-f0-9]{64}$/.test(ifMatch), 'INVALID_ARGUMENT', '--if-match must be the SHA-256 folder revision from webview inspect.');
      return publication.publish(context, { check: flags.check === true, ifMatch });
    },
  };
}
