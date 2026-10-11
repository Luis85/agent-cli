import { diagnostic, isObject, pointer, record, stringList, type AgentConfigDocument, type AgentDiagnostic } from './config.ts';
import { claudeName } from './claude-vocabulary.ts';
import { bangToolCalls, commandArguments } from './templating.ts';

/** A Claude skill generated from one docker-agent slash command. */
export interface CommandSkill { name: string; agent: string; command: string; metadata: Record<string, unknown>; body: string }

/** An agent's commands: inline first (they win), then each `use_commands` group, like docker-agent. */
function commandEntries(config: AgentConfigDocument, name: string, agent: Record<string, unknown>): Array<[string, unknown, string]> {
  const entries = new Map<string, [unknown, string]>();
  const add = (commands: unknown, at: string) => {
    const maps = Array.isArray(commands) ? commands.map((item, index) => [record(item), `${at}/${index}`] as const) : [[record(commands), at] as const];
    for (const [map, where] of maps) for (const [command, value] of Object.entries(map)) if (!entries.has(command)) entries.set(command, [value, `${where}${pointer(command)}`]);
  };
  add(agent.commands, pointer('agents', name, 'commands'));
  for (const group of stringList(agent.use_commands)) add(record(config.commands)[group], pointer('commands', group));
  return [...entries].map(([command, [value, at]]) => [command, value, at]);
}

/**
 * Generates a Claude skill per docker-agent command: `instruction` becomes the skill body with `${args[i]}` → `$i`
 * and `${args}` → `$ARGUMENTS`; `agent` becomes `context: fork` with that agent; URL commands are not emitted.
 * Skills set `disable-model-invocation: true`, since docker-agent commands run only when the user types them.
 */
export function commandSkills(config: AgentConfigDocument, name: string, agent: Record<string, unknown>, agentNames: ReadonlyMap<string, string>): { skills: CommandSkill[]; diagnostics: AgentDiagnostic[] } {
  const skills: CommandSkill[] = [], diagnostics: AgentDiagnostic[] = [];
  for (const [command, value, at] of commandEntries(config, name, agent)) {
    const definition = isObject(value) ? value : { instruction: value };
    if (typeof definition.url === 'string') {
      diagnostics.push(diagnostic('warning', 'command-unsupported', at, `The /${command} command opens a URL, which a Claude skill cannot do; it is not emitted.`, 'U'));
      continue;
    }
    const target = typeof definition.agent === 'string' ? definition.agent : undefined;
    const instruction = typeof definition.instruction === 'string' ? definition.instruction : '';
    const converted = commandArguments(instruction);
    for (const kept of converted.kept) diagnostics.push(diagnostic('warning', 'template-literal', `${at}${isObject(value) ? '/instruction' : ''}`, `The template expression ${kept} is kept literally; Claude skills do not evaluate docker-agent expressions.`, 'U'));
    for (const call of bangToolCalls(instruction)) diagnostics.push(diagnostic('warning', 'template-literal', `${at}${isObject(value) ? '/instruction' : ''}`, `The bang tool call ${call} is kept literally.`, 'U'));
    const body = converted.text.trim() === '' ? '$ARGUMENTS' : converted.text;
    const description = typeof definition.description === 'string' && definition.description.trim() !== '' ? definition.description : `Run the /${command} command of the ${name} agent.`;
    if (description !== definition.description) diagnostics.push(diagnostic('warning', 'description-synthesized', at, `The /${command} command has no description; "${description}" is emitted.`, 'A'));
    const metadata: Record<string, unknown> = { name: claudeName(command), description, 'disable-model-invocation': true };
    if (target !== undefined) {
      metadata.context = 'fork';
      metadata.agent = agentNames.get(target) ?? claudeName(target);
      diagnostics.push(diagnostic('warning', 'command-approximated', `${at}/agent`, `docker-agent switches the conversation to ${target}; the Claude skill runs in a forked ${metadata.agent as string} subagent instead.`, 'A'));
    }
    skills.push({ name: claudeName(command), agent: name, command, metadata, body: body.endsWith('\n') ? body : `${body}\n` });
  }
  return { skills, diagnostics };
}
