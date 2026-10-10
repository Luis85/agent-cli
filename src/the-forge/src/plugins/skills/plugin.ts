import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import { bundledSkills } from './infrastructure/bundled-skills.ts';
import { skillsCommand } from './presentation/commands.ts';

/**
 * The `skills` core plugin: the bundled agent skills and the `skills` command that lists, shows and installs every
 * registered skill. Disabling it removes both; `setup` then installs only skills that other plugins contribute.
 */
export const skillsPlugin: CorePlugin = {
  manifest: {
    id: 'skills', name: 'Agent skills', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
    description: 'Bundled agent skills and the skills command to list, read and install them.',
  },
  create: host => ({
    skills: bundledSkills,
    commands: [skillsCommand(host.skills)],
    strings: { de: { commands: { skills: 'Mitgelieferte und von Plugins bereitgestellte Agent-Skills auflisten, lesen oder installieren.' } } },
  }),
};
