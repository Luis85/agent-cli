import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { commandInputSchema } from '../../src/application/plugins/command-metadata.ts';
import { validateJsonValue } from '../../src/domain/schema/json-schema.ts';
import { builtinCommands } from '../support/builtin-commands.ts';
import { basesPlugin } from '../../src/plugins/bases/plugin.ts';
import { linksPlugin } from '../../src/plugins/links/plugin.ts';
import { searchPlugin } from '../../src/plugins/search/plugin.ts';
import { skillsPlugin } from '../../src/plugins/skills/plugin.ts';
import { agentsPlugin } from '../../src/plugins/agents/plugin.ts';
import { connectorPlugin } from '../../src/plugins/connector/plugin.ts';
import { azureDevOpsPlugin } from '../../src/plugins/connector-azure-devops/plugin.ts';
import { backlogPlugin } from '../../src/plugins/backlog/plugin.ts';
import { offlineHost } from '../support/core-plugins.ts';

const host = { skills: { list: () => [], get: () => undefined }, fileDates: () => () => Promise.reject(new Error('unused')), ...offlineHost };
const corePlugins = [basesPlugin, skillsPlugin, searchPlugin, linksPlugin, agentsPlugin, connectorPlugin, azureDevOpsPlugin, backlogPlugin];
const { commands } = builtinCommands();
for (const plugin of [searchPlugin, linksPlugin]) for (const command of plugin.create(host).commands ?? []) commands.set(command.id, command);
/**
 * An independent JSON Schema 2020-12 validator in strict mode, so unknown keywords and formats fail to compile.
 * Positional arguments are deliberately open-ended tuples (optional trailing arguments), which strictTuples flags.
 */
const ajv = new Ajv2020({ strict: true, strictTuples: false, allErrors: true });
const validator = (id: string) => ajv.compile(commandInputSchema(commands.get(id)!));
const invocation = (args: string[], options: Record<string, unknown> = {}) => ({ args, options });

describe('published input schemas under an independent JSON Schema 2020-12 validator', () => {
  it('compiles every command input schema and every core plugin settings schema in strict mode', () => {
    for (const command of commands.values()) expect(() => ajv.compile(commandInputSchema(command)), command.id).not.toThrow();
    for (const plugin of corePlugins) {
      const { settings } = plugin.create(host);
      if (settings) expect(() => ajv.compile(settings), plugin.manifest.id).not.toThrow();
    }
  });

  it.each([
    ['make', invocation([]), true],
    ['make', invocation(['entity', 'Order'], { out: 'src/domain/orders' }), true],
    ['make', invocation(['entity', 'Order'], { template: 'prd.md' }), false],
    ['make', invocation(['document', 'Plan']), false],
    ['make', invocation(['document', 'Plan'], { template: 'prd.md', values: '{}' }), true],
    ['make', invocation(['plugin', 'quality'], { out: 'x' }), false],
    ['make', invocation(['ui', 'button'], { framework: 'react', plan: true, project: 'web' }), true],
    ['make', invocation([], { out: 'x' }), false],
    ['skills', invocation([]), true],
    ['skills', invocation(['install'], { out: '.agents/skills' }), true],
    ['skills', invocation(['remove']), false],
    ['links', invocation(['orphans'], { path: 'notes/**' }), true],
    ['links', invocation([]), false],
    ['claude', invocation(['plugins', 'install', 'review@team']), true],
    ['edit', invocation(['note.md'], { 'if-match': 'a'.repeat(64), append: true, content: 'More' }), true],
    ['edit', invocation([], { append: 'yes' }), false],
    ['list', invocation([], { kind: 'video' }), true],
    ['list', invocation(['extra'], { kind: 'movie' }), false],
  ] as const)('%s %j valid=%s agrees with the Forge validator', (id, value, valid) => {
    expect(validator(id)(value), JSON.stringify(validator(id).errors)).toBe(valid);
    expect(validateJsonValue(commandInputSchema(commands.get(id)!), value, 'input').issues.length === 0).toBe(valid);
  });
});
