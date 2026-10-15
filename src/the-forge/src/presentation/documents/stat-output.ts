import type { JsonSchema } from '../../domain/schema/json-schema.ts';

const identity: Record<string, JsonSchema> = {
  path: { type: 'string', description: 'Path relative to context.root, with / separators.' },
  revision: { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'Existing repository file or folder revision, suitable for revision guards in the same scope.' },
};

/** Compact metadata only: folder contents and document representations are never serialized. */
export const statOutput: JsonSchema = {
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['path', 'kind', 'revision', 'bytes'],
      properties: { ...identity, kind: { type: 'string', const: 'file' }, bytes: { type: 'integer', minimum: 0, description: 'Raw file byte count, without parsing or validating its document format.' } } },
    { type: 'object', additionalProperties: false, required: ['path', 'kind', 'revision', 'fileCount', 'folderCount'],
      properties: {
        ...identity, kind: { type: 'string', const: 'folder' },
        fileCount: { type: 'integer', minimum: 0, description: 'Regular descendant files included by repository stat; excludes Git, internal entries, symlinks and node_modules contents.' },
        folderCount: { type: 'integer', minimum: 0, description: 'Descendant folders, including empty ones, excluding this folder, Git, internal entries, symlinks and node_modules.' },
      } },
  ],
};
