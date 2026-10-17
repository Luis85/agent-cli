import type { PluginErrorDefinition } from '../../../application/plugins/plugin-catalog.ts';

/** The failure codes the skills plugin registers; their categories fix the exit statuses. */
export const skillErrors: PluginErrorDefinition[] = [
  { code: 'UNKNOWN_SKILL', category: 'input', summary: 'The skill is not registered.', hint: 'Run skills list.' },
];

/** German summaries and next steps of the skills plugin's failure codes. */
export const germanSkillErrors: Record<string, { summary: string; hint: string }> = {
  UNKNOWN_SKILL: { summary: 'Der Skill ist nicht registriert.', hint: 'Verfügbare Skills zeigt skills list.' },
};
