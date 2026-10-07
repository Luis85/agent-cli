import workflow from '../../skills/agent-cli-workflow.md?raw';
import vault from '../../skills/agent-cli-vault.md?raw';
import development from '../../skills/agent-cli-development.md?raw';
import type { Skill } from '../application/plugins.ts';
export const builtinSkills: Skill[] = [
  { id: 'agent-cli-workflow', content: workflow },
  { id: 'agent-cli-vault', content: vault },
  { id: 'agent-cli-development', content: development },
];
