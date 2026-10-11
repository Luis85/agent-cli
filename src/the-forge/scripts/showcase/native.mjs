/**
 * Native Claude Code configuration beside the generated agents: a project hook, a small authored plugin checked
 * structurally, and a preview of importing the native reviewer agent into docker-agent YAML. Everything is a local
 * file operation; nothing starts Claude Code or runs a hook.
 */
export const native = {
  hooks: { PostToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'npm', args: ['run', 'check:structure'], timeout: 60 }] }] },
  plugin: 'claude-plugins/trailhead-tools',
  manifest: { name: 'trailhead-tools', version: '0.1.0', description: 'Trailhead traceability commands for Claude Code.' },
  command: { path: 'commands/trace.md', content: '---\ndescription: Trace a Trailhead requirement from the PRD to its tests\n---\nTrace $ARGUMENTS from docs/product/Trailhead PRD.md through use cases, design, build spec and the verification plan.\n' },
  reviewer: { agent: 'trailhead-reviewer', file: 'trailhead-reviewer.yaml' },
};

/**
 * @typedef {{ severity: string, code: string, message: string }} Diagnostic
 * @typedef {{ hooks: { valid: boolean, events: string[] }, plugin: { valid: boolean, files: string[], diagnostics: Diagnostic[] }, imported: { path: string, diagnostics: Diagnostic[] } }} NativeSummary
 */

/**
 * @param {import('./cli.mjs').ForgeCli} cli
 * @returns {Promise<NativeSummary>}
 */
export async function buildNative(cli) {
  cli.begin('Native Claude configuration');
  cli.run(['claude', 'hooks', 'set', '--stdin'], { input: `${JSON.stringify(native.hooks, null, 2)}\n` });
  cli.run(['claude', 'plugins', 'create', native.plugin, '--stdin'], { input: `${JSON.stringify(native.manifest, null, 2)}\n` });
  cli.run(['claude', 'plugins', 'write-asset', native.plugin, native.command.path, '--stdin'], { input: native.command.content });
  // Checks and the import preview read only, so they run concurrently.
  const [hooks, plugin, imported] = await cli.runConcurrently([
    ['claude', 'hooks', 'check'],
    ['claude', 'plugins', 'check', native.plugin],
    ['agents', 'import', native.reviewer.agent, '--from', 'claude', '--file', native.reviewer.file, '--dry-run'],
  ]);
  if (hooks.data.valid !== true || plugin.data.valid !== true) throw new Error('The native hook or plugin did not pass its check');
  return {
    hooks: { valid: hooks.data.valid, events: Object.keys(hooks.data.hooks ?? {}) },
    plugin: { valid: plugin.data.valid, files: plugin.data.files, diagnostics: plugin.data.diagnostics },
    imported: { path: imported.data.path, diagnostics: imported.data.diagnostics },
  };
}

/** The README section on native Claude configuration. @param {NativeSummary} summary */
export function nativeSection(summary) {
  return [
    '## Native Claude configuration',
    '',
    `\`claude hooks set\` wrote a \`PostToolUse\` hook to \`.claude/settings.json\` that runs \`npm run check:structure\` after Claude edits a file, and \`claude hooks check\` validated it (${summary.hooks.events.join(', ')}) without running it. \`claude plugins create\` and \`claude plugins write-asset\` authored the local plugin \`${native.plugin}\` with a \`/trace\` command; \`claude plugins check\` found ${summary.plugin.diagnostics.length === 0 ? 'no problems' : `${summary.plugin.diagnostics.length} diagnostics`} in ${summary.plugin.files.map(path => `\`${path}\``).join(' and ')}.`,
    '',
    `\`agents import ${native.reviewer.agent} --from claude --dry-run\` previewed the native reviewer agent as docker-agent YAML in \`${summary.imported.path}\` and wrote nothing, because the team's generated agents already own \`.claude/agents\`. The conversion is approximate and says where:`,
    '',
    ...summary.imported.diagnostics.map(entry => `- \`${entry.code}\` (${entry.severity}): ${entry.message}`),
    '',
  ].join('\n');
}
