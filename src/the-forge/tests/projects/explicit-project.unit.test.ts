import { describe, expect, it } from 'vitest';
import { documentCommands } from '../../src/presentation/documents/commands.ts';
import { vaultCommands } from '../../src/presentation/documents/vault-commands.ts';
import { readManyCommand } from '../../src/presentation/documents/read-many-command.ts';
import { statCommand } from '../../src/presentation/documents/stat-command.ts';
import { commandInputSchema } from '../../src/application/plugins/command-metadata.ts';
import { validateJsonValue } from '../../src/domain/schema/json-schema.ts';
import { invocationPolicy } from '../../src/presentation/cli/invocation-policy.ts';
import { germanDescriptions } from '../../src/presentation/localization/descriptions.ts';

// Every kernel file command, read-only or guarded, can target a project other than the selected one.
const commands = [...documentCommands(), readManyCommand(), statCommand(), ...vaultCommands()];

describe('explicit project document command contracts', () => {
  it('covers every kernel file command', () => {
    expect(commands.map(command => command.id).sort()).toEqual(['apply', 'create', 'delete', 'edit', 'list', 'move', 'patch', 'properties', 'read', 'read-many', 'rename', 'stat', 'validate', 'write']);
  });

  it.each(commands)('$id publishes optional project targeting without changing default routing', command => {
    const args = command.id === 'list' ? [] : command.id === 'apply' ? ['-'] : ['move', 'rename'].includes(command.id) ? ['Note.md', 'Other.md'] : ['Note.md'];
    expect(command.projectOption).toBe('project');
    expect(command.options?.project).toMatchObject({ type: 'string' });
    expect(germanDescriptions[command.options!.project!.description]).toBe('Dieses Projekt statt des ausgewählten Projekts verwenden.');
    const schema = commandInputSchema(command);
    const required = Object.fromEntries(Object.entries(command.options ?? {}).filter(([, option]) => option.required).map(([name]) => [name, 'x']));
    expect(validateJsonValue(schema, { args, options: { ...required, project: 'alpha' } }, 'input').issues).toEqual([]);
    expect(validateJsonValue(schema, { args, options: required }, 'input').issues).toEqual([]);
    expect(validateJsonValue(schema, { args, options: { ...required, project: true } }, 'input').issues.length).toBeGreaterThan(0);
    expect(invocationPolicy(command, args, {})).toEqual({ scope: 'project', activatePlugins: true });
    expect(invocationPolicy(command, args, { project: 'alpha' })).toEqual({ scope: 'project', activatePlugins: true, requestedProject: 'alpha' });
    expect(invocationPolicy(command, args, { project: 'alpha', help: true })).toEqual({ scope: 'workspace', activatePlugins: false, requestedProject: 'alpha' });
  });
});
