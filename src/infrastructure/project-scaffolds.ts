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
  return [textFile(`${directory}/src/${kind}/${file}.ts`, source), textFile(`${directory}/tests/${file}.${kind}.test.ts`, test)];
}

export function projectScaffold(name: string, projectsDirectory: string): WriteRequest[] {
  const directory = `${vaultPath(projectsDirectory)}/${projectName(name)}`;
  const files: Record<string, string> = {
    '.forge/project.json': json({ schemaVersion: 1, name, type: 'library' }),
    'package.json': json({
      name, version: '0.1.0', private: true, type: 'module', engines: { node: '>=22.12.0' },
      types: './dist/index.d.ts', exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      scripts: { typecheck: 'tsc --noEmit', build: 'vite build && tsc -p tsconfig.build.json', test: 'vitest run', check: 'npm run typecheck && npm run build && npm test' },
      devDependencies: { '@types/node': '22.20.5', typescript: '5.9.3', vite: '7.3.7', vitest: '3.2.7' },
    }),
    'tsconfig.json': json({
      compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noUncheckedIndexedAccess: true, noUnusedLocals: true, noUnusedParameters: true, allowImportingTsExtensions: true, noEmit: true, types: ['node'], skipLibCheck: true },
      include: ['src', 'tests', 'vite.config.ts'],
    }),
    'tsconfig.build.json': json({
      extends: './tsconfig.json',
      compilerOptions: { noEmit: false, declaration: true, emitDeclarationOnly: true, rootDir: 'src', outDir: 'dist' },
      include: ['src'],
    }),
    'vite.config.ts': `import { defineConfig } from 'vite';\n\nexport default defineConfig({\n  build: {\n    target: 'es2022',\n    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js' },\n  },\n});\n`,
    '.gitignore': 'node_modules/\ndist/\ncoverage/\n',
    'src/index.ts': "export { ProjectIdentity } from './domain/project-identity.js';\n",
    'src/application/.gitkeep': '',
    'src/infrastructure/.gitkeep': '',
    'src/presentation/.gitkeep': '',
    'README.md': `# ${name}\n\nTypeScript library scaffolded by The Forge.\n\nRun \`npm install\` once, commit the resulting lockfile, then use \`npm ci\` for reproducible installs. Run \`npm run check\` to type-check, build with Vite, and test with Vitest. The scaffold does not install or execute dependencies.\n\nKeep business invariants in \`src/domain\`, use cases and injected ports in \`src/application\`, adapters in \`src/infrastructure\`, and entry points in \`src/presentation\`. Export the intended public API from \`src/index.ts\`. New components start internal; explicitly export them when needed.\n\nThe sample \`ProjectIdentity\` demonstrates identity validation. Replace examples with the project's business vocabulary and acceptance criteria.\n`,
    'AGENTS.md': `# Working on ${name}\n\nRead README.md and package.json first. Establish acceptance criteria before changing behavior. Keep domain independent of frameworks and I/O; application code depends on domain and injected ports. Put adapters in infrastructure and composition in presentation.\n\nUse The Forge from the containing workspace for project/component scaffolds; preview writes with --dry-run. Treat generated examples as a starting point and choose names from the domain. Add focused tests for invariants and failure behavior. Export only intentional public API from src/index.ts.\n\nRun npm run check after changes. Report validation and any limitations. Do not introduce dependencies or unrelated changes without a concrete need.\n`,
    'tests/public-api.test.ts': "import { expect, it } from 'vitest';\nimport { ProjectIdentity } from '../src/index.ts';\n\nit('exposes identity validation through the public API', () => {\n  expect(() => ProjectIdentity.create('   ')).toThrow('Identity is required');\n  expect(ProjectIdentity.create('project-1').id).toBe('project-1');\n});\n",
  };
  return [
    ...Object.entries(files).map(([path, contents]) => textFile(`${directory}/${path}`, contents)),
    ...componentScaffold(name, 'ProjectIdentity', projectsDirectory),
  ];
}
