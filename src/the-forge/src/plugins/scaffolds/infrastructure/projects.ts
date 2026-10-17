import typecheckScript from '../../../../scripts/quality/typecheck.mjs?raw';
import formModel from '../../../../docs/templates/projects/form-model.ts?raw';
import formView from '../../../../docs/templates/projects/form-view.ts?raw';
import demoHtml from '../../../../docs/templates/projects/project-demo.html.txt?raw';
import demoStyle from '../../../../docs/templates/projects/project-demo.css?raw';
import demoScript from '../../../../docs/templates/projects/project-demo.ts.txt?raw';
import readmeTemplate from '../../../../docs/templates/projects/library/README.md.txt?raw';
import agentsTemplate from '../../../../docs/templates/projects/library/AGENTS.md.txt?raw';
import gitignoreTemplate from '../../../../docs/templates/projects/library/.gitignore.txt?raw';
import viteConfigTemplate from '../../../../docs/templates/projects/library/vite.config.ts.txt?raw';
import indexTemplate from '../../../../docs/templates/projects/library/src/index.ts.txt?raw';
import publicApiTestTemplate from '../../../../docs/templates/projects/library/tests/public-api.integration.test.ts.txt?raw';
import domainComponentTemplate from '../../../../docs/templates/projects/library/component/domain.ts.txt?raw';
import domainComponentTestTemplate from '../../../../docs/templates/projects/library/component/domain.unit.test.ts.txt?raw';
import applicationComponentTemplate from '../../../../docs/templates/projects/library/component/application.ts.txt?raw';
import applicationComponentTestTemplate from '../../../../docs/templates/projects/library/component/application.unit.test.ts.txt?raw';
import { formDefinitionSource, formDefinitionTestSource } from './forms.ts';
import structureScript from '../../../../scripts/quality/structure.mjs?raw';
import testConfig from '../../../../vitest.config.ts?raw';
import lintScript from '../../../../scripts/quality/lint.mjs?raw';
import analyzeScript from '../../../../scripts/quality/analyze.mjs?raw';
import qualityShared from '../../../../scripts/quality/shared.mjs?raw';
import lintConfig from '../../../../configs/lint/oxlintrc.json?raw';
import { ensure } from '../../../domain/shared/errors.ts';
import { vaultPath, type WriteRequest } from '../../../domain/documents/file.ts';
import { webviewScaffold } from './webviews.ts';
import { projectName, type ComponentKind, type ProjectType } from '../../../application/projects/projects.ts';

const textFile = (path: string, text: string): WriteRequest => ({ path, bytes: new TextEncoder().encode(text) });
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
/** A component's source and its unit test; `__FORGE_COMPONENT__` is its class name and `__FORGE_COMPONENT_FILE__` its file name. */
const componentTemplates: Readonly<Record<ComponentKind, { source: string; test: string }>> = {
  domain: { source: domainComponentTemplate, test: domainComponentTestTemplate },
  application: { source: applicationComponentTemplate, test: applicationComponentTestTemplate },
};
const kebab = (name: string) => name.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

export function componentScaffold(project: string, name: string, projectsDirectory: string, kind: ComponentKind = 'domain'): WriteRequest[] {
  const directory = `${vaultPath(projectsDirectory)}/${projectName(project)}`;
  ensure(/^[A-Z][A-Za-z0-9]*$/.test(name), 'INVALID_NAME', 'Use a PascalCase component name, for example WorkItem.');
  ensure(kind === 'domain' || kind === 'application', 'INVALID_COMPONENT_KIND', 'Component kind must be domain or application.');
  const file = kebab(name);
  const component = (template: string) => template.replaceAll('__FORGE_COMPONENT_FILE__', file).replaceAll('__FORGE_COMPONENT__', name);
  const { source, test } = componentTemplates[kind];
  return [textFile(`${directory}/src/${kind}/${file}.ts`, component(source)), textFile(`${directory}/tests/${file}.${kind}.unit.test.ts`, component(test))];
}

