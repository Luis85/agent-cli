import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function put(root: string, file: string, content: string) {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), content);
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'forge-quality-'));
  roots.push(root);
  await cp(resolve('scripts/quality'), join(root, 'scripts/quality'), { recursive: true });
  await cp(resolve('configs'), join(root, 'configs'), { recursive: true });
  await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  const config = JSON.parse(await readFile(join(root, 'configs/quality/fallow.json'), 'utf8'));
  config.entry = ['src/index.ts'];
  await put(root, 'configs/quality/fallow.json', JSON.stringify(config));
  await put(root, 'package.json', JSON.stringify({ name: 'quality-fixture', private: true, type: 'module', scripts: {
    lint: 'node scripts/quality/lint.mjs', analyze: 'node scripts/quality/analyze.mjs', 'check:structure': 'node scripts/quality/structure.mjs', typecheck: 'node scripts/quality/typecheck.mjs',
  } }));
  await put(root, 'src/index.ts', 'export const baseline = 1;\n');
  return root;
}

function run(root: string, task: 'lint' | 'analyze') {
  const result = spawnSync(process.execPath, [join(root, `scripts/quality/${task}.mjs`)], { cwd: root, encoding: 'utf8' });
  if (result.error) throw result.error;
  return { status: result.status, output: JSON.parse(result.stdout) };
}

