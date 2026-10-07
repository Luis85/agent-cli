import { describe, expect, it } from 'vitest';
import { invocationPolicy } from '../../src/presentation/cli/invocation-policy.ts';

describe('invocation scope and plugin activation policy', () => {
  it('keeps discovery and recovery independent of selected projects and plugin activation', () => {
    for (const id of ['help', 'schema', 'config', 'formats', 'events', 'plugins', 'setup']) {
      expect(invocationPolicy(id, [], {})).toEqual({ scope: 'workspace', activatePlugins: false });
    }
    expect(invocationPolicy('claude', [], {})).toEqual({ scope: 'workspace', activatePlugins: false });
    expect(invocationPolicy('claude', ['capabilities'], {})).toEqual({ scope: 'workspace', activatePlugins: false });
    expect(invocationPolicy('custom.action', [], { help: true })).toEqual({ scope: 'workspace', activatePlugins: false });
  });

  it('activates shared library and management commands while retaining workspace scope', () => {
    for (const id of ['project', 'templates', 'components', 'data-sources', 'interactions']) {
      expect(invocationPolicy(id, ['list'], {})).toEqual({ scope: 'workspace', activatePlugins: true });
    }
    expect(invocationPolicy('make', [], {})).toEqual({ scope: 'workspace', activatePlugins: true });
    expect(invocationPolicy('make', ['plugin', 'Example'], {})).toEqual({ scope: 'workspace', activatePlugins: true });
  });

  it('uses selected project scope for file operations, native execution and custom commands', () => {
    expect(invocationPolicy('write', ['Note.md'], {})).toEqual({ scope: 'project', activatePlugins: true });
    expect(invocationPolicy('claude', ['runtime', 'version'], {})).toEqual({ scope: 'project', activatePlugins: true });
    expect(invocationPolicy('custom.action', [], { 'dry-run': true })).toEqual({ scope: 'project', activatePlugins: true });
  });

  it('separates shared skill discovery from installation into the selected project', () => {
    for (const args of [[], ['list'], ['show', 'review']]) expect(invocationPolicy('skills', args, {})).toEqual({ scope: 'workspace', activatePlugins: true });
    expect(invocationPolicy('skills', ['install'], {})).toEqual({ scope: 'project', activatePlugins: true });
  });

  it('honors explicit project overrides only for supported library generators', () => {
    for (const generator of ['ui', 'stories', 'data-source']) {
      expect(invocationPolicy('make', [generator, 'example'], { project: 'other' })).toEqual({ scope: 'project', activatePlugins: true, requestedProject: 'other' });
    }
    expect(invocationPolicy('make', ['document', 'Example'], { project: 'other' })).toEqual({ scope: 'project', activatePlugins: true });
    expect(invocationPolicy('custom.action', [], { project: 'other' })).toEqual({ scope: 'project', activatePlugins: true });
  });

  it('keeps generator help at workspace scope even with an explicit project flag', () => {
    expect(invocationPolicy('make', ['ui', 'example'], { project: 'other', help: true })).toEqual({ scope: 'workspace', activatePlugins: false, requestedProject: 'other' });
  });
});
