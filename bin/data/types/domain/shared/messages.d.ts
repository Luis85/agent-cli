/** Values for a message template's `{name}` placeholders, inserted verbatim. */
export type MessageParams = Readonly<Record<string, string | number>>;
/** Fills a template's `{name}` placeholders; a placeholder without a parameter stays as written. */
export declare function fill(template: string, params?: MessageParams): string;
/**
 * The parameters of a template whose value is itself rendered from the same catalog, with the templates that may
 * render it: `{ permissionDropped: { reason: ['reasonNoBuiltin', …] } }`. Every other parameter is user data.
 */
export type MessageFragments<K extends string> = Readonly<Partial<Record<K, Readonly<Record<string, readonly K[]>>>>>;
/**
 * Renders a message in another language. A plugin's domain renders its findings in English from a template catalog
 * (`fill(english.key, params)`), so results stay plain data; its presentation finds the English template that
 * rendered `text` (the first match in catalog order) and fills the same parameters into the `target` template.
 * Parameter values are user data and stay exactly as written, except the declared `fragments`: a parameter that is
 * itself rendered from the catalog (a reason inside a sentence) is rendered in the target language too. Text that no
 * template rendered, such as a third-party diagnostic, is returned unchanged, and so is text whose parameters cannot
 * be told apart (a value containing the template's own words), rather than splitting a user value at a guess.
 */
export declare function retranslate<K extends string>(text: string, english: Readonly<Record<K, string>>, target: Readonly<Partial<Record<K, string>>>, fragments?: MessageFragments<K>): string;
