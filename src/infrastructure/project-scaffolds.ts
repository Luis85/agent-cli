import typecheckScript from '../../scripts/quality/typecheck.mjs?raw';
import formModel from './scaffolds/form-model.ts?raw';
import formView from './scaffolds/form-view.ts?raw';
import demoHtml from './scaffolds/project-demo.html.txt?raw';
import demoStyle from './scaffolds/project-demo.css?raw';
import demoScript from './scaffolds/project-demo.ts.txt?raw';
import { formDefinitionSource, formDefinitionTestSource } from './form-definition.ts';
import structureScript from '../../scripts/quality/structure.mjs?raw';
import testConfig from '../../vitest.config.ts?raw';
import lintScript from '../../scripts/quality/lint.mjs?raw';
import analyzeScript from '../../scripts/quality/analyze.mjs?raw';
import qualityShared from '../../scripts/quality/shared.mjs?raw';
import lintConfig from '../../configs/lint/oxlintrc.json?raw';
import { ensure } from '../domain/errors.ts';
import { vaultPath, type WriteRequest } from '../domain/file.ts';
import { projectName, type ComponentKind } from '../application/projects.ts';

const textFile = (path: string, text: string): WriteRequest => ({ path, bytes: new TextEncoder().encode(text) });
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const kebab = (name: string) => name.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

export function componentScaffold(project: string, name: string, projectsDirectory: string, kind: ComponentKind = 'domain'): WriteRequest[] {
  const directory = `${vaultPath(projectsDirectory)}/${projectName(project)}`;
  ensure(/^[A-Z][A-Za-z0-9]*$/.test(name), 'INVALID_NAME', 'Use a PascalCase component name, for example WorkItem.');
  ensure(kind === 'domain' || kind === 'application', 'INVALID_COMPONENT_KIND', 'Component kind must be domain or application.');
  const file = kebab(name);
  const source = kind === 'domain'
    ? `export class ${name} {\n  private constructor(readonly id: string) {}\n\n  static create(id: string): ${name} {\n    if (!id.trim()) throw new globalThis.Error('Identity is required');\n    return new ${name}(id);\n  }\n}\n`
    : `export interface ${name}Repository {\n  exists(id: string): globalThis.Promise<boolean>;\n}\n\nexport class ${name} {\n  constructor(private readonly repository: ${name}Repository) {}\n\n  async execute(id: string): globalThis.Promise<{ exists: boolean }> {\n    if (!id.trim()) throw new globalThis.Error('Identity is required');\n    return { exists: await this.repository.exists(id) };\n  }\n}\n`;
  const test = kind === 'domain'
    ? `import { describe, expect, it } from 'vitest';\nimport { ${name} } from '../src/domain/${file}.ts';\n\ndescribe('${name}', () => {\n  it.each(['', '   '])('rejects an empty identity: %j', id => {\n    expect(() => ${name}.create(id)).toThrow('Identity is required');\n  });\n  it('retains a valid identity', () => {\n    expect(${name}.create('item-1').id).toBe('item-1');\n  });\n});\n`
    : `import { describe, expect, it, vi } from 'vitest';\nimport { ${name} } from '../src/application/${file}.ts';\n\ndescribe('${name}', () => {\n  it('rejects invalid input before accessing persistence', async () => {\n    const exists = vi.fn(async () => true);\n    await expect(new ${name}({ exists }).execute('   ')).rejects.toThrow('Identity is required');\n    expect(exists).not.toHaveBeenCalled();\n  });\n  it.each([true, false])('returns the repository result: %s', async present => {\n    const exists = vi.fn(async (id: string) => id === 'item-1' && present);\n    await expect(new ${name}({ exists }).execute('item-1')).resolves.toEqual({ exists: present });\n    expect(exists).toHaveBeenCalledExactlyOnceWith('item-1');\n  });\n});\n`;
  return [textFile(`${directory}/src/${kind}/${file}.ts`, source), textFile(`${directory}/tests/${file}.${kind}.unit.test.ts`, test)];
}

