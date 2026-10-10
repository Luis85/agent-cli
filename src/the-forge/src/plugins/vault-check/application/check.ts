import { fileKind } from '../../../domain/documents/file.ts';
import { ruleIds, type Detection, type RuleId, type RuleSetting } from '../domain/rules.ts';
import { baseDetections, duplicateBlockIds, isEmpty, isOrphanAttachment, issueDetection } from './file-rules.ts';
import { referenceDetections, suggestions } from './link-rules.ts';
import { propertyDetections } from './property-rules.ts';
import { FrontmatterLocator, readTypeRegistry, type VaultSources } from './sources.ts';

/**
 * One `vault check`: the configured rule severities, the rules `--rule` selects (null for all), the ignore globs
 * of `plugins.settings.vault-check.ignore` and the `--path` filter.
 */
export interface CheckRequest {
  severities: Readonly<Record<RuleId, RuleSetting>>;
  selected: readonly RuleId[] | null;
  ignored(path: string): boolean;
  include(path: string): boolean;
}

/** Why a selected rule did not run: turned `off` in the settings, or its service is `unavailable`. */
export interface SkippedRule { rule: RuleId; reason: 'off' | 'unavailable' }

/** Detections in no particular order, the number of files checked, the rules that ran and the skipped ones. */
export interface CheckReport { detections: Detection[]; files: number; rules: RuleId[]; skipped: SkippedRule[] }

/**
 * Runs the enabled rules over the vault files that are neither ignored nor outside `--path`. Ignored files stay link
 * targets, and property types are inferred over every file that is not ignored. Nothing is written.
 */
export async function checkVault(sources: VaultSources, request: CheckRequest): Promise<CheckReport> {
  const wanted = request.selected ?? ruleIds;
  const skipped = wanted.flatMap((rule): SkippedRule[] => request.severities[rule] === 'off' ? [{ rule, reason: 'off' }]
    : rule === 'invalid-base' && sources.bases === null ? [{ rule, reason: 'unavailable' }] : []);
  const run = new Set(wanted.filter(rule => !skipped.some(entry => entry.rule === rule)));
  const runs = (rule: RuleId) => run.has(rule);
  const cache = await sources.cache();
  const scope = cache.files().filter(path => !request.ignored(path));
  const report = (path: string) => !request.ignored(path) && request.include(path);
  const checked = scope.filter(report);
  const locator = new FrontmatterLocator(sources), suggest = suggestions(cache.files());
  const detections: Detection[] = [];
  const add = (detection: Detection) => { if (runs(detection.rule)) detections.push(detection); };
  for (const path of checked) {
    (await referenceDetections(cache, path, runs, locator, suggest)).forEach(add);
    const parsed = cache.getFileCache(path);
    if (parsed && runs('duplicate-block-id')) duplicateBlockIds(path, parsed).forEach(add);
    if (runs('empty-file') && await isEmpty(path, cache, sources.size)) add({ rule: 'empty-file', path, line: null, column: null, message: 'empty-file', params: {} });
    if (runs('orphan-attachment') && isOrphanAttachment(path, cache)) add({ rule: 'orphan-attachment', path, line: null, column: null, message: 'orphan-attachment', params: {} });
    if (runs('invalid-base') && fileKind(path) === 'base') (await baseDetections(path, sources.bases!)).forEach(add);
  }
  for (const issue of cache.issues()) if (report(issue.path)) add(issueDetection(issue));
  if (runs('property-type-mismatch')) (await propertyDetections(cache, scope, report, await readTypeRegistry(sources), locator)).forEach(add);
  return { detections, files: checked.length, rules: ruleIds.filter(runs), skipped };
}
