import { canonicalPath, isDeviceName, portablePathIssues } from '../documents/file.ts';

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
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * A skill's text: its SKILL.md `content` and optional further `files` keyed by their path inside the skill folder,
 * such as `references/editing.md`, which SKILL.md links for agents to read on demand.
 */
export interface SkillText { id: string; content: string; files?: Readonly<Record<string, string>> }

/** The file paths inside one skill folder: SKILL.md first, then its further files in path order. */
export function skillFileNames(skill: SkillText): string[] {
  return ['SKILL.md', ...Object.keys(skill.files ?? {}).sort()];
}

/** Every file of one skill under each selected root, SKILL.md first. */
export function skillFiles(skill: SkillText, roots: readonly string[]): Array<{ path: string; content: string }> {
  const texts: Readonly<Record<string, string>> = { ...skill.files, 'SKILL.md': skill.content };
  return roots.flatMap(root => skillFileNames(skill).map(name => ({ path: `${root}/${skill.id}/${name}`, content: texts[name]! })));
}

/**
 * Bundled skill files from a build-time glob such as `skills/<id>/references/*.md`, keyed by their path inside the
 * skill folder.
 */
export function skillFolderFiles(id: string, modules: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(modules).map(([path, content]) => [path.slice(path.lastIndexOf(`/${id}/`) + id.length + 2), content]));
}

/** A relative POSIX path of names that start with a letter or digit, so it never escapes or hides in the folder. */
const skillFileName = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** Problems of a skill's further `files`: a map of relative paths other than SKILL.md to text. */
export function skillFileIssues(id: string, files: unknown): string[] {
  if (files === undefined) return [];
  if (!isRecord(files)) return [`Skill ${id} files must map paths inside the skill folder to text.`];
  return Object.entries(files).flatMap(([path, content]) => [
    ...(skillFileName.test(path) && path.length <= 255 && path.toUpperCase() !== 'SKILL.MD' ? [] : [`Skill ${id} file ${path} must be a relative path inside the skill folder other than SKILL.md.`]),
    ...(typeof content === 'string' ? [] : [`Skill ${id} file ${path} must be text.`]),
  ]);
}

/**
 * A skill path that no install can write on some filesystem: a skill id or file path segment that is a Windows
 * device name, or a file path that names the same file as `duplicateOf` (`case-duplicate`) or its folder
 * (`folder-conflict`) where letter case and trailing dots are ignored.
 */
export interface SkillPathIssue {
  message: string;
  details: { skill: string; reason: 'device-name' | 'case-duplicate' | 'folder-conflict'; file?: string; segment?: string; duplicateOf?: string };
}

/**
 * Problems of the paths a valid skill installs (see `SkillPathIssue`), so a plugin fails at registration instead of
 * every later `setup` and `skills install`. `files` holds valid relative paths (see `skillFileIssues`).
 */
export function skillPathIssues(id: string, files: Readonly<Record<string, unknown>> = {}): SkillPathIssue[] {
  if (isDeviceName(id)) return [{ message: `Skill id ${id} is a Windows reserved device name, which no skill folder can have on Windows; choose another id.`, details: { skill: id, reason: 'device-name', segment: id } }];
  const paths = ['SKILL.md', ...Object.keys(files).sort()], found = portablePathIssues(paths);
  const issues: SkillPathIssue[] = found.map(issue => issue.reason === 'device-name'
    ? { message: `Skill ${id} file ${issue.path} uses the Windows reserved device name ${issue.segment}, which no Windows system can install; rename it.`, details: { skill: id, reason: 'device-name', file: issue.path, segment: issue.segment } }
    : { message: `Skill ${id} file ${issue.path} names the same file as ${issue.duplicateOf} where letter case and trailing dots are ignored, as on Windows and macOS; rename one of them.`, details: { skill: id, reason: 'case-duplicate', file: issue.path, duplicateOf: issue.duplicateOf } });
  const rejected = new Set(found.map(issue => issue.path));
  const installed = new Map(paths.filter(path => !rejected.has(path)).map(path => [canonicalPath(path), path]));
  for (const [folder, file] of installed) {
    const inside = [...installed].find(([path]) => path.startsWith(`${folder}/`))?.[1];
    if (inside !== undefined) issues.push({ message: `Skill ${id} file ${file} is also the folder of ${inside}; a path cannot be both a file and a folder.`, details: { skill: id, reason: 'folder-conflict', file, duplicateOf: inside } });
  }
  return issues;
}

/** The roots of `--target both|claude|agents`. */
export function targetRoots(target: string): string[] {
  return target === 'both' ? Object.values(skillTargets) : [skillTargets[target as SkillTarget]];
}

/** The YAML frontmatter of a SKILL.md: its parsed value, the YAML syntax error, or null when the file has none. */
export type SkillFrontmatter = { value: unknown } | { error: string } | null;

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
