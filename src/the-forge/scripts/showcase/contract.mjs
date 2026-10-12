/**
 * The machine-readable contract an agent reads before acting: the JSON Schema that `schema` publishes for one
 * command, localized `help`, and the bundled Agent Skills. All read-only, so the calls run concurrently.
 */
const commands = {
  schema: ['schema', 'apply'],
  help: ['help', 'backlog', '--lang', 'de'],
  skills: ['skills', 'list'],
  skill: ['skills', 'show', 'forge-backlog'],
  serverStatus: ['server', 'status'],
  serverHelp: ['help', 'server'],
};

/**
 * @typedef {{ annotations: Record<string, unknown>, operations: string[] }} ApplyContract
 * @typedef {{ description: string, actions: [string, string][] }} LocalizedHelp
 * @typedef {{ running: boolean, stale: boolean, server: null, url: null, webviews: unknown[] }} InactiveServer
 * @typedef {{ apply: ApplyContract, help: LocalizedHelp, skills: string[], skill: { id: string, description: string }, server: { status: InactiveServer, description: string, actions: string[] } }} Contract
 */

/**
 * @param {import('./cli.mjs').ForgeCli} cli
 * @returns {Promise<Contract>}
 */
export async function readContract(cli) {
  cli.begin('Contract and skills');
  const [schema, help, skills, skill, serverStatus, serverHelp] = await cli.runConcurrently([commands.schema, commands.help, commands.skills, commands.skill, commands.serverStatus, commands.serverHelp]);
  if (serverStatus.data.running || serverStatus.data.stale) throw new Error('The showcase temporary workspace must not have a running or stale server.');
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
    server: { status: serverStatus.data, description: serverHelp.data.description, actions: Object.keys(serverHelp.data.annotations.actions) },
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
    '### Localhost admin inspection',
    '',
    'The core server is independent of the Vue/Nuxt UI admin view. Generation records only read-only discovery and never starts a background process:',
    '',
    '```sh',
    command(commands.serverStatus),
    command(commands.serverHelp),
    '```',
    '',
    '```json',
    JSON.stringify(contract.server.status, null, 2),
    '```',
    '',
    `> ${contract.server.description}`,
    '',
    `Available actions: ${contract.server.actions.map(action => '`' + action + '`').join(', ')}.`,
    '',
    'To inspect the containing workspace yourself, run `node bin/forge.js server start --webview admin --json` from its root and open `data.url`. The read-only view reports context, projects, plugins, counts and runtime health. End the session with `node bin/forge.js server stop`. The server uses localhost and preserves project selection; the launch link includes a local session token.',
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
