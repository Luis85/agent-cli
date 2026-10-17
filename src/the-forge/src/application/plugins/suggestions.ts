/**
 * Did-you-mean suggestions for an unknown command, action or option: close spellings by edit distance, plus the
 * names agents bring from shells and other CLIs (`ls`, `cat`, `rm`, `--force`). Every suggestion is a registered
 * id or an accepted option, so following it never trades one unknown name for another.
 */

/** Shell and CLI habits mapped to the command or global option that does the job. */
const commandSynonyms: Readonly<Record<string, readonly string[]>> = {
  ls: ['list'], dir: ['list'], cat: ['read'], show: ['read'], view: ['read'], get: ['read'], head: ['read'],
  grep: ['search'], find: ['search'], rg: ['search'], mv: ['move'], ren: ['rename'], rm: ['delete'], del: ['delete'],
  remove: ['delete'], unlink: ['delete'], touch: ['create'], new: ['create'], cp: ['read', 'create'], copy: ['read', 'create'],
  info: ['stat'], version: ['--version'],
};
/** Option habits: previews are dry runs, and Forge replaces a file only against its revision, never by force. */
const optionSynonyms: Readonly<Record<string, readonly string[]>> = {
  v: ['--version'], preview: ['--dry-run'], 'what-if': ['--dry-run'], simulate: ['--dry-run'], noop: ['--dry-run'],
  force: ['--if-match'], f: ['--if-match'], yes: ['--if-match'], y: ['--if-match'], overwrite: ['--if-match'],
};
/** The unknown names that ask to bypass the revision guard; guidance explains `--if-match` for them. */
export const forceOptions: readonly string[] = ['--force', '-f', '--yes', '-y', '--overwrite'];
/** The unknown commands that ask for a copy, which Forge does as a read followed by a create. */
export const copyCommands: readonly string[] = ['cp', 'copy'];
const maximumSuggestions = 3;

/** Edit distance counting insertions, deletions, substitutions and swaps of adjacent characters. */
function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      let cost = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cost = Math.min(cost, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = cost;
    }
  }
  return rows[a.length]![b.length]!;
}

/**
 * The candidates closest to `input`, ignoring case: those within a third of its length in edits (at least one), or
 * that it begins, nearest first and then in candidate order, at most three.
 */
function closest(input: string, candidates: readonly string[]): string[] {
  const wanted = input.toLowerCase(), limit = Math.max(1, Math.floor(wanted.length / 3));
  return candidates
    .map((candidate, order) => ({ candidate, order, score: wanted.length >= 2 && candidate.toLowerCase().startsWith(wanted) ? 0 : editDistance(wanted, candidate.toLowerCase()) }))
    .filter(entry => entry.score <= limit)
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, maximumSuggestions).map(entry => entry.candidate);
}

/** Synonyms first, then close spellings, each once and only when `accepted` holds. */
function merged(synonyms: readonly string[] | undefined, spelled: readonly string[], accepted: (suggestion: string) => boolean): string[] {
  return [...new Set([...(synonyms ?? []), ...spelled])].filter(accepted).slice(0, maximumSuggestions);
}

/** Suggestions for an unknown command id among the registered `ids`; `version` is answered with `--version`. */
export function commandSuggestions(id: string, ids: readonly string[]): string[] {
  const known = new Set(ids);
  const synonyms = Object.hasOwn(commandSynonyms, id.toLowerCase()) ? commandSynonyms[id.toLowerCase()] : undefined;
  return merged(synonyms, closest(id, ids), suggestion => known.has(suggestion) || suggestion === '--version');
}

/** Suggestions for an unknown action of a command among its declared `actions`. */
export function actionSuggestions(action: string, actions: readonly string[]): string[] {
  return closest(action, actions);
}

/**
 * Suggestions for an unknown option token (`--secton`, `-y`) among the option names the invocation `accepts`,
 * written as flags. A command option is never answered with an option the command cannot take.
 */
export function optionSuggestions(token: string, accepts: readonly string[]): string[] {
  const name = token.replace(/^-+/, '').split('=')[0]!;
  const flags = accepts.map(option => `--${option}`), known = new Set(flags);
  const key = name.toLowerCase();
  const synonyms = Object.hasOwn(optionSynonyms, key) ? optionSynonyms[key] : undefined;
  return merged(synonyms, closest(name, accepts).map(option => `--${option}`), suggestion => known.has(suggestion));
}
