import type { Command, CommandContext } from '../../../application/plugins/registry.ts';
import { option } from '../../../application/plugins/command-metadata.ts';
import { arity, value } from '../../../application/plugins/command-input.ts';
import { pathGlob } from '../../../domain/documents/path-glob.ts';
import { ensure } from '../../../domain/shared/errors.ts';
import { checkVault, type CheckReport } from '../application/check.ts';
import { vaultProperties, vaultTags } from '../application/inventory.ts';
import type { VaultSources } from '../application/sources.ts';
import { tagSorts, type TagSort } from '../domain/inventory.ts';
import {
  compareFindings, effectiveSeverities, isRuleId, ruleIds, severities, type Detection, type Finding, type RuleId, type RuleSetting, type Severity,
} from '../domain/rules.ts';
import { fill } from './messages.ts';

const actions = ['check', 'tags', 'properties'] as const;
/** Error findings a failed `--strict` check carries in `error.details.findings`. */
const failureFindings = 100;

/** The plugin's view of one command context: its sources, its effective settings and its message strings. */
export interface VaultService {
  sources: VaultSources;
  rules: Readonly<Record<string, RuleSetting>>;
  ignore: readonly string[];
  t(key: string): string;
}

/** `--rule a,b`: known rule ids in rule order, or null for every rule. */
function selectedRules(text: string | undefined): RuleId[] | null {
  if (text === undefined) return null;
  const names = text.split(',').map(name => name.trim()).filter(name => name.length > 0);
  const unknown = names.filter(name => !isRuleId(name));
  ensure(names.length > 0 && unknown.length === 0, 'INVALID_ARGUMENT', `--rule takes comma-separated rule ids (${ruleIds.join(', ')}); unknown: ${unknown.join(', ') || '(none given)'}.`);
  return ruleIds.filter(id => names.includes(id));
}

function localized(service: VaultService, severity: (rule: RuleId) => Severity) {
  return (detection: Detection): Finding => {
    const hint = fill(service.t(`${detection.rule}.hint`), detection.params);
    const suggestion = detection.suggestion === undefined ? '' : ` ${fill(service.t('suggestion'), { suggestion: detection.suggestion })}`;
    return {
      rule: detection.rule, severity: severity(detection.rule), path: detection.path, line: detection.line, column: detection.column,
      message: fill(service.t(detection.message), detection.params), hint: hint + suggestion,
      ...(detection.suggestion === undefined ? {} : { suggestion: detection.suggestion }),
    };
  };
}

/** The `vault check` result, and the failure `--strict` raises when it holds an error finding. */
function checkResult(report: CheckReport, service: VaultService, settings: Record<RuleId, RuleSetting>, strict: boolean) {
  const severity = (rule: RuleId) => settings[rule] as Severity;
  const findings = report.detections.map(localized(service, severity)).sort(compareFindings);
  const count = (level: Severity) => findings.filter(finding => finding.severity === level).length;
  const summary = { files: report.files, findings: findings.length, ...Object.fromEntries(severities.map(level => [level, count(level)])) as Record<Severity, number> };
  const rules = report.rules.map(id => ({ id, severity: severity(id), findings: findings.filter(finding => finding.rule === id).length }));
  const skipped = report.skipped.map(({ rule, reason }) => ({ rule, reason, message: service.t(`skipped.${reason}`) }));
  if (strict && summary.error > 0) {
    const errors = findings.filter(finding => finding.severity === 'error');
    const byRule = rules.filter(rule => rule.severity === 'error' && rule.findings > 0).map(rule => `${rule.findings} ${rule.id}`).join(', ');
    throw Object.assign(new Error(`vault check --strict found ${summary.error} error finding${summary.error === 1 ? '' : 's'} (${byRule}).`), {
      code: 'VAULT_CHECK_FAILED',
      details: { summary, rules, findings: errors.slice(0, failureFindings), truncated: errors.length > failureFindings },
    });
  }
  return { findings, summary, rules, skipped, strict };
}

/**
 * The `vault` command: `check` (the default) reports broken links and embeds, invalid notes, Canvas and Bases files
 * and inconsistent structure; `tags` and `properties` inventory the vault. Read-only; `service` binds one context.
 */
export function vaultCommand(service: (context: CommandContext) => VaultService): Command {
  return {
    id: 'vault', description: 'Check the vault for broken links, invalid files and inconsistent properties, and inventory its tags and properties.',
    usage: 'vault [check] [--path glob] [--rule id[,id…]] [--strict] | tags [--path glob] [--sort name|count] | properties [--path glob] [--name property]',
    scope: 'project', discovery: false, mutating: false, defaultAction: 'check', unknownAction: 'INVALID_ARGUMENT',
    actions: {
      check: {
        description: 'Report findings of every enabled rule with severity, location, message and hint; --strict fails on error findings.',
        usage: 'vault check [--path glob] [--rule id[,id…]] [--strict]',
        options: {
          rule: option.string(`Only these comma-separated rules: ${ruleIds.join(', ')}.`),
          strict: option.boolean('Fail with VAULT_CHECK_FAILED when any finding has error severity.'),
        },
      },
      tags: {
        description: 'List frontmatter and inline tags with the files that use them; nested tags also count for their parents.',
        usage: 'vault tags [--path glob] [--sort name|count]',
        options: { sort: option.string('Order by tag name or by file count, most used first.', { enum: tagSorts, default: 'name' }) },
      },
      properties: {
        description: 'List frontmatter properties with value counts, inferred types, conflicts and the type declared in .obsidian/types.json.',
        usage: 'vault properties [--path glob] [--name property]',
        options: { name: option.string('Only this property, with the value type of each note.') },
      },
    },
    args: [{ name: 'action', description: 'check (default), tags or properties.', enum: actions }],
    options: { path: option.string('Only files whose root-relative path matches this glob.') },
    errors: ['VAULT_CHECK_FAILED'],
    async run(args, flags, context) {
      arity(args, 0, 1);
      const action = args[0] ?? 'check';
      ensure((actions as readonly string[]).includes(action), 'INVALID_ARGUMENT', `Use vault ${actions.join(', vault ')}.`);
      const vault = service(context);
      const glob = value(flags, 'path'), include = glob === undefined ? () => true : pathGlob(glob);
      const ignores = vault.ignore.map(pattern => pathGlob(pattern, 'plugins.settings.vault-check.ignore'));
      const scope = { include, ignored: (path: string) => ignores.some(ignored => ignored(path)) };
      if (action === 'tags') {
        const sort = value(flags, 'sort') ?? 'name';
        ensure((tagSorts as readonly string[]).includes(sort), 'INVALID_ARGUMENT', `--sort must be one of: ${tagSorts.join(', ')}.`);
        return vaultTags(vault.sources, scope, sort as TagSort);
      }
      if (action === 'properties') {
        const name = value(flags, 'name');
        ensure(name === undefined || name.trim().length > 0, 'INVALID_ARGUMENT', '--name must name a property.');
        return vaultProperties(vault.sources, scope, name);
      }
      const settings = effectiveSeverities(vault.rules);
      const report = await checkVault(vault.sources, { ...scope, severities: settings, selected: selectedRules(value(flags, 'rule')) });
      return checkResult(report, vault, settings, flags.strict === true);
    },
  };
}
