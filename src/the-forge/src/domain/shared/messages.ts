/** Values for a message template's `{name}` placeholders, inserted verbatim. */
export type MessageParams = Readonly<Record<string, string | number>>;

const placeholder = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/** Fills a template's `{name}` placeholders; a placeholder without a parameter stays as written. */
export function fill(template: string, params: MessageParams = {}): string {
  return template.replace(placeholder, (match, name: string) => Object.hasOwn(params, name) ? String(params[name]) : match);
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = new Map<string, { expression: RegExp; names: string[] }>();
function pattern(template: string) {
  let compiled = patterns.get(template);
  if (!compiled) {
    const names: string[] = [];
    const source = template.split(placeholder).map((part, index) => {
      if (index % 2 === 0) return escape(part);
      names.push(part);
      return '([\\s\\S]*?)';
    }).join('');
    compiled = { expression: new RegExp(`^${source}$`), names };
    patterns.set(template, compiled);
  }
  return compiled;
}

/** The parameters that `fill(template, …)` used to render `text`, or undefined when the template did not render it. */
function templateParams(template: string, text: string): Record<string, string> | undefined {
  const { expression, names } = pattern(template);
  const match = expression.exec(text);
  return match ? Object.fromEntries(names.map((name, index) => [name, match[index + 1]!])) : undefined;
}

/**
 * Renders a message in another language. A plugin's domain renders its findings in English from a template catalog
 * (`fill(english.key, params)`), so results stay plain data; its presentation finds the English template that
 * rendered `text` (the first match in catalog order) and fills the same parameters into the `target` template.
 * Text that no template rendered, such as a third-party diagnostic, is returned unchanged. A parameter that is itself
 * a fragment rendered from the catalog (a reason inside a sentence) is rendered in the target language too.
 */
export function retranslate<K extends string>(text: string, english: Readonly<Record<K, string>>, target: Readonly<Partial<Record<K, string>>>, depth = 2): string {
  for (const [key, template] of Object.entries(english) as Array<[K, string]>) {
    const params = templateParams(template, text);
    const translated = target[key];
    if (!params || translated === undefined) continue;
    const nested = depth > 0 ? Object.fromEntries(Object.entries(params).map(([name, value]) => [name, retranslate(value, english, target, depth - 1)])) : params;
    return fill(translated, nested);
  }
  return text;
}
