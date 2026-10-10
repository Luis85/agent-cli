import { isObject, record, stringList, type AgentConfigDocument } from './config.ts';

/**
 * Agent and model references, ported from docker-agent `pkg/config` (references.go, overrides.go and
 * latest/model_ref.go at the vendored commit). Local agent names never contain `/`; external references are URLs or
 * OCI references, optionally prefixed with an explicit `name:`.
 */
const ociReference = /^(?:[a-zA-Z0-9.-]+(?::\d+)?\/)?[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*(?::[\w][\w.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/;
const localFile = /\.(?:ya?ml|hcl)$/i;

const isUrlReference = (input: string) => input.startsWith('http://') || input.startsWith('https://');
const isExternalRef = (input: string) => isUrlReference(input) || (input.includes('/') && !localFile.test(input) && ociReference.test(input));

function baseName(ref: string): string {
  if (isUrlReference(ref)) {
    const file = ref.split(/[?#]/)[0]!.split('/').at(-1) ?? '';
    const dot = file.lastIndexOf('.');
    return dot > 0 ? file.slice(0, dot) : file;
  }
  let base = ref.split('@')[0]!;
  const colon = base.lastIndexOf(':');
  if (colon >= 0 && !base.slice(colon + 1).includes('/')) base = base.slice(0, colon);
  return base.split('/').at(-1) ?? base;
}

/** The agent name and reference of an external sub-agent, handoff or force_handoff target; local names map to themselves. */
export function externalAgentReference(input: string): { name: string; ref: string } {
  if (isExternalRef(input)) return { name: baseName(input), ref: input };
  const colon = input.indexOf(':');
  if (colon > 0 && !input.slice(0, colon).includes('/') && isExternalRef(input.slice(colon + 1))) return { name: input.slice(0, colon), ref: input.slice(colon + 1) };
  return { name: input, ref: input };
}

export const isExternalReference = (input: string) => isExternalRef(externalAgentReference(input).ref);

/** `provider/model`, split at the first slash; anything else is not an inline model reference. */
export function parseModelReference(ref: string): { provider: string; model: string } | undefined {
  const slash = ref.indexOf('/');
  if (slash <= 0 || slash === ref.length - 1) return undefined;
  return { provider: ref.slice(0, slash), model: ref.slice(slash + 1) };
}

const isAlloy = (model: Record<string, unknown>) => (model.provider === undefined || model.provider === '') && typeof model.model === 'string' && model.model.includes(',');

/**
 * Expands an agent's model reference like docker-agent: a named model without a provider whose `model` lists
 * comma-separated references (an "alloy") expands recursively, and comma-separated references expand per part.
 */
export function expandModelReference(config: AgentConfigDocument, reference: string, seen = new Set<string>()): string[] {
  const trimmed = reference.trim();
  if (trimmed === '') return [];
  if (!trimmed.includes(',')) {
    const model = record(config.models)[trimmed];
    if (!isObject(model) || !isAlloy(model) || seen.has(trimmed)) return [trimmed];
    return expandModelReference(config, model.model as string, new Set([...seen, trimmed]));
  }
  return trimmed.split(',').flatMap(part => expandModelReference(config, part, seen));
}

/** A model reference resolves to `auto`, a named model or an inline `provider/model`. */
export function modelResolves(config: AgentConfigDocument, reference: string): boolean {
  const name = reference.trim();
  return name === '' || name === 'auto' || Object.hasOwn(record(config.models), name) || parseModelReference(name) !== undefined;
}

/** The provider type of a named model: its own provider, resolved through the `providers` section. */
export function effectiveProvider(config: AgentConfigDocument, provider: unknown): string | undefined {
  if (typeof provider !== 'string' || provider === '') return undefined;
  const custom = record(config.providers)[provider];
  return isObject(custom) && typeof custom.provider === 'string' && custom.provider !== '' ? custom.provider : provider;
}

/** `first_available` candidates of a named model, if it is a selector. */
export const firstAvailable = (model: unknown): string[] | undefined => isObject(model) && Array.isArray(model.first_available) ? stringList(model.first_available) : undefined;
