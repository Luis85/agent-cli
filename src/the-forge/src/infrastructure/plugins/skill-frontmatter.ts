import { parse } from 'yaml';
import type { SkillFrontmatter } from '../../domain/skills/skill.ts';

/**
 * The leading YAML frontmatter of a SKILL.md, read with a complete YAML parser so comments, quoting and block
 * scalars mean what they mean in YAML: the parsed value, the syntax error, or null when the file has none.
 */
export function skillFrontmatter(content: string): SkillFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  if (!match) return null;
  try { return { value: parse(match[1]!) as unknown }; }
  catch (error) { return { error: error instanceof Error ? error.message.split('\n')[0]! : String(error) }; }
}
