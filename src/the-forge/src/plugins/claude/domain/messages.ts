/**
 * English texts that `claude` results carry for a person or agent to read: plugin check diagnostics, limitations and
 * notes, and the descriptive values of `claude capabilities`. The presentation renders them in the response
 * language; output from the Claude Code CLI itself passes through unchanged.
 */
export const claudeMessages = {
  componentFileMissing: 'Manifest component file was not found among regular plugin files.',
  componentPathEmpty: 'No regular files found at this declared component path; it may be empty or missing. Claude Code validation checks directory existence.',
  ignoredAgentField: 'Claude ignores {key} in plugin agents; use a project/user agent for per-agent configuration.',
  noCodeExecuted: 'No plugin code, hooks, MCP or LSP servers were executed.',
  claudeAuthoritative: 'Claude Code remains authoritative for runtime compatibility and version-specific fields.',
  pluginValidation: 'Known manifest shapes and contained relative paths; unknown fields are preserved. Referenced files, installed versions and runtime behavior require Claude Code validation.',
  agentRestrictions: 'Other permission rules and managed settings may still restrict this agent.',
  pluginAgentLimitations: 'Claude Code ignores hooks, mcpServers, permissionMode and initialPrompt in plugin agents.',
  hookValidation: 'configuration; hook code is not executed',
  agentFormat: 'Markdown with YAML frontmatter',
  hookExecution: 'Claude Code owns execution; Forge never runs hook handlers.',
  mutationScope: 'project where the native command supports a scope',
  lifecycleDryRun: 'Returns command arguments without starting Claude Code.',
} as const satisfies Record<string, string>;

export type ClaudeMessage = keyof typeof claudeMessages;
