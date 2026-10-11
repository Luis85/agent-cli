import { describe, expect, it } from 'vitest';
import { filterPlugins, formatUptime, parseSnapshot, type Plugin } from '../../src/system';
import { takeToken, TOKEN_KEY } from '../../src/composables/useSystem';

const plugin: Plugin = {
  id: 'sample', name: 'Sample plugin', version: '1.0.0', core: false, state: 'enabled',
  description: 'Manage notes', commands: ['notes'], generators: [], skills: [],
};
const response = () => ({ ok: true, data: {
  schemaVersion: 1, availability: { config: true, projects: true, selectedProject: true, plugins: true, capabilities: true }, updatedAt: '2026-10-11T12:00:00.000Z',
  server: { pid: 123, port: 54321, uptimeSeconds: 62, startedAt: '2026-10-11T11:59:00.000Z', host: '127.0.0.1', version: '0.1.0', nodeVersion: 'v24.0.0' },
  workspace: { root: '/workspace', projectsPath: 'src', selectedProject: null },
  projects: [], plugins: [plugin],
  stats: { projects: 0, plugins: 1, enabledPlugins: 1, commands: 1, generators: 0, skills: 0 },
  webviews: [{ id: 'admin', name: 'Developer admin', path: '/views/admin/' }], warnings: [],
} });

describe('versioned system response', () => {
  it('accepts the read-only snapshot including an unselected empty workspace', () => {
    expect(parseSnapshot(response()).workspace.selectedProject).toBeNull();
  });
  it('keeps partial failures separate from valid empty state', () => {
    const value = response();
    value.data.availability.projects = false;
    value.data.availability.selectedProject = false;
    expect(parseSnapshot(value).availability.selectedProject).toBe(false);
    expect(parseSnapshot(value).projects).toEqual([]);
  });
  it.each([
    { ok: false }, { ok: true, data: null }, { ok: true, data: { schemaVersion: 2 } },
    { ok: true, data: { ...response().data, plugins: [{ ...plugin, commands: null }] } },
    { ok: true, data: { ...response().data, workspace: { root: '/workspace' } } },
    { ok: true, data: { ...response().data, updatedAt: 'unknown' } },
    { ok: true, data: { ...response().data, availability: null } },
  ])('rejects invalid responses instead of rendering misleading state', value => {
    expect(() => parseSnapshot(value)).toThrow('Invalid system response');
  });
});

describe('plugin inspection', () => {
  const plugins = [plugin, { ...plugin, id: 'other', name: 'Other', description: 'Disabled tools', state: 'disabled' }];
  it('combines trimmed case-insensitive content search with state', () => {
    expect(filterPlugins(plugins, ' NOTES ', 'enabled')).toEqual([plugin]);
    expect(filterPlugins(plugins, 'notes', 'disabled')).toEqual([]);
    expect(filterPlugins(plugins, 'other', 'all').map(item => item.id)).toEqual(['other']);
  });
  it('formats uptime without implying millisecond precision', () => {
    expect(formatUptime(0)).toBe('Less than a minute');
    expect(formatUptime(61)).toBe('1 minute');
    expect(formatUptime(3661)).toBe('1 hour 1 min');
  });
});

describe('fragment authentication', () => {
  it('removes the credential before saving it and uses session storage for reload', () => {
    const actions: string[] = [];
    const saved = new Map<string, string>();
    const history = { replaceState: (_data: unknown, _unused: string, url?: string | URL | null) => { actions.push(String(url)); } };
    const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { actions.push('stored'); saved.set(key, value); } };
    expect(takeToken({ hash: '#token=secret-value', pathname: '/views/admin/', search: '' }, history, storage)).toBe('secret-value');
    expect(actions).toEqual(['/views/admin/', 'stored']);
    expect(saved.get(TOKEN_KEY)).toBe('secret-value');
    expect(takeToken({ hash: '', pathname: '/views/admin/', search: '' }, history, storage)).toBe('secret-value');
  });
  it('still authenticates in memory when browser storage is blocked', () => {
    const history = { replaceState: () => undefined };
    const storage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(takeToken({ hash: '#token=local-secret', pathname: '/views/admin/', search: '' }, history, storage)).toBe('local-secret');
    expect(takeToken({ hash: '', pathname: '/views/admin/', search: '' }, history, storage)).toBeNull();
  });
});
