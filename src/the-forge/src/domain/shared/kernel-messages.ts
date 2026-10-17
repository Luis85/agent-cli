import { fill } from './messages.ts';

/**
 * English templates of the host's own warnings and plugin state reasons, by stable code. The response language
 * renders them (German in `presentation/localization/messages.ts`); `{name}` placeholders take the parameters, and
 * a `{diagnostic}` parameter is the original, untranslated message of the failure that caused the warning.
 */
export const kernelMessages = {
  // Plugin state reasons (`plugins` reason, PLUGIN_UNAVAILABLE details).
  PLUGIN_LISTED_DISABLED: 'Listed in plugins.disabled.',
  PLUGIN_NOT_ENABLED: 'Not listed in plugins.enabled.',
  PLUGIN_SKIPPED: 'Skipped by --no-plugins.',
  PLUGIN_ID_RESERVED: 'Plugin id {plugin} is reserved by the bundled core plugin; rename the user plugin.',
  PLUGIN_SETTINGS_INVALID: 'plugins.settings.{plugin} is invalid: {issues}.',
  PLUGIN_PROVIDER_UNAVAILABLE: 'Requires service {service}; its provider {provider} is unavailable.',
  PLUGIN_PROVIDER_DISABLED: 'Requires service {service}; its provider {provider} is disabled.',
  PLUGIN_PROVIDER_MISSING: 'Requires service {service}; its provider {provider} is missing.',
  PLUGIN_MISSING: 'plugins.enabled names {plugin}, but {path} does not exist; install the plugin there, or remove it from plugins.enabled.',
  // Configuration and setup warnings.
  PLUGIN_UNAVAILABLE: 'Plugin {plugin} is unavailable in this invocation: {reason} Its commands and generators fail with PLUGIN_UNAVAILABLE; fix bin/config.json and run config.',
  SETTINGS_UNDECLARED: 'plugins.settings has sections for plugins that declare no settings: {plugins}; they are ignored.',
  SETTINGS_UNKNOWN_PLUGIN: 'plugins.settings names no installed plugin: {plugins}; the sections are kept unchanged. Check for misspelled plugin ids with plugins.',
  DISABLED_UNKNOWN_PLUGIN: 'plugins.disabled names only bundled core plugins ({core}); ignored {plugins}. Disable a user plugin by removing it from plugins.enabled.',
  PLUGIN_MISSING_WARNING: '{reason} Its commands are unavailable in this invocation.',
  PLUGIN_DIRECTORY_IGNORED: 'Ignored plugin directory {directory}: {diagnostic}',
  PLUGIN_STATE_IGNORED: 'Ignored invalid {path}; plugins with activation hooks are treated as newly enabled.',
  PLUGIN_STATE_UNSAVED: 'Could not record plugin activation state in {path}: {diagnostic}',
  SETUP_TEMPLATES_UNAVAILABLE: 'The templates core plugin is disabled or unavailable; setup did not install templates into bin/templates.',
  CWD_OUTSIDE_WORKSPACE: 'The working directory {cwd} is outside the workspace root {workspaceRoot}; relative paths resolve against the workspace root (context.root), not the working directory. Pass --root or set FORGE_ROOT to use another workspace.',
  METADATA_CACHE_UNSAVED: 'The metadata cache could not be saved to {file}, so the next command reads and parses the vault again: {diagnostic}',
  // Writer and sync locks: a stale lock an acquisition removed, and a lock its writer could not release cleanly.
  LOCK_RECOVERED: 'Removed the stale lock {path} of pid {pid} on {host} (since {since}{command}): {reason}. Inspect what that run left unfinished (for example git status or backlog sync status).',
  LOCK_HOLDER_COMMAND: ', command {command}',
  LOCK_STALE_DEAD_PROCESS: 'its process no longer runs',
  LOCK_STALE_REUSED_PID: 'its pid was reused by another process',
  LOCK_STALE_REBOOTED: 'it was written before this host restarted',
  LOCK_LEFT_FOREIGN: "Left {lock} in place: it no longer carries this writer's token, so another writer may hold it.",
  LOCK_REMOVED_BY_OTHER: '{lock} was removed by someone else while this writer held it; inspect concurrent changes.',
  LOCK_UNREMOVABLE: 'Could not remove {lock}; inspect the lock before retrying: {diagnostic}',
  // Failures after a committed write or during lifecycle callbacks; they never undo the command's result.
  POST_COMMIT_FAILED: 'Committed {count} file(s); post-commit update failed: {diagnostic}',
  REMOVAL_TEMPORARY_LEFT: 'Removed {path}, but could not delete its temporary entry {temporary}: {diagnostic}',
  REMOVAL_SYNC_FAILED: 'Removed files, but syncing their folders failed: {diagnostic}',
  VAULT_NOTIFICATION_FAILED: 'Committed {path}; vault notification failed: {diagnostic}',
  EVENT_HISTORY_FULL: 'Event history reached 1000 records; later notifications are delivered but omitted from history and replay.',
  EVENT_LISTENER_FAILED: 'Listener {event}: {diagnostic}',
  EVENT_REPLAY_FAILED: 'Replay {event}: {diagnostic}',
  HOST_NOTIFICATION_FAILED: 'Host notification {event}: {diagnostic}',
  LAYOUT_CALLBACK_FAILED: 'Layout ready: {diagnostic}',
  QUIT_TASK_FAILED: 'Quit task: {diagnostic}',
  PLUGIN_CLEANUP_FAILED: 'Plugin cleanup: {diagnostic}',
  // Read results an agent could misread: a path filter that selected nothing, and content cut at the read limit.
  PATH_MATCHED_NOTHING: '{option} {pattern} matched no file in this scope. Paths are relative to context.root and case-sensitive, and a folder path without glob characters matches everything below it; run list to see the existing paths.',
  READ_TRUNCATED: '{path} was truncated to lines {start}-{end} of {total} ({returned} of {bytes} bytes); continue with --lines {next}-, or raise --max-bytes.',
  READ_BYTES_TRUNCATED: '{path} was truncated to the first {returned} of {bytes} bytes; raise --max-bytes to read the rest.',
  // Mutations that succeed but probably differ from what the caller meant; each text starts with its stable code.
  EXTENSION_DROPPED: 'EXTENSION_DROPPED: {to} has no extension, so moving {from} drops {extension}. End the destination with / to move into a folder, or add the extension.',
  LITERAL_NEWLINE: 'LITERAL_NEWLINE: --{option} contains the two characters \\n but no line break, so they are written literally. Pass real line breaks, for example with --stdin.',
  EMPTY_STDIN: 'EMPTY_STDIN: --stdin read no bytes, so {path} is written empty. Pipe the content, or pass --content "" to write an empty file on purpose.',
} as const satisfies Record<string, string>;

