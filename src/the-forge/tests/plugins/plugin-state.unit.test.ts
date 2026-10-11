import { describe, expect, it } from 'vitest';
import { ActivationTracker, type PluginStateStore, type PluginStates } from '../../src/application/plugins/plugin-state.ts';
import { forgeError } from '../../src/domain/shared/errors.ts';

/** A state store whose saves fail with CONFLICT `conflicts` times while another writer holds `current`. */
function racingStore(conflicts: number, current: PluginStates) {
  const saved: PluginStates[] = [];
  let loads = 0;
  const store: PluginStateStore = {
    async load() { return loads++ === 0 ? {} : current; },
    async save(states) {
      saved.push(states);
      if (saved.length <= conflicts) throw forgeError('CONFLICT', 'File changed; read again before modifying: bin/data/plugins-state.json');
    },
    async settingsRevision() { return null; },
  };
  return { store, saved, loads: () => loads };
}
const plugin = (id: string) => ({ manifest: { id }, onUserEnable() {} });

describe('plugin activation state', () => {
  it('rereads and merges the state once when a concurrent writer recorded it first', async () => {
    const { store, saved, loads } = racingStore(1, { beta: { settings: 'other' }, gone: { settings: null } });
    const tracker = await ActivationTracker.load(store);
    await tracker.activated(plugin('alpha'), {});
    const warnings: string[] = [];
    await tracker.save([plugin('alpha'), plugin('beta')], message => warnings.push(message));
    expect(loads()).toBe(2);
    expect(saved).toEqual([{ alpha: { settings: null } }, { alpha: { settings: null }, beta: { settings: 'other' } }]);
    expect(warnings).toEqual([]);
  });

  it('warns when the retried write conflicts again', async () => {
    const { store, saved } = racingStore(2, {});
    const tracker = await ActivationTracker.load(store);
    await tracker.activated(plugin('alpha'), {});
    const warnings: string[] = [];
    await tracker.save([plugin('alpha')], message => warnings.push(message));
    expect(saved).toHaveLength(2);
    expect(warnings).toEqual([expect.stringMatching(/^Could not record plugin activation state in bin\/data\/plugins-state.json: File changed/)]);
  });
});
