import { describe, expect, it } from 'vitest';
import { invocationPolicy } from '../../src/presentation/cli/invocation-policy.ts';
import type { CommandMetadata } from '../../src/application/plugins/command-metadata.ts';
import { builtinCommands } from '../support/builtin-commands.ts';

const { commands } = builtinCommands();
const command = (id: string) => commands.get(id)!;
const plugin: CommandMetadata = { id: 'custom.action', description: 'Custom', usage: 'custom.action' };

describe('invocation scope and plugin activation policy from command metadata', () => {
  it('keeps discovery and recovery independent of selected projects and plugin activation', () => {
    for (const id of ['help', 'schema', 'config', 'formats', 'events', 'plugins', 'setup']) {
      expect(invocationPolicy(command(id), [], {}), id).toEqual({ scope: 'workspace', activatePlugins: false });
    }
    expect(invocationPolicy(command('claude'), [], {})).toEqual({ scope: 'workspace', activatePlugins: false });
    expect(invocationPolicy(command('claude'), ['capabilities'], {})).toEqual({ scope: 'workspace', activatePlugins: false });
    expect(invocationPolicy(plugin, [], { help: true })).toEqual({ scope: 'workspace', activatePlugins: false });
  });

  it('activates shared library and management commands while retaining workspace scope', () => {
    for (const id of ['project', 'templates', 'components', 'data-sources', 'interactions', 'workflows']) {
      expect(invocationPolicy(command(id), ['list'], {}), id).toEqual({ scope: 'workspace', activatePlugins: true });
    }
    expect(invocationPolicy(command('make'), [], {})).toEqual({ scope: 'workspace', activatePlugins: true });
    expect(invocationPolicy(command('make'), ['plugin', 'Example'], {})).toEqual({ scope: 'workspace', activatePlugins: true });
  });

  it('uses selected project scope for file operations, native execution and undeclared plugin commands', () => {
    expect(invocationPolicy(command('write'), ['Note.md'], {})).toEqual({ scope: 'project', activatePlugins: true });
    expect(invocationPolicy(command('claude'), ['runtime', 'version'], {})).toEqual({ scope: 'project', activatePlugins: true });
    expect(invocationPolicy(command('make'), ['entity', 'Order'], {})).toEqual({ scope: 'project', activatePlugins: true });
    expect(invocationPolicy(plugin, [], { 'dry-run': true })).toEqual({ scope: 'project', activatePlugins: true });
  });

  it('separates shared skill discovery from installation into the selected project', () => {
    for (const args of [[], ['list'], ['show', 'review']]) expect(invocationPolicy(command('skills'), args, {})).toEqual({ scope: 'workspace', activatePlugins: true });
    expect(invocationPolicy(command('skills'), ['install'], {})).toEqual({ scope: 'project', activatePlugins: true });
  });

  it('honors explicit project overrides only for generators that declare a project option', () => {
    for (const generator of ['ui', 'stories', 'data-source']) {
      expect(invocationPolicy(command('make'), [generator, 'example'], { project: 'other' })).toEqual({ scope: 'project', activatePlugins: true, requestedProject: 'other' });
    }
    expect(invocationPolicy(command('make'), ['document', 'Example'], { project: 'other' })).toEqual({ scope: 'project', activatePlugins: true });
    expect(invocationPolicy(plugin, [], { project: 'other' })).toEqual({ scope: 'project', activatePlugins: true });
  });

  it('keeps generator help at workspace scope even with an explicit project flag', () => {
    expect(invocationPolicy(command('make'), ['ui', 'example'], { project: 'other', help: true })).toEqual({ scope: 'workspace', activatePlugins: false, requestedProject: 'other' });
  });

  it('derives every decision from declared fields, so new commands need no policy change', () => {
    const declared: CommandMetadata = {
      id: 'reports', description: 'Reports', usage: 'reports', scope: 'workspace', mutating: false, defaultAction: 'list',
      options: { target: { type: 'string', description: 'Project' } },
      actions: { list: { description: 'List' }, publish: { description: 'Publish', scope: 'project', mutating: true, projectOption: 'target' }, doctor: { description: 'Diagnose', discovery: true } },
    };
    expect(invocationPolicy(declared, [], {})).toEqual({ scope: 'workspace', activatePlugins: true });
    expect(invocationPolicy(declared, ['publish'], { target: 'web' })).toEqual({ scope: 'project', activatePlugins: true, requestedProject: 'web' });
    expect(invocationPolicy(declared, ['doctor'], {})).toEqual({ scope: 'workspace', activatePlugins: false });
    expect(invocationPolicy(declared, ['unknown'], {})).toEqual({ scope: 'workspace', activatePlugins: true });
  });
});
