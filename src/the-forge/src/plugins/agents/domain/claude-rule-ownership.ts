import { forgeError, isRecord } from '../../../domain/shared/errors.ts';

/**
 * Which definitions granted each permission rule Forge wrote to `.claude/settings.json`. A rule's origins are the
 * definition files (and, for an agent's own rules, the agent) that grant it; a generation over a subset of the
 * definitions (`--file`, `--agent`) re-derives only the origins it covers, so it never removes a rule that a
 * definition outside that subset still grants.
 */
export const permissionLists = ['allow', 'ask', 'deny'] as const;
export type PermissionList = typeof permissionLists[number];
/** A definition file's top-level `permissions` (no `agent`), or the rules one of its agents derives (`agent`). */
export interface RuleOrigin { file: string; agent?: string }
/** One permission rule and the definitions that grant it. */
export interface GrantedRule { rule: string; origins: RuleOrigin[] }
/** Rules with their origins by list; a list without rules is absent. */
export type OwnedRules = Partial<Record<PermissionList, GrantedRule[]>>;
/**
 * The definitions one generation re-derives: every definition (`files` null), the named files, or with `agent` only
 * that agent's own rules in them. A file's top-level permissions depend on every agent's servers, so an `agent` run
 * never covers them.
 */
export interface GenerationCoverage { files: readonly string[] | null; agent?: string }
/** A rule a generation removes from the settings, because no definition grants it any more. */
export interface RevokedRule { list: PermissionList; rule: string; origins: RuleOrigin[] }

const originKey = (origin: RuleOrigin) => `${origin.file}\0${origin.agent ?? ''}`;
/** The distinct origins of `lists`, in a stable order. */
export function origins(...lists: ReadonlyArray<readonly RuleOrigin[]>): RuleOrigin[] {
  const unique = new Map<string, RuleOrigin>();
  for (const origin of lists.flat()) unique.set(originKey(origin), origin);
  return [...unique.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, origin]) => origin);
}

function covers(coverage: GenerationCoverage, origin: RuleOrigin): boolean {
  return (coverage.files === null || coverage.files.includes(origin.file)) && (coverage.agent === undefined || origin.agent === coverage.agent);
}

/** Only the non-empty lists, so a manifest without owned rules records no permissions. */
export const nonEmpty = (rules: OwnedRules): OwnedRules => Object.fromEntries(Object.entries(rules).filter(([, entries]) => entries.length > 0));

const invalid = (path: string, detail: string) => forgeError('INVALID_CLAUDE_SETTINGS', `${path} ${detail}`);
const originOf = (path: string, value: unknown): RuleOrigin => {
  if (!isRecord(value) || typeof value.file !== 'string' || (value.agent !== undefined && typeof value.agent !== 'string')) throw invalid(path, 'origins must be {file, agent?} objects.');
  return { file: value.file, ...(value.agent === undefined ? {} : { agent: value.agent as string }) };
};

/** The recorded rules of a manifest's `settings.permissions`: `{allow|ask|deny: [{rule, origins: [{file, agent?}]}]}`. */
export function recordedRules(path: string, value: unknown): OwnedRules {
  if (value === undefined) return {};
  if (!isRecord(value)) throw invalid(path, 'permissions must be an object.');
  const rules: OwnedRules = {};
  for (const list of permissionLists) {
    const entries = value[list];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) throw invalid(path, `permissions.${list} must be an array of {rule, origins}.`);
    rules[list] = entries.map(entry => {
      if (!isRecord(entry) || typeof entry.rule !== 'string' || !Array.isArray(entry.origins) || entry.origins.length === 0) throw invalid(path, `permissions.${list} must be an array of {rule, origins}.`);
      return { rule: entry.rule, origins: origins(entry.origins.map(origin => originOf(`${path} permissions.${list}`, origin))) };
    });
  }
  return nonEmpty(rules);
}

/**
 * One list of the settings file after a generation: `before` holds the file's rules, `recorded` the rules Forge
 * wrote earlier with their origins and `granted` the rules this generation derives. A recorded rule loses the
 * origins `coverage` re-derived and keeps the others; once it has none it is revoked. Granted rules are appended
 * where missing. Forge owns the granted rules it added now or before and the recorded rules that keep an origin;
 * a rule the file held before Forge would have added it stays the user's.
 */
export function reconcileRules(list: PermissionList, before: readonly string[], recorded: readonly GrantedRule[], granted: readonly GrantedRule[], coverage: GenerationCoverage) {
  const remaining = new Map(recorded.map(entry => [entry.rule, entry.origins.filter(origin => !covers(coverage, origin))]));
  const grants = new Map(granted.map(entry => [entry.rule, entry.origins]));
  const revoked: RevokedRule[] = recorded
    .filter(entry => remaining.get(entry.rule)!.length === 0 && !grants.has(entry.rule) && before.includes(entry.rule))
    .map(entry => ({ list, rule: entry.rule, origins: entry.origins }));
  const kept = before.filter(rule => !revoked.some(entry => entry.rule === rule));
  const rules = [...kept, ...granted.map(entry => entry.rule).filter(rule => !kept.includes(rule))];
  const owned = rules.flatMap((rule): GrantedRule[] => {
    const left = remaining.get(rule), given = grants.get(rule);
    if (given !== undefined && (left !== undefined || !before.includes(rule))) return [{ rule, origins: origins(left ?? [], given) }];
    return left !== undefined && left.length > 0 ? [{ rule, origins: left }] : [];
  });
  return { rules, owned, revoked };
}
