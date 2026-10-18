import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import { WebviewPublication } from './application/publish.ts';
import { readWebviewAssets } from './infrastructure/assets.ts';
import { webviewsSkill } from './infrastructure/skill.ts';
import { webviewCommand } from './presentation/commands.ts';
import { webviewsStrings } from './presentation/strings.ts';

export const webviewsPlugin: CorePlugin = {
  manifest: { id: 'webviews', name: 'Webviews', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
    description: 'Inspect self-contained webview projects and safely publish their static builds locally.' },
  strings: webviewsStrings,
  create: () => ({
    commands: [webviewCommand(new WebviewPublication(readWebviewAssets))], skills: [webviewsSkill],
    errors: [
      { code: 'WEBVIEW_INVALID', category: 'input', summary: 'The webview build is invalid.', hint: 'Inspect dist and manifest.json; use only regular static files and the matching project id.' },
      { code: 'WEBVIEW_BUILD_REQUIRED', category: 'input', summary: 'The webview build is missing.', hint: 'Run npm run build in the selected project, then run webview inspect.' },
      { code: 'WEBVIEW_PROJECT_REQUIRED', category: 'input', summary: 'The project is not a webview project.', hint: 'Pass --project <webview-id>, or run project open <webview-id>; project list shows each project\'s type.' },
      { code: 'WEBVIEW_DRIFT', category: 'drift', summary: 'The installed webview differs from the build.', hint: 'Run webview inspect and publish the reviewed build; replacing an installed view requires --if-match.' },
    ],
  }),
};
