import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import schema from './vendor/agent-schema.json';
import source from './vendor/source.json';
import { diagnostic, pointer, type AgentDiagnostic } from '../domain/config.ts';
import type { DefinitionSchema } from '../application/ports.ts';

/** The docker-agent commit whose `agent-schema.json` is vendored (see `scripts/vendor-docker-agent.mjs`). */
export const vendoredSchema = { repository: source.repository, commit: source.commit, configVersion: source.configVersion };

let compiled: ValidateFunction | undefined;
/** Compiled once per process, on first use: only agents commands pay for the large schema. */
function validator(): ValidateFunction {
  if (!compiled) {
    // The schema is draft-07 with annotation keywords such as `examples`; formats are checked like docker-agent's
    // own conformance test, which accepts any absolute URI for `format: uri`.
    const ajv = new Ajv({ allErrors: true, strict: false });
    ajv.addFormat('uri', value => URL.canParse(value));
    compiled = ajv.compile(schema);
  }
  return compiled;
}

/** Combinator summaries repeat what their branches report; keep them only when nothing more specific exists. */
const summaries = ['oneOf', 'anyOf', 'allOf', 'if', 'not'];

/** An unknown key points at itself rather than at the object that holds it. */
function located(error: ErrorObject): string {
  const property = error.keyword === 'additionalProperties' ? (error.params as { additionalProperty?: string }).additionalProperty : undefined;
  return property === undefined ? error.instancePath : `${error.instancePath}${pointer(property)}`;
}

function message(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;
  if (error.keyword === 'additionalProperties') return `Unknown property ${String(params.additionalProperty)}; docker-agent rejects unknown keys.`;
  if (error.keyword === 'enum') return `Must be one of: ${(params.allowedValues as unknown[]).map(value => JSON.stringify(value)).join(', ')}.`;
  return `${error.message ?? 'is invalid'}.`.replace(/^must/, 'Must');
}

/** Validates a parsed definition against the vendored docker-agent JSON Schema (draft-07, strict object keys). */
export const ajvDefinitionSchema: DefinitionSchema = {
  configVersion: source.configVersion,
  validate(value: unknown): AgentDiagnostic[] {
    const validate = validator();
    if (validate(value)) return [];
    const errors = validate.errors ?? [];
    const specific = errors.filter(error => !summaries.includes(error.keyword));
    const seen = new Set<string>();
    return (specific.length > 0 ? specific : errors).flatMap(error => {
      const entry = diagnostic('error', 'schema', located(error), message(error));
      const key = `${entry.pointer}\u0000${entry.message}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [entry];
    });
  },
};
