import { type KernelMessageCode } from './kernel-messages.ts';
/**
 * One entry of the response's `warnings`: a stable `code` to match on, the `message` in the response language and,
 * when the message was filled from values (a path, an option, the plugin that warned), those values as `details`.
 */
export interface Warning {
    code: string;
    message: string;
    details?: Record<string, unknown>;
}
/** The code of a plugin warning that names no code of its own, or names one the plugin may not use. */
export declare const pluginWarningCode = "PLUGIN_WARNING";
/**
 * The warning a plugin raised, captured when it was raised: a `{code, message, details?}` record keeps its code, text
 * and JSON details; any other value becomes its text (see `warningText`) under PLUGIN_WARNING. `details.plugin` names
 * the plugin when the warning arrived through its own event channel.
 */
export declare function pluginWarning(value: unknown, plugin?: string): Warning;
/** Whether `value` is a warning `pluginWarning` created. */
export declare const isPluginWarning: (value: unknown) => value is Warning;
/**
 * A recorded warning as the response reports it: a host message by its code, rendered with `templates` (English by
 * default), with its parameters as `details` and nested messages as warnings of their own; a plugin warning as
 * captured; any other value as PLUGIN_WARNING text.
 */
export declare function responseWarning(record: unknown, templates?: Readonly<Record<KernelMessageCode, string>>): Warning;
