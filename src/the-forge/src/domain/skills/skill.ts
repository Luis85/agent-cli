/**
 * Agent Skills (https://agentskills.io/specification): a skill is a folder `<name>/SKILL.md` whose YAML frontmatter
 * names it and says what it does and when to use it. Forge installs every registered skill into the skill roots
 * that agents read: Claude Code's `.claude/skills` and the cross-agent `.agents/skills`.
 */
export const skillTargets = { claude: '.claude/skills', agents: '.agents/skills' } as const;
type SkillTarget = keyof typeof skillTargets;
export const skillTargetChoices = ['both', ...Object.keys(skillTargets)] as const;

/** 1–64 lowercase letters, digits and single hyphens, neither leading nor trailing. */
const skillName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isSkillName = (value: string) => value.length <= 64 && skillName.test(value);

/** The SKILL.md paths of one skill under the selected roots. */
export function skillPaths(id: string, roots: readonly string[]): string[] {
  return roots.map(root => `${root}/${id}/SKILL.md`);
}

/** The roots of `--target both|claude|agents`. */
export function targetRoots(target: string): string[] {
  return target === 'both' ? Object.values(skillTargets) : [skillTargets[target as SkillTarget]];
}

/** The YAML frontmatter of a SKILL.md: its parsed value, the YAML syntax error, or null when the file has none. */
export type SkillFrontmatter = { value: unknown } | { error: string } | null;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, maximum: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;

/** Problems of the optional fields: `license`, `compatibility` (1-500 characters), `metadata`, `allowed-tools`. */
function optionalIssues(id: string, frontmatter: Record<string, unknown>): string[] {
  const { license, compatibility, metadata } = frontmatter, tools = frontmatter['allowed-tools'];
  const issues: string[] = [];
  if (license !== undefined && typeof license !== 'string') issues.push(`Skill ${id} frontmatter license must be a string.`);
  if (compatibility !== undefined && !text(compatibility, 500)) issues.push(`Skill ${id} frontmatter compatibility must have 1-500 characters.`);
  if (metadata !== undefined && !(isRecord(metadata) && Object.values(metadata).every(value => typeof value === 'string'))) issues.push(`Skill ${id} frontmatter metadata must map names to string values.`);
  if (tools !== undefined && typeof tools !== 'string' && !(Array.isArray(tools) && tools.every(tool => typeof tool === 'string'))) issues.push(`Skill ${id} frontmatter allowed-tools must be a space-separated string or a list of tool names.`);
  return issues;
}

/**
 * Specification problems of a contributed skill (https://agentskills.io/specification): the id is a valid skill
 * name, and SKILL.md starts with YAML frontmatter whose `name` equals the id, whose `description` has 1-1024
 * characters, and whose optional `license`, `compatibility`, `metadata` and `allowed-tools` have their specified
 * types. Other fields, such as client-specific extensions, are left to the agents that read them.
 */
export function skillIssues(id: string, frontmatter: SkillFrontmatter): string[] {
  const issues: string[] = [];
  if (!isSkillName(id)) issues.push(`Skill id ${id} must be 1-64 lowercase letters, digits and single hyphens, as the folder name of an Agent Skill.`);
  if (frontmatter === null) return [...issues, `Skill ${id} must start with YAML frontmatter.`];
  if ('error' in frontmatter) return [...issues, `Skill ${id} frontmatter is not valid YAML: ${frontmatter.error}`];
  if (!isRecord(frontmatter.value)) return [...issues, `Skill ${id} frontmatter must be a YAML mapping of fields.`];
  const { name, description } = frontmatter.value;
  if (name !== id) issues.push(`Skill ${id} frontmatter name must be ${id}.`);
  if (typeof description !== 'string' || description.trim().length === 0) issues.push(`Skill ${id} frontmatter needs a description of what it does and when to use it.`);
  else if (description.length > 1024) issues.push(`Skill ${id} frontmatter description must have at most 1024 characters.`);
  return [...issues, ...optionalIssues(id, frontmatter.value)];
}
