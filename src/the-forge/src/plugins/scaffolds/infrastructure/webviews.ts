import gitignoreTemplate from '../../../../docs/templates/projects/webview/.gitignore.txt?raw';
import agentsMdTemplate from '../../../../docs/templates/projects/webview/AGENTS.md.txt?raw';
import designMdTemplate from '../../../../docs/templates/projects/webview/DESIGN.md.txt?raw';
import productMdTemplate from '../../../../docs/templates/projects/webview/PRODUCT.md.txt?raw';
import readmeMdTemplate from '../../../../docs/templates/projects/webview/README.md.txt?raw';
import indexHtmlTemplate from '../../../../docs/templates/projects/webview/index.html.txt?raw';
import packageJsonTemplate from '../../../../docs/templates/projects/webview/package.json.txt?raw';
import playwrightConfigTsTemplate from '../../../../docs/templates/projects/webview/playwright.config.ts.txt?raw';
import publicManifestJsonTemplate from '../../../../docs/templates/projects/webview/public/manifest.json.txt?raw';
import scriptsForgeMjsTemplate from '../../../../docs/templates/projects/webview/scripts/forge.mjs.txt?raw';
import scriptsLicensesLucideLICENSETemplate from '../../../../docs/templates/projects/webview/scripts/licenses/lucide-LICENSE.txt?raw';
import scriptsNoticesTsTemplate from '../../../../docs/templates/projects/webview/scripts/notices.ts.txt?raw';
import srcAppVueTemplate from '../../../../docs/templates/projects/webview/src/App.vue.txt?raw';
import srcInfrastructureWorkflowsCheckCheckYmlTemplate from '../../../../docs/templates/projects/webview/src/infrastructure/workflows/check/check.yml.txt?raw';
import srcMainTsTemplate from '../../../../docs/templates/projects/webview/src/main.ts.txt?raw';
import srcPrototypeTsTemplate from '../../../../docs/templates/projects/webview/src/prototype.ts.txt?raw';
import srcStyleCssTemplate from '../../../../docs/templates/projects/webview/src/style.css.txt?raw';
import srcViteEnvDTsTemplate from '../../../../docs/templates/projects/webview/src/vite-env.d.ts.txt?raw';
import testsE2eSupportForgeTsTemplate from '../../../../docs/templates/projects/webview/tests/e2e/support/forge.ts.txt?raw';
import testsE2eWebviewE2eTestTsTemplate from '../../../../docs/templates/projects/webview/tests/e2e/webview.e2e.test.ts.txt?raw';
import testsPrototypeUnitTestTsTemplate from '../../../../docs/templates/projects/webview/tests/prototype.unit.test.ts.txt?raw';
import tsconfigJsonTemplate from '../../../../docs/templates/projects/webview/tsconfig.json.txt?raw';
import viteConfigTsTemplate from '../../../../docs/templates/projects/webview/vite.config.ts.txt?raw';
import vitestConfigTsTemplate from '../../../../docs/templates/projects/webview/vitest.config.ts.txt?raw';

import { vaultPath, type WriteRequest } from '../../../domain/documents/file.ts';
import { projectName } from '../../../application/projects/projects.ts';

const templates: Readonly<Record<string, string>> = {
  '.gitignore': gitignoreTemplate,
  'AGENTS.md': agentsMdTemplate,
  'DESIGN.md': designMdTemplate,
  'PRODUCT.md': productMdTemplate,
  'README.md': readmeMdTemplate,
  'index.html': indexHtmlTemplate,
  'package.json': packageJsonTemplate,
  'playwright.config.ts': playwrightConfigTsTemplate,
  'public/manifest.json': publicManifestJsonTemplate,
  'scripts/forge.mjs': scriptsForgeMjsTemplate,
  'scripts/licenses/lucide-LICENSE': scriptsLicensesLucideLICENSETemplate,
  'scripts/notices.ts': scriptsNoticesTsTemplate,
  'src/App.vue': srcAppVueTemplate,
  'src/infrastructure/workflows/check/check.yml': srcInfrastructureWorkflowsCheckCheckYmlTemplate,
  'src/main.ts': srcMainTsTemplate,
  'src/prototype.ts': srcPrototypeTsTemplate,
  'src/style.css': srcStyleCssTemplate,
  'src/vite-env.d.ts': srcViteEnvDTsTemplate,
  'tests/e2e/support/forge.ts': testsE2eSupportForgeTsTemplate,
  'tests/e2e/webview.e2e.test.ts': testsE2eWebviewE2eTestTsTemplate,
  'tests/prototype.unit.test.ts': testsPrototypeUnitTestTsTemplate,
  'tsconfig.json': tsconfigJsonTemplate,
  'vite.config.ts': viteConfigTsTemplate,
  'vitest.config.ts': vitestConfigTsTemplate,
};

/** A complete project-owned starter; generated projects import no Forge or sibling source files. */
export function webviewScaffold(name: string, projectsDirectory: string): WriteRequest[] {
  const directory = `${vaultPath(projectsDirectory)}/${projectName(name, 'webview')}`;
  const workspaceRelative = '../'.repeat(directory.split('/').length);
  const files = {
    '.forge/project.json': JSON.stringify({ schemaVersion: 1, name, type: 'webview' }, null, 2) + '\n',
    ...templates,
  };
  return Object.entries(files).map(([path, source]) => ({
    path: `${directory}/${path}`,
    bytes: new TextEncoder().encode(source.replaceAll('__FORGE_WEBVIEW_ID__', name).replaceAll('__FORGE_WORKSPACE_RELATIVE__', workspaceRelative)),
  }));
}
