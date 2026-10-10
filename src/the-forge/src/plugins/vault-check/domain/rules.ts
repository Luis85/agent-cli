/** Finding severities, most severe first. `vault check --strict` fails on `error` findings only. */
export const severities = ['error', 'warning', 'info'] as const;
export type Severity = typeof severities[number];
/** A configured rule severity; `off` never runs the rule. */
export type RuleSetting = Severity | 'off';
export const ruleSettings: readonly RuleSetting[] = [...severities, 'off'];

/**
 * The rules of `vault check` with their default severities, in reporting order. Broken references and files the
 * index cannot parse are errors; questionable but working structure is a warning; unused attachments are info.
 */
export const ruleDefaults = {
  'unresolved-link': 'error',
  'unresolved-embed': 'error',
  'ambiguous-link': 'warning',
  'unresolved-anchor': 'warning',
  'invalid-frontmatter': 'error',
  'invalid-canvas': 'error',
  'invalid-base': 'error',
  'property-type-mismatch': 'warning',
  'duplicate-block-id': 'warning',
  'empty-file': 'warning',
  'orphan-attachment': 'info',
} as const satisfies Record<string, Severity>;
export type RuleId = keyof typeof ruleDefaults;
export const ruleIds = Object.keys(ruleDefaults) as RuleId[];
export const isRuleId = (value: string): value is RuleId => Object.hasOwn(ruleDefaults, value);

/**
 * One problem a rule detected, before localization. `line` and `column` are 1-based and null for file-level
 * findings. `message` names the message template (the rule id, or `<rule>.<variant>`) and `params` its values;
 * `suggestion` is the vault path of the closest existing file for a missing link target.
 */
export interface Detection {
  rule: RuleId; path: string; line: number | null; column: number | null;
  message: string; params: Readonly<Record<string, string | number>>;
  suggestion?: string;
}

/** A reported finding: a detection with its effective severity and localized message and hint. */
export interface Finding {
  rule: RuleId; severity: Severity; path: string; line: number | null; column: number | null;
  message: string; hint: string; suggestion?: string;
}

const order = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);
const position = (value: number | null) => value ?? 0;

/** Deterministic order: path, line (file-level first), column, rule order, then message text. */
export function compareFindings(a: Finding, b: Finding): number {
  return order(a.path, b.path) || position(a.line) - position(b.line) || position(a.column) - position(b.column)
    || ruleIds.indexOf(a.rule) - ruleIds.indexOf(b.rule) || order(a.message, b.message);
}

/** The effective severity of every rule: its default, overridden by `plugins.settings.vault-check.rules`. */
export function effectiveSeverities(configured: Readonly<Record<string, RuleSetting>>): Record<RuleId, RuleSetting> {
  return Object.fromEntries(ruleIds.map(id => [id, configured[id] ?? ruleDefaults[id]])) as Record<RuleId, RuleSetting>;
}