export function projectScaffold(name: string, projectsDirectory: string, type: ProjectType = 'library'): WriteRequest[] {
  ensure(type === 'library' || type === 'webview', 'INVALID_ARGUMENT', 'Project type must be library or webview.');
  if (type === 'webview') return webviewScaffold(name, projectsDirectory);
  const directory = `${vaultPath(projectsDirectory)}/${projectName(name)}`;
  const named = (template: string) => template.replaceAll('__FORGE_PROJECT_NAME__', name);
  const files: Record<string, string> = {
    '.forge/project.json': json({ schemaVersion: 1, name, type: 'library' }),
    'package.json': json({
      name, version: '0.1.0', private: true, type: 'module', engines: { node: '>=22.12.0' },
      types: './dist/index.d.ts', exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      scripts: {
        'check:structure': 'node scripts/quality/structure.mjs',
        lint: 'node scripts/quality/lint.mjs', analyze: 'node scripts/quality/analyze.mjs',
        typecheck: 'node scripts/quality/typecheck.mjs', dev: 'vite', preview: 'vite preview --outDir demo-dist',
        build: 'vite build && tsc -p tsconfig.build.json && vite build --mode demo', test: 'vitest run',
        'check:fast': 'npm run check:structure && npm run lint && npm run analyze && npm run typecheck',
        check: 'npm run check:fast && npm run build && npm test',
      },
      dependencies: { zod: '4.6.5' },
      devDependencies: { '@types/node': '22.20.5', fallow: '3.31.0', oxlint: '1.86.0', typescript: '5.9.3', vite: '7.3.7', vitest: '5.0.3' },
      // npm 11 runs only approved dependency install scripts: esbuild's verifies its binary; fsevents ships prebuilt.
      allowScripts: { esbuild: true, fsevents: false },
    }),
    'scripts/quality/typecheck.mjs': typecheckScript,
    'scripts/quality/structure.mjs': structureScript,
    'scripts/quality/lint.mjs': lintScript,
    'vitest.config.ts': testConfig,
    'scripts/quality/analyze.mjs': analyzeScript,
    'scripts/quality/shared.mjs': qualityShared,
    'configs/lint/oxlintrc.json': lintConfig,
    'configs/quality/fallow.json': json({
      $schema: '../../node_modules/fallow/schema.json', minimumVersion: '3.31.0',
      entry: ['src/index.ts', 'src/presentation/demo.ts', 'tests/**/*.{unit,integration,e2e}.test.{ts,mts,cts,tsx,js,mjs,cjs,jsx}', 'vite.config.ts', 'vitest.config.ts'],
      // ui/ holds framework UI generated for downstream applications; their frameworks are not this library's dependencies.
      ignorePatterns: ['demo-dist/**', 'ui/**'],
      failOnParseError: true,
      // No policy rule packs: state it, so fallow does not report an unmeasured policy check.
      rules: { 'unused-dev-dependencies': 'error', 'unused-optional-dependencies': 'error', 'boundary-violation': 'error', 'policy-violation': 'off' },
      boundaries: {
        zones: [
          { name: 'domain', patterns: ['src/domain/**'] },
          { name: 'application', patterns: ['src/application/**'] },
          { name: 'infrastructure', patterns: ['src/infrastructure/**'] },
          { name: 'presentation', patterns: ['src/presentation/**', 'index.html'] },
          { name: 'public-api', patterns: ['src/index.ts'] },
        ],
        rules: [
          { from: 'domain', allow: ['domain'] },
          { from: 'application', allow: ['domain', 'application'] },
          { from: 'infrastructure', allow: ['domain', 'application', 'infrastructure'] },
          { from: 'presentation', allow: ['domain', 'application', 'infrastructure', 'presentation'] },
        ],
        coverage: { requireAllFiles: true, allowUnmatched: ['tests/**', 'scripts/**', 'vite.config.ts', 'vitest.config.ts', 'src/vite-env.d.ts'] },
      },
    }),
    'tsconfig.json': json({
      compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noUncheckedIndexedAccess: true, noUnusedLocals: true, noUnusedParameters: true, allowImportingTsExtensions: true, allowJs: true, checkJs: true, jsx: 'preserve', noEmit: true, types: ['node'], skipLibCheck: true },
      include: ['src', 'tests', 'vite.config.ts', 'vitest.config.ts'],
    }),
    'tsconfig.build.json': json({
      extends: './tsconfig.json',
      compilerOptions: { noEmit: false, declaration: true, emitDeclarationOnly: true, rootDir: 'src', outDir: 'dist' },
      include: ['src'],
    }),
    'vite.config.ts': viteConfigTemplate,
    'index.html': demoHtml,
    'src/vite-env.d.ts': '/// <reference types="vite/client" />\n',
    'src/presentation/demo.ts': demoScript,
    'src/presentation/demo.css': demoStyle,
    'src/presentation/forms/form-model.ts': formModel,
    'src/presentation/forms/form-view.ts': formView,
    'src/presentation/forms/project-details.form.ts': formDefinitionSource('ProjectDetails', './form-model.js'),
    'tests/project-details.form.unit.test.ts': formDefinitionTestSource('ProjectDetails', '../src/presentation/forms/project-details.form.js', '../src/presentation/forms/form-model.js'),
    '.gitignore': gitignoreTemplate,
    'src/index.ts': indexTemplate,
    'src/application/.gitkeep': '',
    'src/infrastructure/.gitkeep': '',
    'README.md': named(readmeTemplate),
    'AGENTS.md': named(agentsTemplate),
    'tests/public-api.integration.test.ts': publicApiTestTemplate,
  };
  return [
    ...Object.entries(files).map(([path, contents]) => textFile(`${directory}/${path}`, contents)),
    ...componentScaffold(name, 'ProjectIdentity', projectsDirectory),
  ];
}
