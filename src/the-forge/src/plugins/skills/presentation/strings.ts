import type { PluginStrings } from '../../../application/plugins/plugin-catalog.ts';

/** The skills plugin's German manifest and option and argument descriptions, available while it is disabled. */
export const skillsStrings: PluginStrings = {
  de: {
    manifest: { name: 'Agent-Skills', description: 'Mitgelieferte Agent-Skills und der Befehl skills, um sie aufzulisten, zu lesen und zu installieren.' },
    descriptions: {
      'skills install: the skill roots, .claude/skills (claude), .agents/skills (agents) or both (the default).': 'skills install: die Skill-Stammordner .claude/skills (claude), .agents/skills (agents) oder beide (Standard).',
      'skills install: one custom directory instead of the --target roots.': 'skills install: ein eigenes Verzeichnis statt der --target-Stammordner.',
      'skills show: a file of the skill folder from files, such as references/editing.md; SKILL.md by default.': 'skills show: eine Datei des Skill-Ordners aus files, etwa references/editing.md; standardmäßig SKILL.md.',
      'list (default), show or install.': 'list (Standard), show oder install.',
      'The skill id for show.': 'Die Skill-ID für show.',
    },
  },
};
