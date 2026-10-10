import { type SkillFrontmatter } from '../../domain/skills/skill.ts';
/** Reads the YAML frontmatter of a SKILL.md; composition injects a complete YAML parser. */
export type SkillFrontmatterReader = (content: string) => SkillFrontmatter;
export type PluginOrigin = 'core' | 'user';
/**
 * Validates every contribution of one plugin before anything is registered. User plugins prefix command,
 * generator, event and service ids with `<id>.`, skill ids with `<id>-` and error codes with `<ID>_`; every skill
 * is an Agent Skill whose frontmatter name equals its id. Bundled core plugins may
 * own bare command, generator, skill and service ids, while their events stay in their own `<id>.*` namespace.
 */
export declare function validateContributions(plugin: Record<string, unknown>, pluginId: string, origin: PluginOrigin, frontmatter: SkillFrontmatterReader): void;
