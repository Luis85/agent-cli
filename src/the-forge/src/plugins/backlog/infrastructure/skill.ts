import backlog from '../../../../skills/forge-backlog/SKILL.md?raw';
import type { Skill } from '../../../application/plugins/registry.ts';
import { skillFolderFiles } from '../../../domain/skills/skill.ts';

// The reference files SKILL.md links ship with the skill.
const references = import.meta.glob<string>('../../../../skills/forge-backlog/references/*.md', { query: '?raw', import: 'default', eager: true });

/** The `forge-backlog` agent skill: planning, decomposition and release work with the backlog command. */
export const backlogSkill: Skill = { id: 'forge-backlog', content: backlog, files: skillFolderFiles('forge-backlog', references) };
