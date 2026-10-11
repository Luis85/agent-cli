import type { Loc, Pos } from '../../domain/metadata/cache.ts';

/** Converts offsets in one decoded text into zero-based line/column locations. `\r\n`, `\n` and `\r` end lines. */
export class LineMap {
  private readonly starts: number[] = [0];

  constructor(readonly text: string) {
    for (let index = 0; index < text.length; index++) {
      const character = text[index];
      if (character === '\r' && text[index + 1] === '\n') index++;
      if (character === '\n' || character === '\r') this.starts.push(index + 1);
    }
  }

  line(offset: number): number {
    let low = 0, high = this.starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.starts[middle]! <= offset) low = middle; else high = middle - 1;
    }
    return low;
  }

  lineStart(line: number): number { return this.starts[line] ?? this.text.length; }

  /** The offset where a line's content ends, before its line break. */
  lineEnd(line: number): number {
    const next = this.starts[line + 1];
    if (next === undefined) return this.text.length;
    return this.text[next - 2] === '\r' && this.text[next - 1] === '\n' ? next - 2 : next - 1;
  }

  loc(offset: number): Loc {
    const line = this.line(offset);
    return { line, col: offset - this.starts[line]!, offset };
  }

  pos(start: number, end: number): Pos { return { start: this.loc(start), end: this.loc(end) }; }
}
