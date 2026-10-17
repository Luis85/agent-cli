import { expect, it } from 'vitest';
import { commandAnnotations } from '../../src/application/plugins/command-metadata.ts';
import { fullRegistry } from '../support/full-registry.ts';
import { browserProbes, families, mutatingModes, unprobed } from '../support/idempotency.ts';

/** The probe families of the `idempotency-*.e2e` files together cover every mutating mode the schema publishes. */
it('probes every mutating mode the schema publishes in exactly one family', async () => {
  const registry = await fullRegistry();
  // `schema` publishes each registered command with these annotations.
  const declared = mutatingModes([...registry.commands.values()].map(command => ({ id: command.id, annotations: commandAnnotations(command) })));
  const probed = Object.values(families).flatMap(family => family.probes.map(probe => probe.mode));
  expect(probed.filter((mode, index) => probed.indexOf(mode) !== index)).toEqual([]);
  expect([...declared.keys()].sort()).toEqual([...probed, ...Object.keys(unprobed), ...browserProbes].sort());
  for (const mode of Object.keys(unprobed)) expect(declared.get(mode), mode).toBe(false);
  for (const mode of browserProbes) expect(declared.get(mode), mode).toBe(true);
});
