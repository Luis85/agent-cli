/**
 * docker-agent evaluates `${…}` JavaScript template expressions in prompts, descriptions, commands and MCP
 * settings (`${env.X}`, `${env.X || 'default'}`, ternaries, `${tool({…})}`, and `${args[i]}` in commands). Claude
 * Code expands none of them in agent prompts, `${VAR}` / `${VAR:-default}` in `.mcp.json` and MCP settings, and
 * `$ARGUMENTS` / `$N` in skills. These functions find expressions and translate the ones with a Claude equivalent.
 */
export interface TemplateExpression { start: number; end: number; source: string; body: string }

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Every `${…}` expression with balanced braces, skipping string literals inside it. */
export function templateExpressions(text: string): TemplateExpression[] {
  const found: TemplateExpression[] = [];
  for (let start = text.indexOf('${'); start >= 0; start = text.indexOf('${', start + 1)) {
    let depth = 0, quote: string | undefined, index = start + 1;
    for (; index < text.length; index++) {
      const char = text[index]!;
      if (quote) { if (char === '\\') index++; else if (char === quote) quote = undefined; continue; }
      if (char === '"' || char === "'" || char === '`') quote = char;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) break;
    }
    if (index >= text.length) break;
    found.push({ start, end: index + 1, source: text.slice(start, index + 1), body: text.slice(start + 2, index).trim() });
    start = index;
  }
  return found;
}

/** Replaces each expression that `translate` maps; the others stay literal and are returned as `kept`. */
function rewrite(text: string, translate: (body: string) => string | undefined): { text: string; kept: string[] } {
  const kept: string[] = [];
  let output = '', last = 0;
  for (const expression of templateExpressions(text)) {
    const replacement = translate(expression.body);
    output += text.slice(last, expression.start) + (replacement ?? expression.source);
    if (replacement === undefined) kept.push(expression.source);
    last = expression.end;
  }
  return { text: output + text.slice(last), kept };
}

/** `${env.X}` → `${X}`, `${env.X || 'd'}` → `${X:-d}`, and the legacy `${X}` stays; Claude expands these in MCP settings. */
export function mcpVariables(text: string): { text: string; kept: string[] } {
  return rewrite(text, body => {
    if (identifier.test(body)) return `\${${body}}`;
    const plain = /^env\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(body);
    if (plain) return `\${${plain[1]}}`;
    const fallback = /^env\.([A-Za-z_][A-Za-z0-9_]*)\s*\|\|\s*(['"])([^'"$}]*)\2$/.exec(body);
    return fallback ? `\${${fallback[1]}:-${fallback[3]}}` : undefined;
  });
}

/**
 * Command arguments for a Claude skill: `${args[i]}` → `$i` (both 0-based) and `${args}` or `${args.join(" ")}` →
 * `$ARGUMENTS`. `usesArguments` reports whether the command referenced its arguments at all.
 */
export function commandArguments(text: string): { text: string; kept: string[]; usesArguments: boolean } {
  let usesArguments = false;
  const result = rewrite(text, body => {
    const index = /^args\[(\d+)\]$/.exec(body);
    if (index) { usesArguments = true; return `$${index[1]}`; }
    if (/^args(?:\.join\(\s*(['"])\s\1\s*\))?$/.test(body)) { usesArguments = true; return '$ARGUMENTS'; }
    return undefined;
  });
  return { ...result, usesArguments };
}

/** docker-agent's legacy bang tool calls such as `` !shell(cmd="ls") ``. */
export const bangToolCalls = (text: string) => [...text.matchAll(/!`?[a-z_][a-z0-9_]*\([^)\n]*\)`?/g)].map(match => match[0]);
