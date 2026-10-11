import { describe, expect, it } from 'vitest';
import { fill, type MessageFragments } from '../../src/domain/shared/messages.ts';
import { agentFragments, agentMessages } from '../../src/plugins/agents/domain/messages.ts';
import { germanAgentMessages, localizedDiagnostics } from '../../src/plugins/agents/presentation/messages.ts';
import { checkMessages, syncMessages } from '../../src/plugins/backlog/domain/messages.ts';
import { germanCheckMessages, germanSyncMessages, localizedCheck, localizedSync } from '../../src/plugins/backlog/presentation/messages.ts';
import { indexMessages } from '../../src/plugins/bases/application/messages.ts';
import { germanIndexMessages, localizedQuery } from '../../src/plugins/bases/presentation/messages.ts';
import { claudeMessages } from '../../src/plugins/claude/domain/messages.ts';
import { germanClaudeMessages, localizedResult } from '../../src/plugins/claude/presentation/messages.ts';

interface Catalog { english: Record<string, string>; german: Record<string, string>; fragments: MessageFragments<string>; localize(text: string): string }
const catalogs: Record<string, Catalog> = {
  agents: {
    english: agentMessages, german: germanAgentMessages, fragments: agentFragments as MessageFragments<string>,
    localize: message => localizedDiagnostics([{ severity: 'warning', code: 'code', pointer: '', message }], 'de')[0]!.message,
  },
  'backlog check': { english: checkMessages, german: germanCheckMessages, fragments: {}, localize: message => localizedCheck({ problems: [{ message }] }, 'de').problems[0]!.message },
  'backlog sync': {
    english: syncMessages, german: germanSyncMessages, fragments: {},
    localize: reason => localizedSync({ views: [{ skipped: [{ reason }], failed: [] }] }, 'de').views[0]!.skipped[0]!.reason,
  },
  'bases index': { english: indexMessages, german: germanIndexMessages, fragments: {}, localize: message => localizedQuery({ warnings: [{ message }] }, 'de').warnings[0]!.message },
  claude: { english: claudeMessages, german: germanClaudeMessages, fragments: {}, localize: text => localizedResult(text) as string },
};

const placeholders = (template: string) => [...new Set([...template.matchAll(/\{(\w+)\}/g)].map(match => match[1]!))];

/** A deterministic pseudo-random sequence, so a failing case reproduces. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** One message of `key` in English and German: user values verbatim, declared fragments rendered in each language. */
function message(catalog: Catalog, key: string, value: (name: string) => string, pick: (keys: readonly string[]) => string) {
  const english: Record<string, string> = {}, german: Record<string, string> = {};
  for (const name of placeholders(catalog.english[key]!)) {
    const allowed = catalog.fragments[key]?.[name];
    if (allowed) {
      const fragment = message(catalog, pick(allowed), value, pick);
      english[name] = fragment.english; german[name] = fragment.german;
    } else english[name] = german[name] = value(name);
  }
  return { english: fill(catalog.english[key]!, english), german: fill(catalog.german[key]!, german) };
}

describe.each(Object.entries(catalogs))('the %s message catalog', (_, catalog) => {
  const keys = Object.keys(catalog.english);

  it('renders every message with multi-word values in German, keeping each value exactly as written', () => {
    // Titles, types, commands and patterns: spaces, parentheses, quotes and words of the catalog's own templates.
    const values = ['Test case', "notify --title 'end of turn'", 'My Documents/*.md', 'Login works (v2) [draft]', 'Release 2: in review'];
    const untranslated = values.flatMap((value, index) => keys.flatMap(key => {
      const rendered = message(catalog, key, name => `${value} ${name}`, allowed => allowed[index % allowed.length]!);
      return catalog.localize(rendered.english) === rendered.german ? [] : [rendered.english];
    }));
    expect(untranslated).toEqual([]);
  });

  it('renders a message exactly in German or leaves it in English, whatever words its values contain', () => {
    // Values drawn from the catalog's own words can repeat a template's literal text; such a message may stay English.
    const words = [...new Set(Object.values(catalog.english).flatMap(template => template.replace(/\{\w+\}/g, ' ').split(/\s+/)).filter(Boolean)), '', '$&', '{title}'];
    const next = random(keys.length);
    const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
    const value = () => Array.from({ length: 1 + Math.floor(next() * 4) }, () => pick(words)).join(pick([' ', ' ', '; ', ', ']));
    let translated = 0;
    for (const key of keys) {
      for (let run = 0; run < 25; run++) {
        const rendered = message(catalog, key, value, pick);
        const localized = catalog.localize(rendered.english);
        if (localized !== rendered.english) expect(localized, `${key}: ${rendered.english}`).toBe(rendered.german);
        if (localized === rendered.german) translated++;
      }
    }
    expect(translated).toBeGreaterThan(keys.length * 25 * 0.8);
  });
});
