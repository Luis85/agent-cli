import type { JsonSchema } from '../../../domain/schema/json-schema.ts';

export const updateCheckSchema: JsonSchema = {
  type: 'object', required: ['installedVersion', 'releaseVersion', 'available', 'revision', 'releaseUrl'], additionalProperties: false,
  properties: { installedVersion: { type: 'string' }, releaseVersion: { type: 'string' }, available: { type: 'boolean' }, revision: { type: 'string' }, releaseUrl: { type: 'string' } },
};
export const updateApplySchema: JsonSchema = {
  type: 'object', required: ['installedVersion', 'releaseVersion', 'checksum', 'downloaded', 'changed', 'dryRun', 'changes', 'revision', 'restartRequired'], additionalProperties: false,
  properties: { installedVersion: { type: 'string' }, releaseVersion: { type: 'string' },
    checksum: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Verified archive SHA-256; null in a dry run, which downloads nothing.' },
    downloaded: { type: 'boolean', description: 'Whether the release was downloaded and verified; false in a dry run.' },
    changed: { type: 'boolean', description: 'Whether files changed; in a dry run, whether the requested version differs from the installed one.' },
    dryRun: { type: 'boolean' }, changes: { type: 'array', items: { type: 'object' } }, revision: { type: 'string' }, restartRequired: { type: 'boolean' } },
};
