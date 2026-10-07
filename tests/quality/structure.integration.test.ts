import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'forge-structure-'));
  temporary.push(root);
  for (const directory of ['src', 'tests', 'scripts/quality']) await mkdir(join(root, directory), { recursive: true });
  for (const file of ['structure.mjs', 'shared.mjs', 'lint.mjs']) await cp(resolve('scripts/quality', file), join(root, 'scripts/quality', file));
  await cp(resolve('configs/lint'), join(root, 'configs/lint'), { recursive: true });
  await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  await writeFile(join(root, 'src/index.ts'), 'export {};\n');
  return root;
}

function check(root: string, task = 'structure', args: string[] = []) {
  const result = spawnSync(process.execPath, [`scripts/quality/${task}.mjs`, ...args], { cwd: root, encoding: 'utf8' });
  if (result.error) throw result.error;
  return { status: result.status, output: JSON.parse(result.stdout) };
}

describe('structure quality gate', () => {
  it('accepts exact limits and all pyramid labels with matching JSON evidence', async () => {
    const root = await fixture();
    await writeFile(join(root, 'src/index.ts'), 'void 0; // mixed comment\n\n// comment only\n/* multiline\n * comment\n */\n'.repeat(400));
    for (const level of ['unit', 'integration', 'e2e']) await writeFile(join(root, `tests/boundary.${level}.test.ts`), 'void 0;\r\n// comment\r\n\r\n'.repeat(450));
    await writeFile(join(root, 'tests/fixture.ts'), 'void 0;\n'.repeat(450) + '\n'.repeat(450));
    const result = check(root);
    expect(result.status).toBe(0);
    expect(JSON.parse(await readFile(join(root, '.quality-reports/structure.json'), 'utf8'))).toEqual(result.output);
    const lint = check(root, 'lint');
    expect(lint.output.report.diagnostics).toEqual([]);
    expect(lint.status).toBe(0);
  });

  it.each([
    ['src/index.ts', 401, 400],
    ['tests/example.unit.test.ts', 451, 450],
    ['tests/fixture.ts', 451, 450],
  ])('rejects oversized %s after excluding comments and blank lines', async (path, codeLines, limit) => {
    const root = await fixture();
    await writeFile(join(root, path), 'void 0;\n// comment\n\n'.repeat(codeLines - 1) + 'void 0;');
    const result = check(root, 'lint');
    expect(result.status).toBe(1);
    const diagnostic = result.output.report.diagnostics.find((item: { code?: string }) => item.code?.includes('max-lines'));
    expect(diagnostic).toMatchObject({ filename: path, severity: 'error' });
    expect(diagnostic.message).toContain(String(codeLines));
    expect(diagnostic.help).toContain(String(limit));
  });

  it('keeps comment-like multiline template content in the Oxlint code count', async () => {
    const root = await fixture();
    await writeFile(join(root, 'src/index.ts'), 'void 0;\n'.repeat(397) + 'export const text = `\n// literal template content\n/* also literal */\n\n`;\n');
    const result = check(root, 'lint');
    expect(result.status).toBe(1);
    expect(result.output.report.diagnostics).toContainEqual(expect.objectContaining({ filename: 'src/index.ts', code: 'eslint(max-lines)' }));
  });

  it('handles comment-like strings, regexes, JSDoc and TSX through Oxlint', async () => {
    const root = await fixture();
    await writeFile(join(root, 'src/index.ts'), [
      '/** Documentation', ' * spanning lines', ' */',
      'export const url = "https://example.test/*literal*/";',
      'export const pattern = /https?:\\/\\/example\\.test/;',
      '/* block-only', ' ignored */',
    ].join('\n'));
    await writeFile(join(root, 'src/view.tsx'), [
      'export const view = (', '  <section>', '    {/* JSX comment', '      ignored comment content */}',
      '    <span>https://example.test/*literal*/</span>', '  </section>', ');',
    ].join('\n'));
    const result = check(root, 'lint');
    expect(result.status).toBe(0);
    expect(result.output.report.diagnostics).toEqual([]);
  });

  it('lets Oxlint reject parser failures instead of accepting incomplete analysis', async () => {
    const root = await fixture();
    await writeFile(join(root, 'src/index.ts'), 'const broken = ;');
    const result = check(root, 'lint');
    expect(result.status).toBe(1);
    expect(result.output.report.diagnostics.length).toBeGreaterThan(0);
  });

  it.each(['unclassified.test.ts', 'misnamed.spec.ts'])('rejects unclassified test %s', async (name) => {
    const root = await fixture();
    await writeFile(join(root, 'tests', name), 'export {};\n');
    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.output.report.violations).toContainEqual(expect.objectContaining({ path: `tests/${name}`, rule: 'test-pyramid' }));
  });

  it('rejects labeled tests outside the directory discovered by Vitest', async () => {
    const root = await fixture();
    await writeFile(join(root, 'src/misplaced.unit.test.ts'), 'export {};\n');
    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.output.report.violations).toContainEqual(expect.objectContaining({ path: 'src/misplaced.unit.test.ts', rule: 'test-location' }));
  });

  it('accepts grouped sources, extensible concern names, fixed entrypoints and separate tooling', async () => {
    const root = await fixture();
    await rm(join(root, 'src/index.ts'));
    for (const path of [
      'src/main.ts', 'src/sdk.ts', 'src/vite-env.d.ts',
      'src/domain/documents/file.ts', 'src/application/new-concern/deep/service.ts',
      'src/infrastructure/workspace/files.ts', 'src/presentation/cli/commands.ts',
      'scripts/release.mjs',
    ]) {
      await mkdir(join(root, path, '..'), { recursive: true });
      await writeFile(join(root, path), 'export {};\n');
    }
    const result = check(root, 'structure', ['--source-layout', 'forge']);
    expect(result.status).toBe(0);
    expect(result.output.report.violations).toEqual([]);
  });

  it.each([
    'src/index.ts', 'src/domain/file.ts', 'src/application/ports.ts',
    'src/infrastructure/codec.ts', 'src/presentation/commands.ts',
    'src/utils/shared/errors.ts', 'src/scripts/quality/lint.mjs',
  ])('rejects misplaced Forge source %s', async path => {
    const root = await fixture();
    await rm(join(root, 'src/index.ts'));
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), 'export {};\n');
    const result = check(root, 'structure', ['--source-layout', 'forge']);
    expect(result.status).toBe(1);
    expect(result.output.report.violations).toEqual([expect.objectContaining({ path, rule: 'source-location' })]);
  });

  it('keeps the default portable gate compatible with generated project entrypoints', async () => {
    const root = await fixture();
    await mkdir(join(root, 'src/domain'), { recursive: true });
    await writeFile(join(root, 'src/domain/project-identity.ts'), 'export {};\n');
    expect(check(root).status).toBe(0);
    expect(check(root, 'structure', ['--source-layout', 'forge']).status).toBe(1);
  });

  it.each([['--source-layout'], ['--source-layout', 'unknown'], ['--unknown'], ['--source-layout', 'forge', 'ignored']].map(args => [args]))('rejects unsupported structure arguments %j', async args => {
    const result = check(await fixture(), 'structure', args);
    expect(result.status).toBe(1);
    expect(result.output.errors).toEqual([expect.stringContaining('--source-layout forge')]);
  });
});