describe('agent quality gates', () => {
  it('accepts a clean project and writes machine-readable evidence', async () => {
    const root = await fixture();
    for (const task of ['lint', 'analyze'] as const) {
      const result = run(root, task);
      expect(result.output.errors).toEqual([]);
      expect(result.status).toBe(0);
      expect(result.output.ok).toBe(true);
      expect(result.output.scope).toContain('src/index.ts');
      const saved = JSON.parse(await readFile(join(root, `.quality-reports/${task === 'lint' ? 'oxlint' : 'fallow'}.json`), 'utf8'));
      expect(saved).toEqual(result.output);
    }
  });

  it('lints every explicit source file even when ignore rules would hide it', async () => {
    const root = await fixture();
    await put(root, '.eslintignore', 'src/hidden.ts\n');
    await put(root, 'src/hidden.ts', 'debugger;\n');
    const result = run(root, 'lint');
    expect(result.status).toBe(1);
    expect(result.output.report.diagnostics.some((item: { filename: string }) => item.filename === 'src/hidden.ts')).toBe(true);
  });

  it.each(['domain', 'application'])('rejects external platform imports in %s', async (layer) => {
    const root = await fixture();
    await put(root, `src/${layer}/unsafe.ts`, "import { readFileSync } from 'node:fs';\nexport const read = readFileSync;\n");
    const result = run(root, 'lint');
    expect(result.status).toBe(1);
    expect(result.output.report.diagnostics.some((item: { code: string }) => item.code.includes('no-restricted-imports'))).toBe(true);
  });

  it.each(['domain', 'application'])('rejects CommonJS imports in %s', async (layer) => {
    const root = await fixture();
    await put(root, `src/${layer}/unsafe.ts`, "export const filesystem = require('node:fs');\n");
    const result = run(root, 'lint');
    expect(result.status).toBe(1);
    expect(result.output.report.diagnostics.some((item: { code: string }) => item.code.includes('no-require-imports'))).toBe(true);
  });

  it.each(['mts', 'cts', 'tsx', 'js', 'mjs', 'cjs', 'jsx'])('enforces core restrictions for .%s sources', async (extension) => {
    const root = await fixture();
    await put(root, `src/domain/unsafe.${extension}`, extension === 'cjs'
      ? "module.exports = require('node:fs');\n"
      : "import { readFileSync } from 'node:fs';\nexport const read = readFileSync;\n");
    const result = run(root, 'lint');
    expect(result.status).toBe(1);
    const expectedRule = extension === 'cjs' ? 'no-require-imports' : 'no-restricted-imports';
    expect(result.output.report.diagnostics.some((item: { code?: string }) => item.code?.includes(expectedRule))).toBe(true);
  });

  it('allows platform imports in infrastructure adapters', async () => {
    const root = await fixture();
    await put(root, 'src/infrastructure/workspace/files.ts', "import { readFileSync } from 'node:fs';\nexport const read = readFileSync;\nexport const filesystem = require('node:fs');\n");
    expect(run(root, 'lint').output).toMatchObject({ ok: true, errors: [] });
  });

  it.each([
    ['unused files', 'src/unused.ts', 'export const abandoned = 1;', 'unused_files'],
    ['unlisted dependencies', 'src/index.ts', "import missing from 'not-a-declared-dependency'; export { missing };", 'unlisted_dependencies'],
    ['inward architecture', 'src/domain/model.ts', "export { adapter } from '../infrastructure/adapter.ts';", 'boundary_violations'],
  ])('rejects %s', async (_label, file, source, category) => {
    const root = await fixture();
    if (category === 'boundary_violations') {
      await put(root, 'src/infrastructure/adapter.ts', 'export const adapter = 1;');
      await put(root, 'src/index.ts', "export { adapter } from './domain/model.ts';");
    }
    await put(root, file!, source!);
    const result = run(root, 'analyze');
    expect(result.status).toBe(1);
    expect(result.output.report[category!].length).toBeGreaterThan(0);
    expect(result.output.report.gate_outcomes['error-severity-findings'].status).toBe('fail');
  });

  it('rejects parse failures instead of treating incomplete analysis as success', async () => {
    const root = await fixture();
    await put(root, 'src/index.ts', 'export const invalid = ;');
    const result = run(root, 'analyze');
    expect(result.status).toBe(1);
    expect(result.output.report.gate_outcomes['parse-error']).toMatchObject({ enforced: true, status: 'fail' });
  });

  it('rejects unused declared dependencies', async () => {
    const root = await fixture();
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    manifest.dependencies = { abandoned: '1.0.0' };
    await put(root, 'package.json', JSON.stringify(manifest));
    const result = run(root, 'analyze');
    expect(result.status).toBe(1);
    expect(result.output.report.unused_dependencies.length).toBe(1);
  });

  it.each(['missing', 'unenforced', 'unknown', 'schema', 'version', 'process'])('rejects %s analyzer success claims', async (failure) => {
    const root = await fixture();
    const report = {
      kind: 'dead-code', version: failure === 'version' ? '0.0.0' : '3.31.0', schema_version: failure === 'schema' ? 0 : 9,
      gate_outcomes: {
        'error-severity-findings': { enforced: true, status: 'pass' },
        ...(failure === 'missing' ? {} : { 'parse-error': { enforced: failure !== 'unenforced', status: failure === 'unknown' ? 'unknown' : 'pass' } }),
      },
    };
    await rm(join(root, 'node_modules'));
    const files = ['src/index.ts', 'scripts/quality/shared.mjs', 'scripts/quality/lint.mjs', 'scripts/quality/analyze.mjs', 'scripts/quality/structure.mjs', 'scripts/quality/typecheck.mjs'];
    await put(root, 'node_modules/fallow/bin/fallow', `#!/usr/bin/env node
const discovery = process.argv.includes('list');
process.stdout.write(JSON.stringify(discovery ? ${JSON.stringify({ files })} : ${JSON.stringify(report)}));
process.exitCode = !discovery && ${JSON.stringify(failure)} === 'process' ? 2 : 0;
`);
    const result = run(root, 'analyze');
    expect(result.status).toBe(1);
    expect(result.output.ok).toBe(false);
    expect(result.output.errors.length).toBeGreaterThan(0);
  });

  it('fails when analyzer discovery omits a source directory', async () => {
    const root = await fixture();
    await put(root, 'src/dist/hidden.ts', 'export const hidden = 1;');
    const result = run(root, 'analyze');
    expect(result.status).toBe(1);
    expect(result.output.errors).toContain('Fallow skipped source files: src/dist/hidden.ts');
  });

  it('rejects a missing source tree', async () => {
    const root = await fixture();
    await rm(join(root, 'src'), { recursive: true });
    for (const task of ['lint', 'analyze'] as const) {
      expect(run(root, task).output).toMatchObject({ ok: false, errors: ['Required source directory src is missing'] });
    }
  });
});
