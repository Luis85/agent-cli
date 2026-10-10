import type { Command, CommandContext } from '../../../application/plugins/registry.ts';
import { option, type CommandFlags } from '../../../application/plugins/command-metadata.ts';
import { arity, value } from '../../../application/plugins/command-input.ts';
import { generationControls, reviewOptions } from '../../../application/generation/controls.ts';
import { ensure } from '../../../domain/shared/errors.ts';
import { simpleToolsets, type AgentAuthoring, type CreateRequest } from '../application/authoring.ts';
import type { AgentDefinitions } from '../application/definitions.ts';
import type { AgentGeneration, GenerateRequest } from '../application/generation.ts';

/** The agents use cases of one command context, over its scope's definitions directory. */
export interface AgentServices {
  list(): ReturnType<AgentDefinitions['list']>;
  inspect(target: string): ReturnType<AgentDefinitions['inspect']>;
  validate(file?: string): ReturnType<AgentDefinitions['validate']>;
  create(request: CreateRequest): ReturnType<AgentAuthoring['create']>;
  importClaude(source: string, options: { file?: string; ifMatch?: string }): ReturnType<AgentAuthoring['importClaude']>;
  generate(request: GenerateRequest): ReturnType<AgentGeneration['run']>;
}

const actions = ['list', 'inspect', 'validate', 'create', 'import', 'generate'] as const;
type Action = typeof actions[number];
const options = {
  file: option.string('create and import: the team file to add to (a name in the definitions directory or a scope path); generate: only this file. Defaults to <name>.yaml for create and import.'),
  model: option.string('create: the model reference, such as anthropic/claude-sonnet-5 or a named model; defaults to plugins.settings.agents.defaultModel.'),
  description: option.string('create: the agent description.'),
  instruction: option.string('create: the agent instruction (system prompt); defaults to the description.'),
  toolset: option.string(`create: comma-separated toolset types without required settings (${simpleToolsets.join(', ')}).`),
  'if-match': option.string('create and import: the current revision of an existing team file, required to add an agent to it.'),
  from: option.string('import: the agent format to convert from.', { enum: ['claude'] }),
  target: option.string('generate: the agent format to generate.', { enum: ['claude'] }),
  agent: option.string('generate: only this docker-agent agent.'),
  mcp: option.string('generate: inline MCP servers in agent frontmatter, or merge them into the project .mcp.json.', { enum: ['inline', 'project'], default: 'inline' }),
  settings: option.boolean('generate: merge permission rules and the main agent into .claude/settings.json.'),
  commands: option.boolean('generate: generate commands as .claude/skills/<name>/SKILL.md.'),
  'model-style': option.string('generate: emit Anthropic model ids, or Claude aliases (opus, sonnet, haiku, fable).', { enum: ['id', 'alias'], default: 'id' }),
  ...Object.fromEntries(Object.entries(reviewOptions).map(([key, schema]) => [key, { ...schema, description: `generate: ${schema.description}` }])),
};
const accepted: Record<Action, readonly string[]> = {
  list: [], inspect: [], validate: [],
  create: ['file', 'model', 'description', 'instruction', 'toolset', 'if-match'],
  import: ['from', 'file', 'if-match'],
  generate: ['target', 'file', 'agent', 'mcp', 'settings', 'commands', 'model-style', ...Object.keys(reviewOptions)],
};

function choice<T extends string>(flags: CommandFlags, key: string, allowed: readonly T[], fallback: T): T {
  const selected = value(flags, key) ?? fallback;
  ensure((allowed as readonly string[]).includes(selected), 'INVALID_ARGUMENT', `--${key} must be one of: ${allowed.join(', ')}.`);
  return selected as T;
}

function toolsets(flags: CommandFlags): string[] | undefined {
  const list = value(flags, 'toolset')?.split(',').map(type => type.trim()).filter(type => type !== '');
  for (const type of list ?? []) ensure((simpleToolsets as readonly string[]).includes(type), 'INVALID_ARGUMENT', `--toolset accepts ${simpleToolsets.join(', ')}; add ${type} toolsets by editing the file, since they need further settings.`);
  return list;
}

