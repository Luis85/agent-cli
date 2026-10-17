import { PluginFailure } from '../../../domain/shared/plugin-failure.ts';

/** Failure codes the skills plugin registers in its error catalog; the host maps them to exit statuses. */
export type SkillErrorCode = 'UNKNOWN_SKILL';

/** Throws the plugin failure `code` unless `condition` holds. */
export function ensureSkill(condition: unknown, code: SkillErrorCode, message: string, details?: Record<string, unknown>): asserts condition {
  if (!condition) throw new PluginFailure(code, message, details);
}
