import { ensure, isRecord } from '../shared/errors.ts';

const execution = ['command', 'http', 'mcp_tool'] as const;
const evaluation = [...execution, 'prompt', 'agent'] as const;

/** Configuration capabilities from https://code.claude.com/docs/en/hooks (2026-10-07). */
export const claudeHookEvents = {
  SessionStart: ['command', 'mcp_tool'],
  Setup: ['command', 'mcp_tool'],
  UserPromptSubmit: evaluation,
  UserPromptExpansion: evaluation,
  PreToolUse: evaluation,
  PermissionRequest: [...execution, 'prompt'],
  PermissionDenied: evaluation,
  PostToolUse: evaluation,
  PostToolUseFailure: evaluation,
  PostToolBatch: evaluation,
  Notification: execution,
  MessageDisplay: execution,
  SubagentStart: execution,
  SubagentStop: evaluation,
  TaskCreated: evaluation,
  TaskCompleted: evaluation,
  Stop: evaluation,
  StopFailure: execution,
  TeammateIdle: evaluation,
  InstructionsLoaded: execution,
  ConfigChange: execution,
  CwdChanged: execution,
  DirectoryAdded: execution,
  FileChanged: execution,
  WorktreeCreate: execution,
  WorktreeRemove: execution,
  PreCompact: execution,
  PostCompact: execution,
  PreModelSwitch: execution,
  PostModelSwitch: execution,
  Elicitation: execution,
  ElicitationResult: execution,
  SessionEnd: execution,
} as const;

const code = 'INVALID_CLAUDE_HOOKS';
function stringField(value: Record<string, unknown>, key: string, location: string, required = false): void {
  if (required || Object.hasOwn(value, key)) {
    ensure(typeof value[key] === 'string' && (!required || value[key].trim().length > 0), code, `${location}.${key} must be ${required ? 'a nonempty string' : 'a string'}.`);
  }
}
function stringArray(value: unknown, location: string): void {
  ensure(Array.isArray(value) && Array.from(value).every(item => typeof item === 'string'), code, `${location} must be an array of strings.`);
}

function handler(value: unknown, event: keyof typeof claudeHookEvents, location: string): void {
  ensure(isRecord(value), code, `${location} must be a hook handler object.`);
  ensure(typeof value.type === 'string' && (claudeHookEvents[event] as readonly string[]).includes(value.type), code, `${location}.type must be one of ${claudeHookEvents[event].join(', ')} for ${event}.`);
  for (const key of ['if', 'statusMessage']) stringField(value, key, location);
  if (Object.hasOwn(value, 'timeout')) ensure(typeof value.timeout === 'number' && Number.isFinite(value.timeout) && value.timeout >= 0, code, `${location}.timeout must be a finite nonnegative number of seconds.`);
  if (Object.hasOwn(value, 'once')) ensure(typeof value.once === 'boolean', code, `${location}.once must be a boolean.`);
  for (const key of ['async', 'asyncRewake']) {
    if (Object.hasOwn(value, key)) ensure(value.type === 'command' && typeof value[key] === 'boolean', code, `${location}.${key} requires a command hook and a boolean value.`);
  }
  if (value.type === 'command') {
    stringField(value, 'command', location, true);
    if (Object.hasOwn(value, 'args')) stringArray(value.args, `${location}.args`);
    if (Object.hasOwn(value, 'shell')) ensure(value.shell === 'bash' || value.shell === 'powershell', code, `${location}.shell must be bash or powershell.`);
  } else if (value.type === 'http') {
    stringField(value, 'url', location, true);
    let validUrl = false;
    try { const url = new URL(value.url as string); validUrl = ['http:', 'https:'].includes(url.protocol); }
    catch { /* The diagnostic below names the original configuration location. */ }
    ensure(validUrl, code, `${location}.url must be an absolute HTTP or HTTPS URL.`);
    if (Object.hasOwn(value, 'headers')) ensure(isRecord(value.headers) && Object.values(value.headers).every(item => typeof item === 'string'), code, `${location}.headers must map header names to strings.`);
    if (Object.hasOwn(value, 'allowedEnvVars')) stringArray(value.allowedEnvVars, `${location}.allowedEnvVars`);
  } else if (value.type === 'mcp_tool') {
    stringField(value, 'server', location, true);
    stringField(value, 'tool', location, true);
    if (Object.hasOwn(value, 'input')) ensure(isRecord(value.input), code, `${location}.input must be an object of MCP tool arguments.`);
  } else {
    stringField(value, 'prompt', location, true);
    stringField(value, 'model', location);
  }
}

/** Validate native hook configuration without executing handlers or changing extension fields. */
export function validateClaudeHooks(value: unknown): asserts value is Record<string, unknown> {
  ensure(isRecord(value), code, 'Claude hooks must be an object mapping event names to matcher groups.');
  for (const [event, groups] of Object.entries(value)) {
    ensure(Object.hasOwn(claudeHookEvents, event), code, `Unknown Claude hook event: ${event}.`);
    ensure(Array.isArray(groups), code, `hooks.${event} must be an array of matcher groups.`);
    for (const [index, group] of groups.entries()) {
      const location = `hooks.${event}[${index}]`;
      ensure(isRecord(group), code, `${location} must be a matcher group object.`);
      // Claude ignores matchers on events without matcher support. Keep their authored text.
      stringField(group, 'matcher', location);
      ensure(Array.isArray(group.hooks), code, `${location}.hooks must be an array of hook handlers.`);
      for (const [handlerIndex, entry] of group.hooks.entries()) handler(entry, event as keyof typeof claudeHookEvents, `${location}.hooks[${handlerIndex}]`);
    }
  }
}
