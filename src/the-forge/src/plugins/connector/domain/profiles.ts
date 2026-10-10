import type { JsonSchema } from '../../../domain/schema/json-schema.ts';
import { isRecord } from '../../../domain/shared/errors.ts';

/** Profile keys every platform shares; the rest of a profile belongs to the platform's own schema. */
const SHARED_KEYS = ['platform', 'tokenEnv', 'linkProperty', 'effortProperty', 'mappings'] as const;
export const CONNECTION_ID = /^[a-z][a-z0-9-]*$/;

const nameMap = (description: string): JsonSchema => ({ type: 'object', description, additionalProperties: { type: 'string' } });

/**
 * The `plugins.settings.connector` section: named connection profiles. The shared fields are validated here when
 * the configuration loads; platform fields are validated against the platform connector's schema on use.
 */
export const connectorSettings: JsonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    connections: {
      type: 'object', default: {}, description: 'Connection profiles by id (lowercase kebab-case).',
      additionalProperties: {
        type: 'object', required: ['platform'], additionalProperties: true,
        properties: {
          platform: { type: 'string', pattern: '^[a-z][a-z0-9-]*$', description: 'The connector platform, for example azure-devops.' },
          tokenEnv: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$', description: 'The environment variable holding the access token; the platform default when omitted.' },
          linkProperty: { type: 'string', minLength: 1, description: 'The frontmatter key that links a note to its remote item; the platform default when omitted.' },
          effortProperty: { type: 'string', minLength: 1, default: 'effort', description: 'The frontmatter key of the effort or story points.' },
          mappings: {
            type: 'object', additionalProperties: false, default: {},
            properties: {
              types: nameMap('Local backlog type → remote work item type, over the process defaults.'),
              states: nameMap('Local state (optionally Type:State) → remote state, over the process defaults.'),
              fields: nameMap('Neutral field → remote field reference over the process defaults; an empty string stops syncing the field.'),
              properties: nameMap('Extra frontmatter key → remote field reference, synced as a plain value.'),
            },
          },
        },
      },
    },
  },
};

/** One profile split into its shared fields and its platform fields. */
export interface Profile {
  id: string; platform: string; tokenEnv?: string; linkProperty?: string; effortProperty: string;
  mappings: { types: Record<string, string>; states: Record<string, string>; fields: Record<string, string>; properties: Record<string, string> };
  specific: Record<string, unknown>;
}

const strings = (value: unknown): Record<string, string> => (isRecord(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {});

/** The validated `connections` object as profiles, in config order. */
export function profiles(settings: Readonly<Record<string, unknown>> | null): Profile[] {
  const connections = isRecord(settings?.connections) ? settings.connections : {};
  return Object.entries(connections).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])).map(([id, raw]) => {
    const mappings = isRecord(raw.mappings) ? raw.mappings : {};
    return {
      id, platform: String(raw.platform),
      ...(typeof raw.tokenEnv === 'string' ? { tokenEnv: raw.tokenEnv } : {}),
      ...(typeof raw.linkProperty === 'string' ? { linkProperty: raw.linkProperty } : {}),
      effortProperty: typeof raw.effortProperty === 'string' ? raw.effortProperty : 'effort',
      mappings: { types: strings(mappings.types), states: strings(mappings.states), fields: strings(mappings.fields), properties: strings(mappings.properties) },
      specific: Object.fromEntries(Object.entries(raw).filter(([key]) => !(SHARED_KEYS as readonly string[]).includes(key))),
    };
  });
}
