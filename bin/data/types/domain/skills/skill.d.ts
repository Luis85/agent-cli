/**
 * Agent Skills (https://agentskills.io/specification): a skill is a folder `<name>/SKILL.md` whose YAML frontmatter
 * names it and says what it does and when to use it. Forge installs every registered skill into the skill roots
 * that agents read: Claude Code's `.claude/skills` and the cross-agent `.agents/skills`.
 */
export declare const skillTargets: {
    readonly claude: ".claude/skills";
    readonly agents: ".agents/skills";
};
export declare const skillTargetChoices: readonly ["both", ...string[]];
/** The SKILL.md paths of one skill under the selected roots. */
export declare function skillPaths(id: string, roots: readonly string[]): string[];
/** The roots of `--target both|claude|agents`. */
export declare function targetRoots(target: string): string[];
/** The YAML frontmatter of a SKILL.md: its parsed value, the YAML syntax error, or null when the file has none. */
export type SkillFrontmatter = {
    value: unknown;
} | {
    error: string;
} | null;
/**
 * Specification problems of a contributed skill (https://agentskills.io/specification): the id is a valid skill
 * name, and SKILL.md starts with YAML frontmatter whose `name` equals the id, whose `description` has 1-1024
 * characters, and whose optional `license`, `compatibility`, `metadata` and `allowed-tools` have their specified
 * types. Other fields, such as client-specific extensions, are left to the agents that read them.
 */
export declare function skillIssues(id: string, frontmatter: SkillFrontmatter): string[];
