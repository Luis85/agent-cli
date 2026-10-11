import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorCatalog, errorCodes } from '../../src/domain/shared/error-catalog.ts';
import { inventoryErrorCodes } from '../support/error-codes.ts';

/** Produced by the response boundary for thrown values that are not Forge errors, rather than thrown by a helper. */
const boundaryCodes = ['OPERATION_FAILED'];

describe('error catalog completeness', () => {
  it('catalogs every code thrown by Forge source and keeps no stale codes', async () => {
    const inventory = await inventoryErrorCodes('src');
    expect(inventory.unresolved, 'error codes must resolve statically; see tests/support/error-codes.ts').toEqual([]);
    expect(inventory.directConstructions, 'built-in failures use forgeError or ensure').toEqual([]);
    const thrown = [...inventory.codes.keys()];
    expect(thrown.filter(code => !Object.hasOwn(errorCatalog, code)).map(code => `${code} at ${inventory.codes.get(code)!.join(', ')}`)).toEqual([]);
    expect(errorCodes.filter(code => !thrown.includes(code) && !boundaryCodes.includes(code))).toEqual([]);
  });

  it('resolves only the documented code indirections and reports the rest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forge-error-scan-'));
    try {
      await writeFile(join(root, 'sample.ts'), [
        "const shared = 'CONST_CODE';",
        "ensure(a, 'LITERAL_CODE', 'm'); ensure(a, flag ? 'TRUE_CODE' : ('FALSE_CODE'), 'm'); ensure(a, shared, 'm');",
        "function fail(code: ErrorCode, message: string) { throw forgeError(code, message); }",
        "fail('FORWARDED_CODE', 'm');",
        "function drift(code: 'UNION_A' | 'UNION_B') { throw forgeError(code, 'm'); }",
        "function fallback(code = 'DEFAULT_CODE') { ensure(a, code, 'm'); }",
        "ensure(a, codes[index], 'm'); throw new AppError('DIRECT', 'm');",
      ].join('\n'));
      const inventory = await inventoryErrorCodes(root);
      expect([...inventory.codes.keys()].sort()).toEqual(['CONST_CODE', 'DEFAULT_CODE', 'FALSE_CODE', 'FORWARDED_CODE', 'LITERAL_CODE', 'TRUE_CODE', 'UNION_A', 'UNION_B']);
      expect(inventory.unresolved).toEqual(['sample.ts:7 codes[index]']);
      expect(inventory.directConstructions).toEqual(['sample.ts:7']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('documents every catalogued code with its exit status, category and retryability', async () => {
    const reference = await readFile('docs/reference/errors.md', 'utf8');
    const rows = new Map([...reference.matchAll(/^\| `([A-Z0-9_]+)` \| (\d+) \| ([a-z-]+) \| (yes|no) \| .+ \| .+ \|$/gm)]
      .map(([, code, exitCode, category, retryable]) => [code!, { exitCode: Number(exitCode), category, retryable: retryable === 'yes' }]));
    expect([...rows.keys()].sort()).toEqual([...errorCodes].sort());
    for (const code of errorCodes) {
      const { exitCode, category, retryable } = errorCatalog[code];
      expect(rows.get(code), code).toEqual({ exitCode, category, retryable });
    }
    expect(await readFile('docs/reference/cli.md', 'utf8')).toContain('](errors.md)');
    expect(await readFile('docs/index.md', 'utf8')).toContain('](reference/errors.md)');
  });
});
