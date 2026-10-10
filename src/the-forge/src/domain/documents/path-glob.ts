import { ensure } from '../shared/errors.ts';

const special = /[.*+?^${}()|[\]\\/]/g;
const literal = (text: string) => text.replace(special, '\\$&');

// A `[...]` class starting at `start`, as a regular-expression class that never matches `/`; undefined when unclosed.
function characterClass(pattern: string, start: number): { source: string; end: number } | undefined {
  let index = start + 1;
  const negated = pattern[index] === '!' || pattern[index] === '^';
  if (negated) index++;
  const first = index;
  while (index < pattern.length && (pattern[index] !== ']' || index === first)) index++;
  if (index >= pattern.length) return undefined;
  const members = pattern.slice(first, index).replace(/[\\\]^[]/g, '\\$&');
  return { source: negated ? `(?!/)[^${members}]` : `(?!/)[${members}]`, end: index };
}

/**
 * Compiles a path glob matched against the whole root-relative vault path, case-sensitively:
 * `*` matches within one path segment, `?` one character other than `/`, `**` as a whole segment any number of
 * segments (`notes/**` matches everything below `notes`), `[abc]`, `[a-z]` and `[!abc]` one character of a class,
 * `{a,b}` either alternative, and `\` escapes the next character. A leading `./` is ignored. Malformed globs are
 * INVALID_ARGUMENT.
 */
export function pathGlob(pattern: string, option = '--path'): (path: string) => boolean {
  ensure(pattern.length > 0 && pattern.length <= 1024, 'INVALID_ARGUMENT', `${option} must be a glob of 1 to 1024 characters.`);
  const source = pattern.replace(/^\.\//, '');
  let regex = '', braces = 0;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (char === '\\') {
      ensure(index + 1 < source.length, 'INVALID_ARGUMENT', `${option} ends with an unescaped backslash.`);
      regex += literal(source[++index]!);
    } else if (char === '*') {
      let end = index;
      while (source[end + 1] === '*') end++;
      const segmentStart = index === 0 || source[index - 1] === '/';
      const globstar = end > index && segmentStart && (end + 1 === source.length || source[end + 1] === '/');
      if (globstar && source[end + 1] === '/') { regex += '(?:.*/)?'; end++; }
      else regex += globstar ? '.*' : '[^/]*';
      index = end;
    } else if (char === '?') regex += '[^/]';
    else if (char === '[') {
      const range = characterClass(source, index);
      if (range) { regex += range.source; index = range.end; } else regex += '\\[';
    } else if (char === '{') { braces++; regex += '(?:'; }
    else if (char === ',' && braces > 0) regex += '|';
    else if (char === '}' && braces > 0) { braces--; regex += ')'; }
    else regex += literal(char);
  }
  ensure(braces === 0, 'INVALID_ARGUMENT', `${option} has an unclosed {.`);
  const expression = new RegExp(`^${regex}$`, 's');
  return path => expression.test(path);
}
