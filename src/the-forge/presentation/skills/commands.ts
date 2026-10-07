import type { Command, Registry } from '../../application/plugins/registry.ts';
import { ensure } from '../../domain/shared/errors.ts';
import { arity, value } from '../cli/arguments.ts';
import { encodeText } from '../cli/input.ts';

export function skillsCommand(registry: Registry): Command {
  return {
    id: 'skills',
    description: 'List, read or install bundled and plugin agent skills.',
    usage: 'skills [list | show <id> | install] [--out .agents/skills]',
    options: { out: 'string' },
    async run(args, flags, { workspace }) {
      const action = args[0] ?? 'list';
      if (action !== 'install') ensure(flags.out === undefined, 'INVALID_ARGUMENT', '--out is only valid with skills install.');
      if (action === 'list') { arity(args, 0, 1); return { skills: [...registry.skills.keys()] }; }
      if (action === 'show') { arity(args, 2); const skill = registry.skills.get(args[1]!); ensure(skill, 'UNKNOWN_SKILL', args[1]!); return skill; }
      ensure(action === 'install', 'INVALID_ARGUMENT', 'Use skills list, show, or install.'); arity(args, 1);
      const directory = value(flags, 'out') ?? '.agents/skills';
      return workspace.write([...registry.skills.values()].map(skill => ({ path: `${directory}/${skill.id}/SKILL.md`, bytes: encodeText(skill.content) })));
    },
  };
}
