import workflow from '../../../../skills/forge-workflow/SKILL.md?raw';
import vault from '../../../../skills/forge-vault/SKILL.md?raw';
import development from '../../../../skills/forge-development/SKILL.md?raw';
import type { Skill } from '../../../application/plugins/registry.ts';

/** The authored Agent Skills in the project's `skills/<id>/SKILL.md` folders, embedded at build time. */
export const bundledSkills: Skill[] = [
  { id: 'forge-workflow', content: workflow },
  { id: 'forge-vault', content: vault },
  { id: 'forge-development', content: development },
];
