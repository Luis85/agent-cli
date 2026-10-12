import { expect, it } from 'vitest';
import type { Command, Generator, PluginContributions, PluginContext } from '../../src/sdk.ts';
import { Registry, type CommandContext, type GeneratorRequest } from '../../src/application/plugins/registry.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { skillFrontmatter } from '../../src/infrastructure/plugins/skill-frontmatter.ts';

it('infers plugin context for contributed commands and both generator forms, as the runtime supplies it', async () => {
  // No callback annotations or casts: the public SDK must infer settings, services and translations.
  const plugin = {
    settings: { type: 'object', properties: { title: { type: 'string', default: 'Report' } } },
    strings: { en: { messages: { ready: 'Ready' } } },
    provides: { 'quality.label': 'Quality' },
    commands: [{
      id: 'quality.status', description: 'Status', usage: 'quality.status',
      run(_args, _flags, context) {
        return { title: context.settings?.title, label: context.services.get<string>('quality.label'), message: context.t('ready') };
      },
    }],
    generators: [
      { id: 'quality.report', description: 'Report', run({ context }) { return context.settings?.title; } },
      { id: 'quality.note', description: 'Note', generate({ directory, context }) {
        return [{ path: `${directory}/note.md`, bytes: new TextEncoder().encode(context.t('ready')) }];
      } },
    ],
  } satisfies PluginContributions;
  // Standalone declarations can select the same context explicitly.
  const command: Command<PluginContext> = plugin.commands[0]!;
  const generator: Generator<PluginContext> = plugin.generators[0]!;
  expect(command.id).toBe('quality.status');
  expect(generator.id).toBe('quality.report');
  const registry = new Registry(skillFrontmatter), events = new EventBus(new NodeEventScope());
  registerHostEvents(events);
  registry.register({ ...plugin, manifest: { id: 'quality', name: 'Quality', version: '1.0.0', minAppVersion: '0.1.0', description: 'Test', author: 'Test' } }, events);
  await registry.configure({}, async () => [], message => events.warn(message));
  const context = { language: 'en' } as CommandContext;
  await registry.activate(events, context);
  expect(await registry.commands.get(command.id)!.run([], {}, context)).toEqual({ title: 'Report', label: 'Quality', message: 'Ready' });
  const request = { context, directory: 'notes', name: 'Note', flags: {} } as GeneratorRequest;
  expect(await registry.generators.get(generator.id)!.run!(request)).toBe('Report');
  const writes = await registry.generators.get('quality.note')!.generate!(request);
  expect(writes).toEqual([{ path: 'notes/note.md', bytes: new TextEncoder().encode('Ready') }]);
  await registry.dispose(events);
});
