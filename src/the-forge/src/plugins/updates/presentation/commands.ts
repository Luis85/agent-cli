import type { Command } from '../../../application/plugins/registry.ts';
import { option } from '../../../application/plugins/command-metadata.ts';
import { arity, value } from '../../../application/plugins/command-input.ts';
import { ensure } from '../../../domain/shared/errors.ts';
import type { AppUpdate } from '../application/update.ts';
import { releaseVersion } from '../domain/release.ts';
import { updateCheckSchema, updateApplySchema } from './schemas.ts';

export function updateCommand(updater: AppUpdate): Command {
  return {
    id: 'update', description: 'Check GitHub Releases and upgrade this workspace app while preserving local settings.',
    usage: 'update [check [--release-version <version>] | apply --release-version <version> --if-match <revision>]',
    scope: 'workspace', discovery: true, mutating: false, defaultAction: 'check', unknownAction: 'INVALID_ARGUMENT',
    args: [{ name: 'action', description: 'check (default) or apply.', enum: ['check', 'apply'] }],
    actions: {
      check: { description: 'Inspect the installed revision and latest stable GitHub release without changing the app.', output: updateCheckSchema,
        options: { 'release-version': option.string('Check this pinned stable release instead of resolving latest.') } },
      apply: { description: 'Download, verify and apply a pinned release as one guarded batch; preserve mutable workspace data.',
        mutating: true, destructive: true, idempotent: true, output: updateApplySchema,
        options: {
          'release-version': option.string('Stable GitHub release version to install, such as 0.1.0.', { required: true }),
          'if-match': option.string('Installed bin folder revision returned by update check; required before upgrading.', { required: true }),
        } },
    },
    errors: ['INVALID_ARGUMENT', 'INVALID_PATH', 'NOT_FOUND', 'CONFLICT', 'UNSAFE_PATH', 'DESTINATION_EXISTS', 'UPDATE_INVALID', 'UPDATE_DOWNLOAD_FAILED', 'UPDATE_SCOPE_INVALID'],
    async run(args, flags, context) {
      arity(args, 0, 1);
      const action = args[0] ?? 'check';
      ensure(action === 'check' || action === 'apply', 'INVALID_ARGUMENT', 'Use update check or update apply.');
      if (action === 'check') return updater.check(context, value(flags, 'release-version'));
      const version = releaseVersion(value(flags, 'release-version', true)!);
      const revision = value(flags, 'if-match', true)!;
      ensure(/^[a-f0-9]{64}$/.test(revision), 'INVALID_ARGUMENT', '--if-match must be the SHA-256 folder revision from update check.');
      return updater.apply(context, version, revision);
    },
  };
}
