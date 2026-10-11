/**
 * The machine-readable contract an agent reads before acting: the JSON Schema that `schema` publishes for one
 * command, localized `help`, and the bundled Agent Skills. All read-only, so the calls run concurrently.
 */
const commands = {
  schema: ['schema', 'apply'],
  help: ['help', 'backlog', '--lang', 'de'],
  skills: ['skills', 'list'],
  skill: ['skills', 'show', 'forge-backlog'],
};

/**
 * @typedef {{ annotations: Record<string, unknown>, operations: string[] }} ApplyContract
 * @typedef {{ description: string, actions: [string, string][] }} LocalizedHelp
 * @typedef {{ apply: ApplyContract, help: LocalizedHelp, skills: string[], skill: { id: string, description: string } }} Contract
 */

/**
 * @param {import('./cli.mjs').ForgeCli} cli
 * @returns {Promise<Contract>}
 */
export async function readContract(cli) {
  cli.begin('Contract and skills');
  const [schema, help, skills, skill] = await cli.runConcurrently([commands.schema, commands.help, commands.skills, commands.skill]);
  const apply = schema.data.commands.find((/** @type {any} */ command) => command.id === 'apply');
  const plan = apply.args[0].schema.properties.operations.items.oneOf;
  const { mutating, readOnlyHint, destructiveHint, idempotentHint } = apply.annotations;
  const description = /^description: (.+)$/m.exec(skill.data.content)?.[1];
  if (typeof description !== 'string') throw new Error('skills show forge-backlog returned no description');
  return {
    apply: { annotations: { mutating, readOnlyHint, destructiveHint, idempotentHint }, operations: plan.map((/** @type {any} */ entry) => String(entry.title)) },
    help: { description: help.data.description, actions: Object.entries(help.data.annotations.actions).map(([name, action]) => [name, String(/** @type {any} */ (action).description)]) },
    skills: skills.data.skills,
    skill: { id: skill.data.id, description },
  };
}

/** @param {string[]} args */
const command = args => `node bin/forge.js ${args.map(arg => /^[\w./=-]+$/.test(arg) ? arg : `'${arg}'`).join(' ')}`;

/** The README section on the published contract. @param {Contract} contract */
export function contractSection(contract) {
  return [
    '## Contract',
    '',
    'Every command publishes its arguments, options, output and error codes as JSON Schema, and its descriptions in English and German. An agent reads them instead of guessing. These excerpts were recorded during generation.',
    '',
    '### JSON Schema of `apply`',
    '',
    '```sh',
    command(commands.schema),
    '```',
    '',
    'The command\'s derived annotations, and the operations its plan argument accepts (`args[0].schema`):',
    '',
    '```json',
    JSON.stringify(contract.apply, null, 2),
    '```',
    '',
    '### Localized help',
    '',
    '```sh',
    command(commands.help),
    '```',
    '',
    `> ${contract.help.description}`,
    '',
    '| Action | Description |',
    '| --- | --- |',
    ...contract.help.actions.map(([name, description]) => `| \`${name}\` | ${description.replaceAll('|', '\\|')} |`),
    '',
    '### Agent Skills',
    '',
    '```sh',
    command(commands.skills),
    command(commands.skill),
    '```',
    '',
    `The distribution bundles ${contract.skills.length} skills: ${contract.skills.map(id => `\`${id}\``).join(', ')}. \`skills show\` returns a skill's \`SKILL.md\`; \`${contract.skill.id}\` describes itself as:`,
    '',
    `> ${contract.skill.description}`,
    '',
  ].join('\n');
}
