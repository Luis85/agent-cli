/**
 * English templates of the host's own warnings and plugin state reasons, by stable code. The response language
 * renders them (German in `presentation/localization/messages.ts`); `{name}` placeholders take the parameters, and
 * a `{diagnostic}` parameter is the original, untranslated message of the failure that caused the warning.
 */
export declare const kernelMessages: {
    readonly PLUGIN_LISTED_DISABLED: "Listed in plugins.disabled.";
    readonly PLUGIN_NOT_ENABLED: "Not listed in plugins.enabled.";
    readonly PLUGIN_SKIPPED: "Skipped by --no-plugins.";
    readonly PLUGIN_ID_RESERVED: "Plugin id {plugin} is reserved by the bundled core plugin; rename the user plugin.";
    readonly PLUGIN_SETTINGS_INVALID: "plugins.settings.{plugin} is invalid: {issues}.";
    readonly PLUGIN_PROVIDER_UNAVAILABLE: "Requires service {service}; its provider {provider} is unavailable.";
    readonly PLUGIN_PROVIDER_DISABLED: "Requires service {service}; its provider {provider} is disabled.";
    readonly PLUGIN_PROVIDER_MISSING: "Requires service {service}; its provider {provider} is missing.";
    readonly PLUGIN_MISSING: "plugins.enabled names {plugin}, but {path} does not exist; install the plugin there, or remove it from plugins.enabled.";
    readonly PLUGIN_UNAVAILABLE: "Plugin {plugin} is unavailable in this invocation: {reason} Its commands and generators fail with PLUGIN_UNAVAILABLE; fix bin/config.json and run config.";
    readonly SETTINGS_UNDECLARED: "plugins.settings has sections for plugins that declare no settings: {plugins}; they are ignored.";
    readonly SETTINGS_UNKNOWN_PLUGIN: "plugins.settings names no installed plugin: {plugins}; the sections are kept unchanged. Check for misspelled plugin ids with plugins.";
    readonly DISABLED_UNKNOWN_PLUGIN: "plugins.disabled names only bundled core plugins ({core}); ignored {plugins}. Disable a user plugin by removing it from plugins.enabled.";
    readonly PLUGIN_MISSING_WARNING: "{reason} Its commands are unavailable in this invocation.";
    readonly PLUGIN_DIRECTORY_IGNORED: "Ignored plugin directory {directory}: {diagnostic}";
    readonly PLUGIN_STATE_IGNORED: "Ignored invalid {path}; plugins with activation hooks are treated as newly enabled.";
    readonly PLUGIN_STATE_UNSAVED: "Could not record plugin activation state in {path}: {diagnostic}";
    readonly SETUP_TEMPLATES_UNAVAILABLE: "The templates core plugin is disabled or unavailable; setup did not install templates into bin/templates.";
    readonly METADATA_CACHE_UNSAVED: "The metadata cache could not be saved to {file}, so the next command reads and parses the vault again: {diagnostic}";
    readonly LOCK_RECOVERED: "Removed the stale lock {path} of pid {pid} on {host} (since {since}{command}): {reason}. Inspect what that run left unfinished (for example git status or backlog sync status).";
    readonly LOCK_HOLDER_COMMAND: ", command {command}";
    readonly LOCK_STALE_DEAD_PROCESS: "its process no longer runs";
    readonly LOCK_STALE_REUSED_PID: "its pid was reused by another process";
    readonly LOCK_STALE_REBOOTED: "it was written before this host restarted";
    readonly LOCK_LEFT_FOREIGN: "Left {lock} in place: it no longer carries this writer's token, so another writer may hold it.";
    readonly LOCK_REMOVED_BY_OTHER: "{lock} was removed by someone else while this writer held it; inspect concurrent changes.";
    readonly LOCK_UNREMOVABLE: "Could not remove {lock}; inspect the lock before retrying: {diagnostic}";
    readonly POST_COMMIT_FAILED: "Committed {count} file(s); post-commit update failed: {diagnostic}";
    readonly REMOVAL_TEMPORARY_LEFT: "Removed {path}, but could not delete its temporary entry {temporary}: {diagnostic}";
    readonly REMOVAL_SYNC_FAILED: "Removed files, but syncing their folders failed: {diagnostic}";
    readonly VAULT_NOTIFICATION_FAILED: "Committed {path}; vault notification failed: {diagnostic}";
    readonly EVENT_HISTORY_FULL: "Event history reached 1000 records; later notifications are delivered but omitted from history and replay.";
    readonly EVENT_LISTENER_FAILED: "Listener {event}: {diagnostic}";
    readonly EVENT_REPLAY_FAILED: "Replay {event}: {diagnostic}";
    readonly HOST_NOTIFICATION_FAILED: "Host notification {event}: {diagnostic}";
    readonly LAYOUT_CALLBACK_FAILED: "Layout ready: {diagnostic}";
    readonly QUIT_TASK_FAILED: "Quit task: {diagnostic}";
    readonly PLUGIN_CLEANUP_FAILED: "Plugin cleanup: {diagnostic}";
};
export type KernelMessageCode = keyof typeof kernelMessages;
/** A host message by code; a parameter may itself be a message, rendered in the same language. */
export interface KernelMessage {
    code: KernelMessageCode;
    params: Readonly<Record<string, string | number | KernelMessage>>;
}
/** A host message; it is frozen, so nothing can change what it renders after the host created it. */
export declare function kernelMessage(code: KernelMessageCode, params?: KernelMessage['params']): KernelMessage;
/** Whether `value` is a message the host created with `kernelMessage`. */
export declare const isKernelMessage: (value: unknown) => value is KernelMessage;
/** Renders a message with `templates`, English by default. */
export declare function renderKernelMessage(message: KernelMessage, templates?: Readonly<Record<KernelMessageCode, string>>): string;
/** A warning record in the response: a host message rendered with `templates`, any other value as `warningText`. */
export declare function renderWarning(warning: unknown, templates?: Readonly<Record<KernelMessageCode, string>>): string;
/**
 * Any value as warning text, never throwing: a string as itself, an `Error` as its message, a function as
 * `[function]`, and an object or array as its JSON, in which a circular reference reads `"[circular]"`, a BigInt
 * `"<digits>n"`, a function `"[function]"` and a symbol its description. A value that cannot be read (a throwing
 * `toJSON` or `toString`, a hostile proxy) reads `Operation failed with an unreadable error.`; other values read as
 * `String(value)`.
 */
export declare function warningText(value: unknown): string;
