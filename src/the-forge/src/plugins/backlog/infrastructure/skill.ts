import backlog from '../../../../skills/forge-backlog/SKILL.md?raw';
import type { Skill } from '../../../application/plugins/registry.ts';

/** The `forge-backlog` agent skill: planning, decomposition and release work with the backlog command. */
export const backlogSkill: Skill = { id: 'forge-backlog', content: backlog };
