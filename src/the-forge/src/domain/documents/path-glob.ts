import { ensure, forgeError } from '../shared/errors.ts';

/** One unit of a glob segment: a literal character, `?`, `*` or a `[...]` class. */
type Atom =
  | { kind: 'char'; value: string }
  | { kind: 'any' }
  | { kind: 'star' }
  | { kind: 'class'; negated: boolean; ranges: Array<readonly [string, string]> };
/** Lexical tokens: atoms, brace structure and the `/` separator. */
type Slash = { kind: 'slash' };
type Token = Atom | Slash | { kind: 'open' } | { kind: 'comma' } | { kind: 'close' };
/** A segment matches one path segment, or any number of them as a `**` globstar. */
type Segment = { globstar: true } | { globstar: false; atoms: Atom[] };

/** Brace expansion stops here, so `{a,b}{c,d}…` cannot multiply into an unbounded number of patterns. */
const maxGlobExpansions = 256;
const maxGlobLength = 1024;

/** Code points, so a class range and `?` treat a character outside the BMP as one character. */
const characters = (text: string) => Array.from(text);

/**
 * A `[...]` class starting at `start`: `!` or `^` negates it, a leading `]` is a member, `a-z` is a range, and `\`
 * escapes the next character. Undefined when the class is unclosed, so a lone `[` stays literal.
 */
function characterClass(pattern: readonly string[], start: number, fail: (message: string) => never): { atom: Atom; end: number } | undefined {
  let index = start + 1;
  const negated = pattern[index] === '!' || pattern[index] === '^';
  if (negated) index++;
  const members: string[] = [], escaped: boolean[] = [];
  const first = index;
  for (; index < pattern.length; index++) {
    const char = pattern[index]!;
    if (char === ']' && index > first) break;
    if (char === '\\') {
      if (index + 1 >= pattern.length) return undefined;
      members.push(pattern[++index]!); escaped.push(true);
    } else { members.push(char); escaped.push(false); }
  }
  if (index >= pattern.length) return undefined;
  const ranges: Array<readonly [string, string]> = [];
  for (let member = 0; member < members.length; member++) {
    const from = members[member]!;
    const range = members[member + 1] === '-' && !escaped[member + 1] && member + 2 < members.length;
    if (!range) { ranges.push([from, from]); continue; }
    const to = members[member + 2]!;
    if (from.codePointAt(0)! > to.codePointAt(0)!) fail(`has the reversed class range [${from}-${to}].`);
    ranges.push([from, to]);
    member += 2;
  }
  return { atom: { kind: 'class', negated, ranges }, end: index };
}

function tokenize(pattern: readonly string[], fail: (message: string) => never): Token[] {
  const tokens: Token[] = [];
  let depth = 0;
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!;
    if (char === '\\') {
      if (index + 1 >= pattern.length) fail('ends with an unescaped backslash.');
      tokens.push({ kind: 'char', value: pattern[++index]! });
    } else if (char === '*') tokens.push({ kind: 'star' });
    else if (char === '?') tokens.push({ kind: 'any' });
    else if (char === '/') tokens.push({ kind: 'slash' });
    else if (char === '[') {
      const parsed = characterClass(pattern, index, fail);
      if (parsed) { tokens.push(parsed.atom); index = parsed.end; } else tokens.push({ kind: 'char', value: char });
    } else if (char === '{') { depth++; tokens.push({ kind: 'open' }); }
    else if (char === ',' && depth > 0) tokens.push({ kind: 'comma' });
    else if (char === '}' && depth > 0) { depth--; tokens.push({ kind: 'close' }); }
    else tokens.push({ kind: 'char', value: char });
  }
  if (depth > 0) fail('has an unclosed {.');
  return tokens;
}

type Atoms = Array<Atom | Slash>;

/** Expands `{a,b}` alternatives (nested included) into plain token sequences, at most `maxGlobExpansions`. */
function expand(tokens: readonly Token[], fail: (message: string) => never): Atoms[] {
  let position = 0;
  const product = (left: Atoms[], right: Atoms[]) => {
    if (left.length * right.length > maxGlobExpansions) fail(`expands to more than ${maxGlobExpansions} alternatives.`);
    return left.flatMap(prefix => right.map(suffix => [...prefix, ...suffix]));
  };
  // A sequence runs until a comma or close brace of the enclosing group.
  const sequence = (): Atoms[] => {
    let results: Atoms[] = [[]];
    while (position < tokens.length) {
      const token = tokens[position]!;
      if (token.kind === 'comma' || token.kind === 'close') break;
      position++;
      if (token.kind !== 'open') { results = results.map(result => [...result, token]); continue; }
      const alternatives: Atoms[] = [];
      for (;;) {
        alternatives.push(...sequence());
        if (alternatives.length > maxGlobExpansions) fail(`expands to more than ${maxGlobExpansions} alternatives.`);
        const next = tokens[position++]!;
        if (next.kind === 'close') break;
      }
      results = product(results, alternatives);
    }
    return results;
  };
  return sequence();
}

