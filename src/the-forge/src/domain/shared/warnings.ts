import { isRecord } from './errors.ts';
import { isKernelMessage, kernelMessages, renderKernelMessage, warningText, type KernelMessage, type KernelMessageCode } from './kernel-messages.ts';

/**
 * One entry of the response's `warnings`: a stable `code` to match on, the `message` in the response language and,
 * when the message was filled from values (a path, an option, the plugin that warned), those values as `details`.
 */
export interface Warning { code: string; message: string; details?: Record<string, unknown> }

/** The code of a plugin warning that names no code of its own, or names one the plugin may not use. */
export const pluginWarningCode = 'PLUGIN_WARNING';
const warningCode = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

/** The warnings `pluginWarning` created; any other record in the warning list reads as text. */
const recorded = new WeakSet<object>();

/** A plain JSON copy of `value`, or undefined when it is not a record that survives JSON encoding unchanged in shape. */
function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  try {
    const copy: unknown = JSON.parse(JSON.stringify(value));
    return isRecord(copy) ? copy : undefined;
  } catch { return undefined; }
}

/**
 * A plugin's own warning shape: `{code, message, details?}` with a string message. It keeps an UPPER_SNAKE_CASE code
 * that is not a host code, with details that are a JSON record. Otherwise it reads PLUGIN_WARNING with the same text,
 * the rejected code in `details.requestedCode`, and its details only when they are a JSON record.
 */
function codedWarning(value: unknown): Warning | undefined {
  try {
    if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype || !Object.hasOwn(value, 'code')) return undefined;
    const { code, message, details } = value;
    if (typeof message !== 'string') return undefined;
    const copied = details === undefined ? {} : jsonRecord(details);
    const own = copied !== undefined && typeof code === 'string' && warningCode.test(code) && !Object.hasOwn(kernelMessages, code);
    const kept = own ? copied : { ...copied, ...(typeof code === 'string' ? { requestedCode: code } : {}) };
    return { code: own ? code : pluginWarningCode, message, ...(Object.keys(kept).length > 0 ? { details: kept } : {}) };
  } catch { return undefined; }
}

/**
 * The warning a plugin raised, captured when it was raised: a `{code, message, details?}` record keeps its text, and
 * its code and JSON details where valid (see `codedWarning`); any other value becomes its text (see `warningText`)
 * under PLUGIN_WARNING. `details.plugin` names the plugin when the warning arrived through its own event channel.
 */
export function pluginWarning(value: unknown, plugin?: string): Warning {
  const coded = codedWarning(value);
  const base = coded ?? { code: pluginWarningCode, message: warningText(value) };
  const details = { ...base.details, ...(plugin === undefined ? {} : { plugin }) };
  const warning = Object.freeze({ code: base.code, message: base.message, ...(Object.keys(details).length > 0 ? { details } : {}) });
  recorded.add(warning);
  return warning;
}

/** Whether `value` is a warning `pluginWarning` created. */
export const isPluginWarning = (value: unknown): value is Warning => typeof value === 'object' && value !== null && recorded.has(value);

/** The values a host message was filled from; a nested message (a reason) is itself `{code, message, details?}`. */
function messageDetails(message: KernelMessage, templates?: Readonly<Record<KernelMessageCode, string>>): Record<string, unknown> | undefined {
  const entries = Object.entries(message.params).map(([name, value]) => [name,
    isKernelMessage(value) ? hostWarning(value, templates) : typeof value === 'string' || typeof value === 'number' ? value : warningText(value)] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** A host message as a warning, rendered with `templates`. */
function hostWarning(message: KernelMessage, templates?: Readonly<Record<KernelMessageCode, string>>): Warning {
  const details = messageDetails(message, templates);
  return { code: message.code, message: renderKernelMessage(message, templates), ...(details ? { details } : {}) };
}

/**
 * A recorded warning as the response reports it: a host message by its code, rendered with `templates` (English by
 * default), with its parameters as `details` and nested messages as warnings of their own; a plugin warning as
 * captured; any other value as PLUGIN_WARNING text.
 */
export function responseWarning(record: unknown, templates?: Readonly<Record<KernelMessageCode, string>>): Warning {
  if (isKernelMessage(record)) return hostWarning(record, templates);
  if (isPluginWarning(record)) return { ...record };
  return { code: pluginWarningCode, message: warningText(record) };
}
