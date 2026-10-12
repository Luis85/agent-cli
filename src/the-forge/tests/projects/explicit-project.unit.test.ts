import { describe, expect, it } from 'vitest';
import { documentCommands } from '../../src/presentation/documents/commands.ts';
import { commandInputSchema } from '../../src/application/plugins/command-metadata.ts';
import { validateJsonValue } from '../../src/domain/schema/json-schema.ts';
import { invocationPolicy } from '../../src/presentation/cli/invocation-policy.ts';
import { germanDescriptions } from '../../src/presentation/localization/descriptions.ts';

const commands = documentCommands().filter(command => ['read', 'apply'].includes(command.id));

describe('explicit project document command contracts', () => {
  it.each(commands)('$id publishes optional project targeting without changing default routing', command => {
    const args = [command.id === 'read' ? 'Note.md' : '-'];
    expect(command.projectOption).toBe('project');
    expect(command.options?.project).toMatchObject({ type: 'string' });
    expect(germanDescriptions[command.options!.project!.description]).toBe('Dieses Projekt statt des ausgewählten Projekts verwenden.');
    const schema = commandInputSchema(command);
    expect(validateJsonValue(schema, { args, options: { project: 'alpha' } }, 'input').issues).toEqual([]);
    expect(validateJsonValue(schema, { args, options: {} }, 'input').issues).toEqual([]);
    expect(validateJsonValue(schema, { args, options: { project: true } }, 'input').issues.length).toBeGreaterThan(0);
    expect(invocationPolicy(command, args, {})).toEqual({ scope: 'project', activatePlugins: true });
    expect(invocationPolicy(command, args, { project: 'alpha' })).toEqual({ scope: 'project', activatePlugins: true, requestedProject: 'alpha' });
    expect(invocationPolicy(command, args, { project: 'alpha', help: true })).toEqual({ scope: 'workspace', activatePlugins: false, requestedProject: 'alpha' });
  });
});