export function agentsCommand(services: (context: CommandContext) => AgentServices): Command {
  return {
    id: 'agents',
    description: 'Manage docker-agent definitions (list, inspect, validate, create, import) and generate Claude Code agents from them.',
    usage: 'agents [list] | inspect <file[#agent]> | validate [file] | create <name> [--file team.yaml] [--model ref] [--description text] [--instruction text] [--toolset filesystem,shell] [--if-match sha256] | import <agent|path.md> --from claude [--file team.yaml] [--if-match sha256] | generate --target claude [--file team.yaml] [--agent name] [--mcp inline|project] [--settings] [--commands] [--model-style id|alias] [--plan | --plan-out path.json | --check | --revisions-from path.json]',
    scope: 'project', discovery: false, mutating: false, defaultAction: 'list',
    actions: {
      list: { description: 'List definition files with their agents, default agent and diagnostic counts.' },
      inspect: { description: 'Return one definition file, or one agent with file#agent, with diagnostics.' },
      validate: { description: 'Validate one or every definition file against the docker-agent schema and semantic rules; errors fail with INVALID_AGENT_DEFINITION.' },
      create: { description: 'Add a docker-agent agent to a new or existing team file, preserving comments.', mutating: true },
      import: { description: 'Convert a Claude agent (.claude/agents/<name>.md) into a docker-agent agent, with diagnostics for approximations.', mutating: true },
      generate: { description: 'Generate .claude/agents/<name>.md (and opt-in .mcp.json, settings and skills) from the definitions; --plan and --check never write.', mutating: true },
    },
    args: [
      { name: 'action', description: 'list (default), inspect, validate, create, import or generate.', enum: actions },
      { name: 'target', description: 'inspect: file[#agent]; validate: file; create: the agent name; import: a Claude agent name or Markdown path.' },
    ],
    options,
    errors: ['INVALID_AGENT_DEFINITION', 'AGENT_NOT_FOUND', 'AGENT_EXISTS', 'AGENT_DRIFT', 'NOT_FOUND', 'CONFLICT', 'INVALID_NAME', 'INVALID_YAML', 'INVALID_CLAUDE_AGENT', 'INVALID_CLAUDE_SETTINGS', 'INVALID_GENERATION_PLAN', 'INVALID_GENERATION_REVISIONS'],
    async run(args, flags, context) {
      const action = (args[0] ?? 'list') as Action;
      ensure((actions as readonly string[]).includes(action), 'INVALID_ARGUMENT', `Use agents ${actions.join(', agents ')}.`);
      for (const key of Object.keys(options)) ensure(flags[key] === undefined || accepted[action].includes(key), 'INVALID_ARGUMENT', `--${key} is not supported by agents ${action}.`);
      const agents = services(context);
      if (action === 'list') { arity(args, 0, 1); return agents.list(); }
      if (action === 'inspect') { arity(args, 2); return agents.inspect(args[1]!); }
      if (action === 'validate') { arity(args, 1, 2); return agents.validate(args[1]); }
      if (action === 'create') {
        arity(args, 2);
        const [file, model, description, instruction, ifMatch, types] = [value(flags, 'file'), value(flags, 'model'), value(flags, 'description'), value(flags, 'instruction'), value(flags, 'if-match'), toolsets(flags)];
        return agents.create({ name: args[1]!, ...(file ? { file } : {}), ...(model ? { model } : {}), ...(description ? { description } : {}), ...(instruction ? { instruction } : {}), ...(types ? { toolsets: types } : {}), ...(ifMatch ? { ifMatch } : {}) });
      }
      if (action === 'import') {
        arity(args, 2);
        ensure(value(flags, 'from', true) === 'claude', 'INVALID_ARGUMENT', '--from must be claude.');
        const file = value(flags, 'file'), ifMatch = value(flags, 'if-match');
        return agents.importClaude(args[1]!, { ...(file ? { file } : {}), ...(ifMatch ? { ifMatch } : {}) });
      }
      arity(args, 1);
      ensure(value(flags, 'target', true) === 'claude', 'INVALID_ARGUMENT', '--target must be claude.');
      const controls = await generationControls(flags, context.workspace.files);
      const file = value(flags, 'file'), agent = value(flags, 'agent');
      return agents.generate({
        ...(file ? { file } : {}), ...(agent ? { agent } : {}),
        mcp: choice(flags, 'mcp', ['inline', 'project'], 'inline'), settings: flags.settings === true, commands: flags.commands === true,
        modelStyle: choice(flags, 'model-style', ['id', 'alias'], 'id'),
        mode: controls.mode, ...(controls.manifestPath ? { manifestPath: controls.manifestPath } : {}), ...(controls.revisions ? { revisions: controls.revisions } : {}),
      });
    },
  };
}
