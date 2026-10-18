import metadata from '../../../package.json';

/** The executable as version output and the help and schema catalogs name it; `apiVersion` versions the envelope. */
export const forgeIdentity = { name: 'The Forge', version: metadata.version, apiVersion: 1 } as const;
