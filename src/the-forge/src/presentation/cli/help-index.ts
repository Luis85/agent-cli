import { commandAnnotations } from '../../application/plugins/command-metadata.ts';
import type { Language } from '../../application/plugins/plugin-catalog.ts';
import type { Command } from '../../application/plugins/registry.ts';
import { Localizer } from '../localization/localization.ts';
import type { forgeIdentity } from './identity.ts';

/** The most bytes of compact JSON the help index takes, in every response language. */
export const helpIndexBudget = 4096;
/** The most characters of a command description the help index shows; `help <command>` shows all of it. */
export const indexDescriptionLength = 76;
/** The shortest cut the index makes to stay within its budget; an index of more commands than that fits exceeds it. */
export const shortestIndexDescription = 24;
const languages: readonly Language[] = ['en', 'de'];
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * A description as the help index lists it: its first sentence (up to the first `. ` or `; `), shortened at a word
 * boundary with `…` when it is longer than `length` characters.
 */
export function indexDescription(description: string, length = indexDescriptionLength): string {
  const sentence = /^(.*?)[.;](?:\s|$)/s.exec(description)?.[1]?.concat('.') ?? description;
  if (sentence.length <= length) return sentence;
  const cut = sentence.slice(0, length);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:(]+$/, '')}…`;
}

/**
 * The entry index of `help`: every command id with its description as `indexDescription` shortens it, the mutating
 * commands, the global flags and `next`. The descriptions take the longest length, at most `indexDescriptionLength`
 * and at least `shortestIndexDescription`, at which the compact JSON stays within `helpIndexBudget` bytes, so more
 * commands (user plugins among them) shorten every description instead of outgrowing the budget. The descriptions
 * are already in the response language; `next` counts in its longest translation, since the response translates it
 * after the index is built.
 */
export function helpIndex(identity: typeof forgeIdentity, commands: readonly Command[], globalOptions: readonly string[], next: string) {
  const translations = languages.map(language => (new Localizer(language).result({ localizedOutput: { next: 'text' } }, { next }) as { next: string }).next);
  const longestNext = translations.reduce((longest, text) => bytes(text) > bytes(longest) ? text : longest, next);
  const mutating = commands.filter(command => commandAnnotations(command).mutating).map(command => command.id);
  const index = (length: number, nextText = next) => ({
    name: identity.name, version: identity.version, apiVersion: identity.apiVersion,
    commands: Object.fromEntries(commands.map(command => [command.id, indexDescription(command.description, length)])),
    mutating, globalOptions, next: nextText,
  });
  let length = indexDescriptionLength;
  while (length > shortestIndexDescription && bytes(index(length, longestNext)) > helpIndexBudget) length--;
  return index(length);
}
