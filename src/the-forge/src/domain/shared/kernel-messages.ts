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
} as const satisfies Record<string, string>;

export type KernelMessageCode = keyof typeof kernelMessages;
/** A host message by code; a parameter may itself be a message, rendered in the same language. */
export interface KernelMessage { code: KernelMessageCode; params: Readonly<Record<string, string | number | KernelMessage>> }

export const kernelMessage = (code: KernelMessageCode, params: KernelMessage['params'] = {}): KernelMessage => ({ code, params });

/** Renders a message with `templates`, English by default. */
export function renderKernelMessage(message: KernelMessage, templates: Readonly<Record<KernelMessageCode, string>> = kernelMessages): string {
  const params = Object.fromEntries(Object.entries(message.params).map(([name, value]) => [name, typeof value === 'object' ? renderKernelMessage(value, templates) : value]));
  return fill(templates[message.code], params);
}