export type KernelMessageCode = keyof typeof kernelMessages;
/** A host message by code; a parameter may itself be a message, rendered in the same language. */
export interface KernelMessage { code: KernelMessageCode; params: Readonly<Record<string, string | number | KernelMessage>> }

/**
 * The messages the host created with `kernelMessage`. Only these render from the catalog: a look-alike object that
 * other code (such as a plugin, which is plain JavaScript) hands the warning sink stays literal text.
 */
const hostMessages = new WeakSet<object>();

/** A host message; it is frozen, so nothing can change what it renders after the host created it. */
export function kernelMessage(code: KernelMessageCode, params: KernelMessage['params'] = {}): KernelMessage {
  const message = Object.freeze({ code, params: Object.freeze({ ...params }) });
  hostMessages.add(message);
  return message;
}

/** Whether `value` is a message the host created with `kernelMessage`. */
export const isKernelMessage = (value: unknown): value is KernelMessage => typeof value === 'object' && value !== null && hostMessages.has(value);

/** Renders a message with `templates`, English by default. */
export function renderKernelMessage(message: KernelMessage, templates: Readonly<Record<KernelMessageCode, string>> = kernelMessages): string {
  const params = Object.fromEntries(Object.entries(message.params).map(([name, value]) => [name, isKernelMessage(value) ? renderKernelMessage(value, templates) : typeof value === 'string' || typeof value === 'number' ? value : warningText(value)]));
  return fill(templates[message.code], params);
}

/** A warning record in the response: a host message rendered with `templates`, any other value as `warningText`. */
export function renderWarning(warning: unknown, templates?: Readonly<Record<KernelMessageCode, string>>): string {
  return isKernelMessage(warning) ? renderKernelMessage(warning, templates) : warningText(warning);
}

/**
 * Any value as warning text, never throwing: a string as itself, an `Error` as its message, a function as
 * `[function]`, and an object or array as its JSON, in which a circular reference reads `"[circular]"`, a BigInt
 * `"<digits>n"`, a function `"[function]"` and a symbol its description. A value that cannot be read (a throwing
 * `toJSON` or `toString`, a hostile proxy) reads `Operation failed with an unreadable error.`; other values read as
 * `String(value)`.
 */
export function warningText(value: unknown): string {
  try {
    if (typeof value === 'string') return value;
    if (typeof value === 'function') return '[function]';
    if (typeof value !== 'object' || value === null) return String(value);
    if (value instanceof Error) return value.message;
    const ancestors: object[] = [];
    return JSON.stringify(value, function replacer(this: unknown, _key: string, item: unknown) {
      if (typeof item === 'bigint') return `${item}n`;
      if (typeof item === 'function') return '[function]';
      if (typeof item === 'symbol') return item.toString();
      if (typeof item !== 'object' || item === null) return item;
      while (ancestors.length > 0 && ancestors.at(-1) !== this) ancestors.pop();
      if (ancestors.includes(item)) return '[circular]';
      ancestors.push(item);
      return item;
    }) ?? String(value);
  } catch { return 'Operation failed with an unreadable error.'; }
}