export function projectScaffold(name: string, projectsDirectory: string): WriteRequest[] {
  const directory = `${vaultPath(projectsDirectory)}/${projectName(name)}`;
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
      devDependencies: { '@types/node': '22.20.5', fallow: '3.31.0', oxlint: '1.86.0', typescript: '5.9.3', vite: '7.3.7', vitest: '3.2.7' },
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
      ignorePatterns: ['demo-dist/**'],
      failOnParseError: true,
      rules: { 'unused-dev-dependencies': 'error', 'unused-optional-dependencies': 'error', 'boundary-violation': 'error' },
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
    'vite.config.ts': `import { defineConfig } from 'vite';\n\nexport default defineConfig(({ mode }) => ({\n  base: './',\n  build: mode === 'demo' ? { outDir: 'demo-dist' } : {\n    target: 'es2022',\n    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js' },\n    rollupOptions: { external: ['zod'] },\n  },\n}));\n`,
    'index.html': demoHtml,
    'src/vite-env.d.ts': '/// <reference types="vite/client" />\n',
    'src/presentation/demo.ts': demoScript,
    'src/presentation/demo.css': demoStyle,
    'src/presentation/forms/form-model.ts': formModel,
    'src/presentation/forms/form-view.ts': formView,
    'src/presentation/forms/project-details.form.ts': formDefinitionSource('ProjectDetails', './form-model.js'),
    'tests/project-details.form.unit.test.ts': formDefinitionTestSource('ProjectDetails', '../src/presentation/forms/project-details.form.js', '../src/presentation/forms/form-model.js'),
    '.gitignore': 'node_modules/\ndist/\ndemo-dist/\ncoverage/\n.fallow/\n.quality-reports/\n',
    'src/index.ts': "export { ProjectIdentity } from './domain/project-identity.js';\nexport { ProjectDetailsForm, type ProjectDetailsValues } from './presentation/forms/project-details.form.js';\nexport { validateForm, type FormDefinition, type FormField, type FormValidation } from './presentation/forms/form-model.js';\nexport { renderForm } from './presentation/forms/form-view.js';\n",
    'src/application/.gitkeep': '',
    'src/infrastructure/.gitkeep': '',
    'README.md': `# ${name}\n\nTypeScript library scaffolded by The Forge. Requires Node 22.12 or newer.\n\nRun \`npm install\` once from this project directory, commit the resulting lockfile, then use \`npm ci\` for reproducible installs. The scaffold does not install or execute dependencies.\n\n## Forge project context\n\nRun Forge commands from the containing environment directory, where \`bin/app.js\` lives. Select this project with \`node bin/app.js project open ${name}\`, then verify \`node bin/app.js project current\` before writes. The selection persists in the environment's \`bin/data/context.json\` across invocations; \`project close\` clears it. File commands and \`make\` outputs target the selected project, so \`node bin/app.js create notes/plan.md --content "# Plan"\` creates a note inside this project. Add components with \`node bin/app.js project component WorkItem --kind domain --dry-run\`, review the plan, then repeat without \`--dry-run\`. Project management stays scoped to the environment, and Markdown template sources are shared in its \`bin/templates\` folder.\n\n## Form showcase\n\nRun \`npm run dev\` from this project directory and open the local Vite URL. The Project Details form demonstrates labeled native HTML inputs, Zod validation and local result preview; it does not send or save data. Edit \`src/presentation/forms/project-details.form.ts\` to change the model. From the containing environment, run \`node bin/app.js make form Contact\` after selecting this project. Reload the preview to choose the new form. Definitions under \`src/presentation/forms/**/*.form.ts\` are discovered automatically; definitions elsewhere need an explicit import.\n\nThe library exports \`ProjectDetailsForm\`, \`validateForm\` and \`renderForm\`. Validation works without a browser; call the renderer with a real DOM container and a submission callback. \`npm run build\` writes the library and declarations to \`dist\`, and the interactive showcase to \`demo-dist\`. Use \`npm run preview\` to serve the built showcase.\n\n## Development feedback loop\n\n1. Define acceptance criteria and inspect the affected code and tests.\n2. Make a focused change; use \`npm test -- --project unit\` to check its behavior.\n3. Run \`npm run check:fast\` for test-pyramid structure, Oxlint correctness/code-line limits, fallow-rs unused-code/import-boundary analysis, and strict TypeScript checks. Each command exits nonzero on failure.\n4. Repair the first reported failure and rerun its command. Structure, lint and analysis emit structured JSON and save diagnostics to \`.quality-reports/structure.json\`, \`.quality-reports/oxlint.json\` and \`.quality-reports/fallow.json\`. Do not hide findings by broadening analysis entries, adding suppressions, or disabling checks.\n5. Run \`npm run check\` before handoff; it adds the Vite library and demo builds, declaration generation, and all Vitest tests. Report the commands and results.\n\nKeep source files at most 400 code-bearing lines and tests/test support at most 450; blank lines and comment-only lines do not count. Split by responsibility when approaching the limit. Name tests \`*.unit.test.ts\` for isolated behavior, \`*.integration.test.ts\` for collaborating components, or \`*.e2e.test.ts\` for a complete public workflow. Prefer many focused unit tests, fewer integration tests, and a small set of end-to-end tests. Select a layer with \`npm test -- --project unit\` (or \`integration\` / \`e2e\`); run the full suite before handoff.\n\nKeep business invariants in \`src/domain\`, use cases and injected ports in \`src/application\`, adapters in \`src/infrastructure\`, and composition in \`src/presentation\`. Core layers use only relative imports and cannot depend on outer layers; keep platform libraries behind injected ports. These boundaries are enforced by the lint and analysis configurations under \`configs/\`. Export the intended public API from \`src/index.ts\`. New components start internal and are exercised by their generated tests; explicitly export them when they become part of the library contract.\n\nThe sample \`ProjectIdentity\` demonstrates domain identity validation; \`ProjectDetailsForm\` demonstrates a separate presentation model. Replace examples with the project's business vocabulary and acceptance criteria. Static checks enforce specific rules; focused behavior tests remain necessary.\n`,
    'AGENTS.md': `# Working on ${name}\n\nRead README.md and package.json first. Define acceptance criteria before changing behavior. Keep domain independent of frameworks and I/O; application depends on domain and injected ports. Put adapters in infrastructure and composition in presentation. Respect the enforced import boundaries in configs/.\n\nRun Forge from the containing environment directory: node bin/app.js project open ${name}, then node bin/app.js project current before writes. The selection persists in bin/data/context.json; project close clears it. File operations and make outputs target the selected project; project management stays environment scoped and template sources are shared in bin/templates. Add components with node bin/app.js project component WorkItem --kind domain; preview writes with --dry-run. Choose names from the domain, replace example behavior, and add focused tests for invariants and failures. Export only intentional public API from src/index.ts.\n\nKeep source files <=400 code-bearing lines and tests/test support <=450, excluding blank and comment-only lines; split responsibilities instead of compressing code. Label tests *.unit.test.ts, *.integration.test.ts, or *.e2e.test.ts. Favor unit tests, add integration tests for boundaries, and reserve e2e tests for public workflows. Run a layer with npm test -- --project unit (replace unit with integration or e2e for those layers).\n\nForm definitions live in src/presentation/forms/*.form.ts and share the typed form-model/form-view runtime; npm run dev shows the HTML preview. Use make form from the containing environment to add a definition and unit tests. Zod owns validation; do not duplicate validation in HTML event handlers or submit data without an explicit application callback.\n\nRun npm commands from this project directory. Install with npm ci after a lockfile exists (npm install once for a fresh scaffold, then commit the lockfile). Run focused tests while editing and npm run check:fast after changes. Repair diagnostics at their source; do not weaken checks, widen entry globs, or add suppressions to obtain a pass. Run npm run check before handoff and report commands, results, and limitations. Introduce dependencies only for a concrete need.\n`,
    'tests/public-api.integration.test.ts': "import { expect, it } from 'vitest';\nimport { ProjectIdentity } from '../src/index.ts';\n\nit('exposes identity validation through the public API', () => {\n  expect(() => ProjectIdentity.create('   ')).toThrow('Identity is required');\n  expect(ProjectIdentity.create('project-1').id).toBe('project-1');\n});\n",
  };
  return [
    ...Object.entries(files).map(([path, contents]) => textFile(`${directory}/${path}`, contents)),
    ...componentScaffold(name, 'ProjectIdentity', projectsDirectory),
  ];
}
