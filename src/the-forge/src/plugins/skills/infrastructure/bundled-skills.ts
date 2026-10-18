import workflow from '../../../../skills/forge-workflow/SKILL.md?raw';
import vault from '../../../../skills/forge-vault/SKILL.md?raw';
import development from '../../../../skills/forge-development/SKILL.md?raw';
import type { Skill } from '../../../application/plugins/registry.ts';
import { skillFolderFiles } from '../../../domain/skills/skill.ts';

// Reference files that SKILL.md links for agents to read on demand ship with their skill.
const references = import.meta.glob<string>('../../../../skills/{forge-workflow,forge-vault,forge-development}/references/*.md', { query: '?raw', import: 'default', eager: true });
const files = (id: string) => skillFolderFiles(id, Object.fromEntries(Object.entries(references).filter(([path]) => path.includes(`/${id}/`))));

/** The authored Agent Skills in the project's `skills/<id>/` folders, embedded at build time. */
export const bundledSkills: Skill[] = [
  { id: 'forge-workflow', content: workflow, files: files('forge-workflow') },
  { id: 'forge-vault', content: vault, files: files('forge-vault') },
  { id: 'forge-development', content: development, files: files('forge-development') },
];
