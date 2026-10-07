import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/infrastructure/config.ts';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { germanCommands, germanGenerators } from '../../src/presentation/localization-catalog.ts';
import { germanErrors } from '../../src/presentation/localization-errors.ts';
import { commands } from '../../src/presentation/commands.ts';
import { generators } from '../../src/infrastructure/generators.ts';
import { Registry } from '../../src/application/plugins.ts';
import type { WorkflowServices } from '../../src/presentation/services.ts';

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? sources(join(directory, entry.name)) : [join(directory, entry.name)]))).flat().filter(path => path.endsWith('.ts'));
}

describe('built-in localization catalog coverage', () => {
  it('covers all statically declared application error codes and dynamic boundary codes', async () => {
    const codes = new Set(['UNKNOWN_OPTION', 'MISSING_ARGUMENT', 'INVALID_ARGUMENT', 'OPERATION_FAILED', 'INVALID_RESULT', 'GENERATION_DRIFT', 'UI_DRIFT', 'DATA_SOURCE_DRIFT']);
    for (const path of await sources('src')) {
      const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        const offset = ts.isCallExpression(node) && node.expression.getText(source) === 'ensure' ? 1
          : ts.isNewExpression(node) && node.expression.getText(source) === 'AppError' ? 0 : undefined;
        if (offset !== undefined && (ts.isCallExpression(node) || ts.isNewExpression(node))) {
          const code = node.arguments?.[offset];
          if (code && ts.isStringLiteral(code)) codes.add(code.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect([...codes].filter(code => !Object.hasOwn(germanErrors, code))).toEqual([]);
  });
  it('covers every registered built-in command and generator', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forge-locale-catalog-'));
    try {
      const loaded = await loadConfig({ defaultPath: join(root, 'bin/config.json'), cwd: root });
      const services: WorkflowServices = {
        loaded,
        get files(): never { throw new Error('Catalog must not access files'); },
        get templates(): never { throw new Error('Catalog must not access templates'); },
        get projects(): never { throw new Error('Catalog must not access projects'); },
        get uiLibrary(): never { throw new Error('Catalog must not access UI library'); },
        get dataSources(): never { throw new Error('Catalog must not access data sources'); },
        get interactions(): never { throw new Error('Catalog must not access interactions'); },
        async installTemplates() { throw new Error('Catalog must not install templates'); },
        async setup() { throw new Error('Catalog must not run setup'); },
      };
      const registry = new Registry();
      const ids = commands(registry, services).map(command => command.id).sort();
      expect(Object.keys(germanCommands).sort()).toEqual(ids);
      expect(Object.keys(germanGenerators).sort()).toEqual([...generators.map(generator => generator.id), 'document', 'ui', 'stories', 'data-source'].sort());
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
