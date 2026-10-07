import { expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { generators } from '../src/infrastructure/generators.ts';

it('all built-in TypeScript scaffolds compile under strict settings without runtime dependencies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-generators-'));
  try {
    const roots: string[] = [];
    for (const [index, generator] of generators.entries()) {
      const plan = await generator.generate(`Example${index}`, 'domain');
      for (const file of plan.filter(file => file.path.endsWith('.ts'))) {
        const path = join(directory, file.path.split('/').at(-1)!);
        roots.push(path); await writeFile(path, file.bytes);
      }
    }
    const program = ts.createProgram(roots, { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, types: [], skipLibCheck: true });
    expect(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
