import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import { createBrowserRuntime } from './infrastructure/runtime.ts';
import { browserSkill } from './infrastructure/skill.ts';
import { browserCommand } from './presentation/commands.ts';
import { browserStrings } from './presentation/strings.ts';

/** Composition supplies the portable distribution; browser capabilities never depend on a project's npm packages. */
export function browserPlugin(distributionPath: string): CorePlugin {
  return {
    manifest: { id: 'browser', name: 'Browser', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
      description: 'Capture guarded webpage screenshots and repeatable illustrated tutorials with a managed browser.' },
    strings: browserStrings,
    create: () => ({
      commands: [browserCommand(createBrowserRuntime(distributionPath))], skills: [browserSkill],
      errors: [
        { code: 'BROWSER_UNAVAILABLE', category: 'runtime', summary: 'The browser runtime or executable is unavailable.', hint: 'Run browser status, then browser install, or pass --browser-executable for an installed Chromium browser.' },
        { code: 'BROWSER_CAPTURE_FAILED', category: 'runtime', summary: 'The webpage could not be captured.', hint: 'Check the URL, browser availability and readiness selector; no screenshot was written.' },
        { code: 'BROWSER_INSTALL_FAILED', category: 'external', summary: 'The managed browser installation failed.', hint: 'Check network access and disk permissions, then retry browser install or use --browser-executable.' },
        { code: 'BROWSER_FLOW_INVALID', category: 'input', summary: 'The declared tutorial flow is invalid.', hint: 'Run browser validate and correct the source, action, locator or output path named in the diagnostic.' },
        { code: 'BROWSER_FLOW_FAILED', category: 'runtime', summary: 'The tutorial flow could not complete.', hint: 'Inspect the failing step, repair the declared flow and retry; existing tutorial output was preserved.' },
      ],
    }),
  };
}
