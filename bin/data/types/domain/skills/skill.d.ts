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
/**
 * A skill's text: its SKILL.md `content` and optional further `files` keyed by their path inside the skill folder,
 * such as `references/editing.md`, which SKILL.md links for agents to read on demand.
 */
export interface SkillText {
    id: string;
    content: string;
    files?: Readonly<Record<string, string>>;
}
/** The file paths inside one skill folder: SKILL.md first, then its further files in path order. */
export declare function skillFileNames(skill: SkillText): string[];
/** Every file of one skill under each selected root, SKILL.md first. */
export declare function skillFiles(skill: SkillText, roots: readonly string[]): Array<{
    path: string;
    content: string;
}>;
/**
 * Bundled skill files from a build-time glob such as `skills/<id>/references/*.md`, keyed by their path inside the
 * skill folder.
 */
export declare function skillFolderFiles(id: string, modules: Readonly<Record<string, string>>): Record<string, string>;
/** Problems of a skill's further `files`: a map of relative paths other than SKILL.md to text. */
export declare function skillFileIssues(id: string, files: unknown): string[];
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
