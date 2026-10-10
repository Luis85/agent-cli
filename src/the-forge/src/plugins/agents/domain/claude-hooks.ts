import { diagnostic, isObject, pointer, record, type AgentDiagnostic } from './config.ts';
import { hookEvents, toolMatcherEvents, translateMatcher } from './claude-vocabulary.ts';

type Handler = Record<string, unknown>;
/** docker-agent handler fields without a Claude equivalent; `args` only parameterize builtin hooks. */
const ignoredHandlerFields = ['name', 'args', 'env', 'working_dir', 'on_error', 'strict_output'];
/** A command a generated hook runs, with the JSON pointer of its docker-agent handler. */
export interface HookCommand { at: string; event: string; command: string }

/** A docker-agent command hook as a Claude command hook; other hook types have no Claude equivalent. */
function handler(definition: Handler, at: string, diagnostics: AgentDiagnostic[]): Handler | undefined {
  if (definition.type !== 'command' || typeof definition.command !== 'string') {
    diagnostics.push(diagnostic('warning', 'hook-unsupported', at, `A ${String(definition.type)} hook has no Claude equivalent and is not emitted.`, 'U'));
    return undefined;
  }
  for (const field of ignoredHandlerFields) if (definition[field] !== undefined) {
    diagnostics.push(diagnostic('info', 'hook-field-unsupported', `${at}/${field}`, `Hook ${field} is not emitted.`, 'U'));
  }
  return { type: 'command', command: definition.command, ...(typeof definition.timeout === 'number' ? { timeout: definition.timeout } : {}) };
}

/**
 * Maps an agent's `hooks` to Claude agent frontmatter hooks. Events with a Claude equivalent keep their command
 * hooks, tool matchers are translated to Claude tool names, and every mapped event is approximate: Claude Code sends
 * its own hook input and reads its own decision format. `commands` lists every command the hooks would run.
 */
export function claudeHooks(name: string, hooks: unknown): { hooks?: Record<string, unknown[]>; commands: HookCommand[]; diagnostics: AgentDiagnostic[] } {
  const diagnostics: AgentDiagnostic[] = [], result: Record<string, unknown[]> = {}, commands: HookCommand[] = [];
  for (const [event, entries] of Object.entries(record(hooks))) {
    const at = pointer('agents', name, 'hooks', event), target = hookEvents[event];
    if (!target) {
      diagnostics.push(diagnostic('warning', 'hook-unsupported', at, `The ${event} hook event has no Claude equivalent and is not emitted.`, 'U'));
      continue;
    }
    const groups: unknown[] = [];
    (Array.isArray(entries) ? entries : []).forEach((entry, index) => {
      const where = `${at}/${index}`;
      if (!isObject(entry)) return;
      // Tool events group handlers under a matcher; the other events list handlers directly.
      const grouped = Array.isArray(entry.hooks);
      const handlers = (grouped ? entry.hooks as unknown[] : [entry]).flatMap((definition, position) => {
        const location = grouped ? `${where}/hooks/${position}` : where;
        const mapped = isObject(definition) ? handler(definition, location, diagnostics) : undefined;
        if (mapped) commands.push({ at: location, event: target, command: String(mapped.command) });
        return mapped ? [mapped] : [];
      });
      if (handlers.length === 0) return;
      let matcher: string | undefined;
      if (grouped && toolMatcherEvents.includes(target)) {
        const translated = translateMatcher(typeof entry.matcher === 'string' ? entry.matcher : '*');
        matcher = translated.matcher;
        if (translated.unknown.length > 0) diagnostics.push(diagnostic('warning', 'hook-matcher-approximated', `${where}/matcher`, `Matcher alternatives ${translated.unknown.join(', ')} have no known Claude tool and are kept literally.`, 'A'));
      }
      if (entry.preempt_yolo !== undefined) diagnostics.push(diagnostic('info', 'hook-field-unsupported', `${where}/preempt_yolo`, 'preempt_yolo is not emitted.', 'U'));
      groups.push({ ...(matcher === undefined ? {} : { matcher }), hooks: handlers });
    });
    if (groups.length === 0) continue;
    result[target] = [...(result[target] ?? []), ...groups];
    diagnostics.push(diagnostic('warning', 'hook-approximated', at, `${event} hooks run on Claude's ${target} event, which sends Claude Code's hook input; check each command's input and decision format.`, 'A'));
  }
  return { ...(Object.keys(result).length > 0 ? { hooks: result } : {}), commands, diagnostics };
}
