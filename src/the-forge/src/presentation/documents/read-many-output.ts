import type { JsonSchema } from '../../domain/schema/json-schema.ts';
import { readOutput } from './output.ts';

export const readManyOutput: JsonSchema = {
  type: 'object', required: ['files', 'bytes'], additionalProperties: false,
  properties: {
    files: { type: 'array', minItems: 1, maxItems: 32, items: readOutput,
      description: 'Default read results in requested order. Each revision describes that file when it was read; this is not an atomic snapshot.' },
    bytes: { type: 'integer', minimum: 0, maximum: 8 * 1024 * 1024,
      description: 'Sum of raw file byte counts, before JSON or base64 encoding.' },
  },
};
