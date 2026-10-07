import workflow from '../../skills/forge-workflow.md?raw';
import vault from '../../skills/forge-vault.md?raw';
import development from '../../skills/forge-development.md?raw';
import type { Skill } from '../application/plugins.ts';
export const builtinSkills: Skill[] = [
  { id: 'forge-workflow', content: workflow },
  { id: 'forge-vault', content: vault },
  { id: 'forge-development', content: development },
];
