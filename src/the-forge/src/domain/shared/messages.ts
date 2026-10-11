/** Values for a message template's `{name}` placeholders, inserted verbatim. */
export type MessageParams = Readonly<Record<string, string | number>>;

const placeholder = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/** Fills a template's `{name}` placeholders; a placeholder without a parameter stays as written. */
export function fill(template: string, params: MessageParams = {}): string {
  return template.replace(placeholder, (match, name: string) => Object.hasOwn(params, name) ? String(params[name]) : match);
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The parameters of a template whose value is itself rendered from the same catalog, with the templates that may
 * render it: `{ permissionDropped: { reason: ['reasonNoBuiltin', …] } }`. Every other parameter is user data.
 */
export type MessageFragments<K extends string> = Readonly<Partial<Record<K, Readonly<Record<string, readonly K[]>>>>>;

/**
 * The regular expression source of a template: a free parameter matches any text (lazily or greedily), a declared
 * fragment parameter only text that one of its templates renders. With `capture`, each parameter is a named group,
 * and a parameter that occurs again must repeat the same text.
 */
function source<K extends string>(template: string, english: Readonly<Record<K, string>>, fragments: Readonly<Record<string, readonly K[]>>, greedy: boolean, capture: boolean): string {
  const free = greedy ? '[\\s\\S]*' : '[\\s\\S]*?', seen = new Set<string>();
  return template.split(placeholder).map((part, index) => {
    if (index % 2 === 0) return escape(part);
    const keys = fragments[part];
    const value = keys ? `(?:${keys.map(key => source(english[key], english, {}, greedy, false)).join('|')})` : free;
    if (!capture) return value;
    if (seen.has(part)) return `\\k<${part}>`;
    seen.add(part);
    return `(?<${part}>${value})`;
  }).join('');
}

const patterns = new Map<string, { lazy: RegExp; greedy: RegExp }>();
function pattern<K extends string>(key: K, english: Readonly<Record<K, string>>, fragments: MessageFragments<K>) {
  const template = english[key], declared = fragments[key] ?? {};
  const id = `${template}\u0000${JSON.stringify(Object.entries(declared).map(([name, keys]) => [name, keys.map(fragment => english[fragment])]))}`;
  let compiled = patterns.get(id);
  if (!compiled) {
    const anchored = (greedy: boolean) => new RegExp(`^${source(template, english, declared, greedy, true)}$`);
    compiled = { lazy: anchored(false), greedy: anchored(true) };
    patterns.set(id, compiled);
  }
  return compiled;
}

/**
 * The parameters that `fill(english[key], …)` used to render `text`: undefined when the template did not render it,
 * `'ambiguous'` when several parameter values render the same text. The shortest and the longest reading of every
 * parameter agree exactly when the reading is unique.
 */
function templateParams<K extends string>(key: K, text: string, english: Readonly<Record<K, string>>, fragments: MessageFragments<K>): Record<string, string> | 'ambiguous' | undefined {
  const { lazy, greedy } = pattern(key, english, fragments);
  const match = lazy.exec(text);
  if (!match) return undefined;
  const shortest = match.groups ?? {}, longest = greedy.exec(text)!.groups ?? {};
  return Object.keys(shortest).some(name => shortest[name] !== longest[name]) ? 'ambiguous' : { ...shortest };
}

/**
 * Renders a message in another language. A plugin's domain renders its findings in English from a template catalog
 * (`fill(english.key, params)`), so results stay plain data; its presentation finds the English template that
 * rendered `text` (the first match in catalog order) and fills the same parameters into the `target` template.
 * Parameter values are user data and stay exactly as written, except the declared `fragments`: a parameter that is
 * itself rendered from the catalog (a reason inside a sentence) is rendered in the target language too. Text that no
 * template rendered, such as a third-party diagnostic, is returned unchanged, and so is text whose parameters cannot
 * be told apart (a value containing the template's own words), rather than splitting a user value at a guess.
 */
export function retranslate<K extends string>(text: string, english: Readonly<Record<K, string>>, target: Readonly<Partial<Record<K, string>>>, fragments: MessageFragments<K> = {} as MessageFragments<K>): string {
  return render(text, Object.keys(english) as K[], english, target, fragments);
}

/** `text` rendered from the first of `keys` whose English template rendered it. */
function render<K extends string>(text: string, keys: readonly K[], english: Readonly<Record<K, string>>, target: Readonly<Partial<Record<K, string>>>, fragments: MessageFragments<K>): string {
  for (const key of keys) {
    const params = templateParams(key, text, english, fragments);
    const translated = target[key];
    if (params === 'ambiguous') return text;
    if (!params || translated === undefined) continue;
    const declared = fragments[key] ?? {};
    return fill(translated, Object.fromEntries(Object.entries(params).map(([name, value]) => {
      const allowed = declared[name];
      return [name, allowed ? render(value, allowed, english, target, fragments) : value];
    })));
  }
  return text;
}
