/** Self-contained runtime helper embedded only in React components with inline styles. */
export const reactStyleHelper = `function css(value: unknown): _UiCSSProperties {
  const declarations: string[] = [];
  let part = '';
  let quote = '';
  let depth = 0;
  let escaped = false;
  let comment = false;
  const source = globalThis.String(value ?? '');
  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    const next = source[index + 1];
    if (comment) {
      if (character === '*' && next === '/') { comment = false; index++; }
      continue;
    }
    if (escaped) { part += character; escaped = false; continue; }
    if (character === '\\\\') { part += character; escaped = true; continue; }
    if (quote) {
      part += character;
      if (character === quote) quote = '';
      continue;
    }
    if (character === '/' && next === '*') { comment = true; index++; continue; }
    if (character === '"' || character === "'") quote = character;
    if (character === '(' || character === '[') depth++;
    if (character === ')' || character === ']') depth = globalThis.Math.max(0, depth - 1);
    if (character === ';' && depth === 0) { declarations.push(part); part = ''; }
    else part += character;
  }
  declarations.push(part);
  return globalThis.Object.fromEntries(declarations.flatMap(declaration => {
    const colon = declaration.indexOf(':');
    if (colon < 1) return [];
    const key = declaration.slice(0, colon).trim();
    const content = declaration.slice(colon + 1).trim();
    if (!key || !content) return [];
    const property = key.startsWith('--') ? key : key.replace(/^-ms-/, 'ms-').replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    return [[property, content]];
  })) as _UiCSSProperties;
}
`;
