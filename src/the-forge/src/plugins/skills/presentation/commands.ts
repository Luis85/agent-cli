import type { Command } from '../../../application/plugins/registry.ts';
import type { SkillCatalog } from '../../../application/plugins/core-plugins.ts';
import { option } from '../../../application/plugins/command-metadata.ts';
import { arity, value } from '../../../application/plugins/command-input.ts';
import { ensure } from '../../../domain/shared/errors.ts';

export function skillsCommand(skills: SkillCatalog): Command {
  return {
    id: 'skills',
    description: 'List, read or install bundled and plugin agent skills.',
    usage: 'skills [list | show <id> | install] [--out .agents/skills]',
    scope: 'workspace', discovery: false, mutating: false, defaultAction: 'list',
    actions: {
      list: { description: 'List the ids of every registered skill.' },
      show: { description: 'Return one skill with its Markdown content.' },
      install: { description: 'Write every skill to <out>/<id>/SKILL.md in the selected project; existing files are refused.', scope: 'project', mutating: true },
    },
    args: [
      { name: 'action', description: 'list (default), show or install.', enum: ['list', 'show', 'install'] },
      { name: 'id', description: 'The skill id for show.' },
    ],
    options: { out: option.string('Installation directory for skills install.', { default: '.agents/skills' }) },
    errors: ['UNKNOWN_SKILL', 'CONFLICT'],
    async run(args, flags, { workspace }) {
      const action = args[0] ?? 'list';
      if (action !== 'install') ensure(flags.out === undefined, 'INVALID_ARGUMENT', '--out is only valid with skills install.');
      if (action === 'list') { arity(args, 0, 1); return { skills: skills.list().map(skill => skill.id) }; }
      if (action === 'show') { arity(args, 2); const skill = skills.get(args[1]!); ensure(skill, 'UNKNOWN_SKILL', args[1]!); return skill; }
      ensure(action === 'install', 'INVALID_ARGUMENT', 'Use skills list, show, or install.'); arity(args, 1);
      const directory = value(flags, 'out') ?? '.agents/skills';
      return workspace.write(skills.list().map(skill => ({ path: `${directory}/${skill.id}/SKILL.md`, bytes: new TextEncoder().encode(skill.content) })));
    },
  };
}