/** Splits a token sequence at `/`; a segment of two or more unescaped `*` and nothing else is a globstar. */
function segments(atoms: Atoms): Segment[] {
  const result: Segment[] = [];
  let current: Atom[] = [];
  const close = () => {
    const globstar = current.length >= 2 && current.every(atom => atom.kind === 'star');
    result.push(globstar ? { globstar: true } : { globstar: false, atoms: current });
    current = [];
  };
  for (const atom of atoms) {
    if (atom.kind === 'slash') close(); else current.push(atom);
  }
  close();
  return result;
}

function atomMatches(atom: Atom, char: string): boolean {
  if (atom.kind === 'any') return true;
  if (atom.kind === 'char') return atom.value === char;
  if (atom.kind === 'star') return false;
  const code = char.codePointAt(0)!;
  const member = atom.ranges.some(([from, to]) => code >= from.codePointAt(0)! && code <= to.codePointAt(0)!);
  return member !== atom.negated;
}

/**
 * Matches one path segment in O(atoms × characters): every atom but `*` consumes exactly one character, so on a
 * mismatch it is enough to let the most recent `*` absorb one more character and retry from there.
 */
function segmentMatches(atoms: readonly Atom[], text: readonly string[]): boolean {
  let atom = 0, char = 0, star = -1, resume = 0;
  while (char < text.length) {
    if (atom < atoms.length && atoms[atom]!.kind === 'star') { star = atom++; resume = char; }
    else if (atom < atoms.length && atomMatches(atoms[atom]!, text[char]!)) { atom++; char++; }
    else if (star >= 0) { atom = star + 1; char = ++resume; }
    else return false;
  }
  while (atom < atoms.length && atoms[atom]!.kind === 'star') atom++;
  return atom === atoms.length;
}

/**
 * Matches the segments of a path with memoized dynamic programming over (pattern segment, path segment), so
 * several globstars cost O(pattern segments × path segments) segment matches. A globstar followed by more
 * segments matches zero or more path segments; a trailing globstar matches one or more (everything below).
 */
function pathMatches(pattern: readonly Segment[], path: ReadonlyArray<readonly string[]>): boolean {
  const memo = new Map<number, boolean>();
  const visit = (segment: number, part: number): boolean => {
    const key = segment * (path.length + 1) + part;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let result: boolean;
    if (segment === pattern.length) result = part === path.length;
    else {
      const current = pattern[segment]!;
      if (current.globstar) {
        if (segment === pattern.length - 1) result = part < path.length;
        else {
          result = false;
          for (let skip = part; !result && skip <= path.length; skip++) result = visit(segment + 1, skip);
        }
      } else result = part < path.length && segmentMatches(current.atoms, path[part]!) && visit(segment + 1, part + 1);
    }
    memo.set(key, result);
    return result;
  };
  return visit(0, 0);
}

/**
 * Compiles a path glob matched against the whole root-relative vault path, case-sensitively: `*` matches within one
 * path segment, `?` one character other than `/`, `**` as a whole segment any number of segments (`notes/**`
 * matches everything below `notes`), `[abc]`, `[a-z]` and `[!abc]` one character of a class, `{a,b}` either
 * alternative (at most 256 expansions), and `\` escapes the next character, inside classes too. A leading `./` is
 * ignored. Matching takes time polynomial in the glob and path lengths, never exponential. Malformed globs are
 * INVALID_ARGUMENT, naming `option`.
 */
export function pathGlob(pattern: string, option = '--path'): (path: string) => boolean {
  const fail = (message: string): never => { throw forgeError('INVALID_ARGUMENT', `${option} ${message}`); };
  ensure(pattern.length > 0 && pattern.length <= maxGlobLength, 'INVALID_ARGUMENT', `${option} must be a glob of 1 to ${maxGlobLength} characters.`);
  const alternatives = expand(tokenize(characters(pattern.replace(/^\.\//, '')), fail), fail).map(segments);
  return path => {
    const parts = path.split('/').map(characters);
    return alternatives.some(alternative => pathMatches(alternative, parts));
  };
}
