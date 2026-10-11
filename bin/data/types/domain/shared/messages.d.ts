/** Values for a message template's `{name}` placeholders, inserted verbatim. */
export type MessageParams = Readonly<Record<string, string | number>>;
/** Fills a template's `{name}` placeholders; a placeholder without a parameter stays as written. */
export declare function fill(template: string, params?: MessageParams): string;
/**
 * Renders a message in another language. A plugin's domain renders its findings in English from a template catalog
 * (`fill(english.key, params)`), so results stay plain data; its presentation finds the English template that
 * rendered `text` (the first match in catalog order) and fills the same parameters into the `target` template.
 * Text that no template rendered, such as a third-party diagnostic, is returned unchanged. A parameter that is itself
 * a fragment rendered from the catalog (a reason inside a sentence) is rendered in the target language too.
 */
export declare function retranslate<K extends string>(text: string, english: Readonly<Record<K, string>>, target: Readonly<Partial<Record<K, string>>>, depth?: number): string;
