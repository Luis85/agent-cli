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

function unquoted(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted ? quoted[2]! : value;
}

/** Top-level scalar keys of the leading YAML frontmatter; block scalars (`|`, `>`) read as their indicator. */
function frontmatterKeys(content: string): Map<string, string> | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return undefined;
  const keys = new Map<string, string>();
  for (const line of match[1]!.split(/\r?\n/)) {
    const entry = /^([A-Za-z][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (entry) keys.set(entry[1]!, unquoted((entry[2] ?? '').trim()));
  }
  return keys;
}

/**
 * Specification problems of a contributed skill: the id is a valid skill name, and SKILL.md starts with
 * frontmatter whose `name` equals the id and whose `description` is present. Complete YAML validation of the
 * bundled skills, including description length and `metadata` values, runs in the test suite.
 */
export function skillIssues(id: string, content: string): string[] {
  const issues: string[] = [];
  if (!isSkillName(id)) issues.push(`Skill id ${id} must be 1-64 lowercase letters, digits and single hyphens, as the folder name of an Agent Skill.`);
  const keys = frontmatterKeys(content);
  if (!keys) return [...issues, `Skill ${id} must start with YAML frontmatter.`];
  if (keys.get('name') !== id) issues.push(`Skill ${id} frontmatter name must be ${id}.`);
  if (!keys.get('description')) issues.push(`Skill ${id} frontmatter needs a description of what it does and when to use it.`);
  return issues;
}
