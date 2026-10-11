import { diagnostic, isObject, pointer, record, text, type AgentConfigDocument, type AgentDiagnostic } from './config.ts';
import { effectiveProvider, expandModelReference, firstAvailable, parseModelReference } from './references.ts';
import { modelAlias } from './claude-vocabulary.ts';
import { say } from './messages.ts';

export type ModelStyle = 'id' | 'alias';
export interface ClaudeModel { model: string; effort?: string; diagnostics: AgentDiagnostic[] }
interface Candidate { reference: string; provider?: string; id?: string; named?: string }

const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
/** Model settings with a Claude agent equivalent; every other key of the chosen model is reported as unsupported. */
const mappedModelKeys = ['provider', 'model', 'description', 'thinking_budget'];

/** Concrete candidates of a reference: alloys and `first_available` selectors expand in order. */
function candidates(config: AgentConfigDocument, reference: string, seen = new Set<string>()): Candidate[] {
  return expandModelReference(config, reference).flatMap((part): Candidate[] => {
    const named = record(config.models)[part];
    if (isObject(named)) {
      const selector = firstAvailable(named);
      if (selector) return seen.has(part) ? [] : selector.flatMap(candidate => candidates(config, candidate, new Set([...seen, part])));
      return [{ reference: part, provider: effectiveProvider(config, named.provider), id: typeof named.model === 'string' ? named.model : undefined, named: part }];
    }
    const inline = parseModelReference(part);
    return [{ reference: part, ...(inline ? { provider: inline.provider, id: inline.model } : {}) }];
  });
}

function styled(id: string, style: ModelStyle, at: string): { model: string; diagnostics: AgentDiagnostic[] } {
  if (style === 'id') return { model: id, diagnostics: [] };
  const alias = modelAlias(id);
  return alias
    ? { model: alias, diagnostics: [diagnostic('warning', 'model-alias', at, say('modelAlias', { id, alias }), 'A')] }
    : { model: id, diagnostics: [diagnostic('info', 'model-alias', at, say('modelNoAlias', { id }), 'A')] };
}

/** Claude `effort` for a docker-agent `thinking_budget` level or token budget. */
function effort(budget: unknown, at: string): { effort?: string; diagnostics: AgentDiagnostic[] } {
  if (budget === undefined) return { diagnostics: [] };
  const level = typeof budget === 'string' ? (budget === 'adaptive' ? 'high' : budget.replace(/^adaptive\//, '')) : undefined;
  if (level !== undefined && efforts.includes(level)) {
    return { effort: level, diagnostics: [diagnostic('warning', 'effort-approximated', at, say('effortLevel', { budget: JSON.stringify(budget), effort: level }), 'A')] };
  }
  if (typeof budget === 'number' && budget > 0) {
    const bucket = budget <= 4096 ? 'low' : budget <= 16384 ? 'medium' : 'high';
    return { effort: bucket, diagnostics: [diagnostic('warning', 'effort-approximated', at, say('effortBudget', { budget, effort: bucket }), 'A')] };
  }
  return { diagnostics: [diagnostic('info', 'effort-approximated', at, say('effortNone', { budget: String(JSON.stringify(budget)) }), 'A')] };
}

function unsupportedSettings(config: AgentConfigDocument, named: string): AgentDiagnostic[] {
  const model = record(record(config.models)[named]);
  return Object.keys(model).filter(key => !mappedModelKeys.includes(key)).map(key => diagnostic('info', 'model-setting-unsupported', pointer('models', named, key),
    say('modelSettingUnsupported', { key }), 'U'));
}

function harnessModel(agent: Record<string, unknown>, at: string, style: ModelStyle): ClaudeModel {
  const harness = record(agent.harness);
  if (harness.type !== 'claude-code') {
    return { model: 'inherit', diagnostics: [diagnostic('warning', 'harness-unsupported', `${at}/harness`, say('harnessUnsupported', { type: String(harness.type) }), 'U')] };
  }
  const chosen = text(harness.model) ? styled(harness.model.replace(/^anthropic\//, ''), style, `${at}/harness/model`) : { model: 'inherit', diagnostics: [] };
  return {
    model: chosen.model, ...(typeof harness.effort === 'string' ? { effort: harness.effort } : {}),
    diagnostics: [diagnostic('warning', 'harness-approximated', `${at}/harness`, say('harnessApproximated'), 'A'), ...chosen.diagnostics],
  };
}

/**
 * The Claude `model` (and `effort`) of one agent. An inline `anthropic/<id>` or a single named Anthropic model maps
 * exactly; `auto`, alloys, `first_available` selectors and other providers use the first Anthropic candidate, or
 * `inherit` without one, with a warning.
 */
export function claudeModel(config: AgentConfigDocument, name: string, agent: Record<string, unknown>, style: ModelStyle): ClaudeModel {
  const at = pointer('agents', name);
  if (isObject(agent.harness)) return harnessModel(agent, at, style);
  const reference = typeof agent.model === 'string' ? agent.model.trim() : '';
  if (reference === '') return { model: 'inherit', diagnostics: [diagnostic('warning', 'model-approximated', `${at}/model`, say('modelMissing'), 'A')] };
  const options = candidates(config, reference);
  const anthropic = options.find(candidate => candidate.provider === 'anthropic' && text(candidate.id));
  if (!anthropic) {
    return { model: 'inherit', diagnostics: [diagnostic('warning', 'model-approximated', `${at}/model`, say('modelNoAnthropic', { reference }), 'A')] };
  }
  const exact = options.length === 1 && expandModelReference(config, reference).length === 1 && !firstAvailable(record(config.models)[reference]);
  const chosen = styled(anthropic.id!, style, `${at}/model`);
  const thinking = anthropic.named ? effort(record(record(config.models)[anthropic.named]).thinking_budget, pointer('models', anthropic.named, 'thinking_budget')) : { diagnostics: [] };
  return {
    model: chosen.model, ...(thinking.effort ? { effort: thinking.effort } : {}),
    diagnostics: [
      ...(exact ? [] : [diagnostic('warning', 'model-approximated', `${at}/model`, say('modelSelected', { reference, candidate: anthropic.reference }), 'A')]),
      ...chosen.diagnostics, ...thinking.diagnostics, ...(anthropic.named ? unsupportedSettings(config, anthropic.named) : []),
    ],
  };
}
