import type { JsonSchema } from '../../../domain/schema/json-schema.ts';

export const updateCheckSchema: JsonSchema = {
  type: 'object', required: ['installedVersion', 'releaseVersion', 'available', 'revision', 'releaseUrl'], additionalProperties: false,
  properties: { installedVersion: { type: 'string' }, releaseVersion: { type: 'string' }, available: { type: 'boolean' }, revision: { type: 'string' }, releaseUrl: { type: 'string' } },
};
export const updateApplySchema: JsonSchema = {
  type: 'object', required: ['installedVersion', 'releaseVersion', 'checksum', 'changed', 'dryRun', 'changes', 'revision', 'restartRequired'], additionalProperties: false,
  properties: { installedVersion: { type: 'string' }, releaseVersion: { type: 'string' }, checksum: { type: 'string' }, changed: { type: 'boolean' },
    dryRun: { type: 'boolean' }, changes: { type: 'array', items: { type: 'object' } }, revision: { type: 'string' }, restartRequired: { type: 'boolean' } },
};
