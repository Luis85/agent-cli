import workflow from '../../../bin/skills/forge-workflow.md?raw';
import vault from '../../../bin/skills/forge-vault.md?raw';
import development from '../../../bin/skills/forge-development.md?raw';
import type { Skill } from '../../application/plugins/registry.ts';
export const builtinSkills: Skill[] = [
  { id: 'forge-workflow', content: workflow },
  { id: 'forge-vault', content: vault },
  { id: 'forge-development', content: development },
];
