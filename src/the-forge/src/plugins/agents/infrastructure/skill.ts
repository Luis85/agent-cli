import content from '../../../../skills/forge-agents.md?raw';
import type { Skill } from '../../../application/plugins/registry.ts';

/** The agents plugin's agent skill, authored in the project's `skills/` folder and embedded at build time. */
export const agentsSkill: Skill = { id: 'forge-agents', content };
