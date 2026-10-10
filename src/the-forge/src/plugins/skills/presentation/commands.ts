import type { Command } from '../../../application/plugins/registry.ts';
import type { SkillCatalog } from '../../../application/plugins/core-plugins.ts';
import { option } from '../../../application/plugins/command-metadata.ts';
import { arity, value } from '../../../application/plugins/command-input.ts';
import type { JsonSchema } from '../../../domain/schema/json-schema.ts';
import { ensure } from '../../../domain/shared/errors.ts';
import { skillPaths, skillTargetChoices, targetRoots } from '../../../domain/skills/skill.ts';

const listOutput: JsonSchema = { type: 'object', required: ['skills'], properties: { skills: { type: 'array', items: { type: 'string' } } } };
const showOutput: JsonSchema = {
  type: 'object', required: ['id', 'content'],
  properties: { id: { type: 'string' }, content: { type: 'string', description: 'The SKILL.md text with its Agent Skills frontmatter.' } },
};

export function skillsCommand(skills: SkillCatalog): Command {
  return {
    id: 'skills',
    description: 'List, read or install bundled and plugin agent skills.',
    usage: 'skills [list | show <id> | install [--target both|claude|agents | --out directory]]',
    scope: 'workspace', discovery: false, mutating: false, defaultAction: 'list',
    actions: {
      list: { description: 'List the ids of every registered skill.', output: listOutput },
      show: { description: 'Return one skill with its SKILL.md content.', output: showOutput },
      install: {
        description: 'Write every skill to .claude/skills/<id>/SKILL.md and .agents/skills/<id>/SKILL.md in the selected project, or to one --target or an --out directory; existing files are refused.',
        scope: 'project', mutating: true, destructive: false, idempotent: true,
      },
    },
    args: [
      { name: 'action', description: 'list (default), show or install.', enum: ['list', 'show', 'install'] },
      { name: 'id', description: 'The skill id for show.' },
    ],
    options: {
      target: option.string('skills install: the skill roots, .claude/skills (claude), .agents/skills (agents) or both (the default).', { enum: skillTargetChoices }),
      out: option.string('skills install: one custom directory instead of the --target roots.'),
    },
    errors: ['UNKNOWN_SKILL', 'CONFLICT'],
    async run(args, flags, { workspace }) {
      const action = args[0] ?? 'list';
      if (action !== 'install') ensure(flags.out === undefined && flags.target === undefined, 'INVALID_ARGUMENT', '--target and --out are only valid with skills install.');
      if (action === 'list') { arity(args, 0, 1); return { skills: skills.list().map(skill => skill.id) }; }
      if (action === 'show') { arity(args, 2); const skill = skills.get(args[1]!); ensure(skill, 'UNKNOWN_SKILL', args[1]!); return skill; }
      ensure(action === 'install', 'INVALID_ARGUMENT', 'Use skills list, show, or install.'); arity(args, 1);
      const out = value(flags, 'out'), target = value(flags, 'target');
      ensure(out === undefined || target === undefined, 'INVALID_ARGUMENT', 'Use either --target or --out.');
      ensure(target === undefined || (skillTargetChoices as readonly string[]).includes(target), 'INVALID_ARGUMENT', `--target must be one of: ${skillTargetChoices.join(', ')}.`);
      const roots = out === undefined ? targetRoots(target ?? 'both') : [out];
      return workspace.write(skills.list().flatMap(skill => skillPaths(skill.id, roots).map(path => ({ path, bytes: new TextEncoder().encode(skill.content) }))));
    },
  };
}
