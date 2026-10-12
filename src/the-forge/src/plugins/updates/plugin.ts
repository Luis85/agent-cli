import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import { AppUpdate } from './application/update.ts';
import { githubReleases } from './infrastructure/github.ts';
import { updateCommand } from './presentation/commands.ts';
import type { DistributionPolicy } from './domain/release.ts';
import { updatesStrings } from './presentation/strings.ts';

export function updatesPlugin(policy: DistributionPolicy): CorePlugin { return {
  manifest: { id: 'updates', name: 'App updates', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
    description: 'Upgrade the portable app from GitHub Releases with revision guards while preserving workspace data.' },
  strings: updatesStrings,
  create: () => ({
    commands: [updateCommand(new AppUpdate(githubReleases(policy), policy))],
    errors: [
      { code: 'UPDATE_DOWNLOAD_FAILED', category: 'external', summary: 'The GitHub release could not be fetched.', hint: 'Check network access, curl, tar and disk space, then retry.' },
      { code: 'UPDATE_INVALID', category: 'input', summary: 'The release version or archive is invalid.', hint: 'Inspect the stable release version, checksum and distribution manifest; the existing app was preserved.' },
      { code: 'UPDATE_SCOPE_INVALID', category: 'input', summary: 'The target workspace has no installed Forge distribution.', hint: 'Install a release first or use --root to select the correct workspace.' },
    ],
  }),
}; }
