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
/**
 * Specification problems of a contributed skill: the id is a valid skill name, and SKILL.md starts with
 * frontmatter whose `name` equals the id and whose `description` is present. Complete YAML validation of the
 * bundled skills, including description length and `metadata` values, runs in the test suite.
 */
export declare function skillIssues(id: string, content: string): string[];
