import type { Command } from '../../../application/plugins/registry.ts';
import type { SkillCatalog } from '../../../application/plugins/core-plugins.ts';
import { option } from '../../../application/plugins/command-metadata.ts';
import { changesOutput } from '../../../application/plugins/output-schemas.ts';
import { value } from '../../../application/plugins/command-input.ts';
import type { JsonSchema } from '../../../domain/schema/json-schema.ts';
import { ensure } from '../../../domain/shared/errors.ts';
import { skillFileNames, skillFiles, skillTargetChoices, targetRoots } from '../../../domain/skills/skill.ts';
import { ensureSkill } from '../domain/errors.ts';

const listOutput: JsonSchema = { type: 'object', required: ['skills'], properties: { skills: { type: 'array', items: { type: 'string' } } } };
const showOutput: JsonSchema = {
  type: 'object', required: ['id', 'path', 'content', 'files'],
  properties: {
    id: { type: 'string' },
    path: { type: 'string', description: 'The returned file inside the skill folder: SKILL.md or the --file path.' },
    content: { type: 'string', description: 'The file text; SKILL.md carries the Agent Skills frontmatter.' },
    files: { type: 'array', items: { type: 'string' }, description: 'Every file of the skill folder, SKILL.md first, such as references/editing.md.' },
  },
};

export function skillsCommand(skills: SkillCatalog): Command {
  return {
    id: 'skills',
    description: 'List, read or install bundled and plugin agent skills.',
    usage: 'skills [list | show <id> | install [--target both|claude|agents | --out directory]]',
    scope: 'workspace', discovery: false, mutating: false, defaultAction: 'list', unknownAction: 'INVALID_ARGUMENT',
    actions: {
      list: { description: 'List the ids of every registered skill.', usage: 'skills [list]', args: [], output: listOutput },
      show: {
        description: 'Return one skill with its SKILL.md content and the list of its files, or with --file one of its reference files.',
        usage: 'skills show <id> [--file references/name.md]', output: showOutput, args: [{ name: 'id', description: 'The skill id.', required: true }],
        options: { file: option.string('skills show: a file of the skill folder from files, such as references/editing.md; SKILL.md by default.') },
      },
      install: {
        description: 'Write every skill folder (SKILL.md and its reference files) to .claude/skills/<id>/ and .agents/skills/<id>/ in the selected project, or to one --target or an --out directory; existing files are refused.',
        usage: 'skills install [--target both|claude|agents | --out directory]', args: [], scope: 'project', mutating: true, destructive: false, idempotent: true, output: changesOutput(),
        options: {
          target: option.string('skills install: the skill roots, .claude/skills (claude), .agents/skills (agents) or both (the default).', { enum: skillTargetChoices }),
          out: option.string('skills install: one custom directory instead of the --target roots.'),
        },
      },
    },
    errors: ['UNKNOWN_SKILL', 'CONFLICT'],
    async run(args, flags, { workspace }) {
      const action = args[0] ?? 'list';
      if (action === 'list') return { skills: skills.list().map(skill => skill.id) };
      if (action === 'show') {
        const skill = skills.get(args[1]!); ensureSkill(skill, 'UNKNOWN_SKILL', args[1]!);
        const files = skillFileNames(skill), path = value(flags, 'file') ?? 'SKILL.md';
        ensure(files.includes(path), 'INVALID_OPTION_VALUE', `--file must be one of: ${files.join(', ')}.`, { option: 'file', value: path, allowed: files });
        return { id: skill.id, path, content: path === 'SKILL.md' ? skill.content : skill.files![path]!, files };
      }
      ensure(action === 'install', 'INVALID_ARGUMENT', 'Use skills list, show, or install.'); 
      const out = value(flags, 'out'), target = value(flags, 'target');
      ensure(out === undefined || target === undefined, 'INVALID_ARGUMENT', 'Use either --target or --out.');
      const roots = out === undefined ? targetRoots(target ?? 'both') : [out];
      return workspace.write(skills.list().flatMap(skill => skillFiles(skill, roots).map(file => ({ path: file.path, bytes: new TextEncoder().encode(file.content) }))));
    },
  };
}
