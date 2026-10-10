import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/infrastructure/workspace/config.ts';
import { describe, expect, it } from 'vitest';
import { germanCommands, germanGenerators } from '../../src/presentation/localization/catalog.ts';
import { commands } from '../../src/presentation/cli/commands.ts';
import { basesCommand } from '../../src/presentation/bases/commands.ts';
import { claudeCommand } from '../../src/presentation/claude/commands.ts';
import { generators } from '../../src/infrastructure/generation/generators.ts';
import { Registry } from '../../src/application/plugins/registry.ts';
import type { WorkflowServices } from '../../src/presentation/cli/services.ts';

// Error-code coverage, including German summaries, lives in error-catalog tests.
describe('built-in localization catalog coverage', () => {
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
      const unavailable = (): never => { throw new Error('Catalog must not invoke management services'); };
      const management = [basesCommand(unavailable), claudeCommand({
        agentCodec: { parse: unavailable, render: unavailable }, target: unavailable,
      })];
      const ids = [...commands(registry, services), ...management].map(command => command.id).sort();
      expect(Object.keys(germanCommands).sort()).toEqual(ids);
      expect(Object.keys(germanGenerators).sort()).toEqual([...generators.map(generator => generator.id), 'document', 'ui', 'stories', 'data-source'].sort());
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
