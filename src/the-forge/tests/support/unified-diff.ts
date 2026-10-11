/** Independent strict applier for unified diffs produced by dry-run previews. */
export function applyUnifiedDiff(before: string, diff: string): string {
  if (diff === '') return before;
  const source = before === '' ? [] : before.split(/(?<=\n)/);
  const patch = diff.split(/(?<=\n)/);
  if (!/^--- (?:\/dev\/null|a\/.+)\n$/.test(patch[0] ?? '') || !/^\+\+\+ b\/.+\n$/.test(patch[1] ?? '')) throw new Error('Missing unified diff file headers.');
  const output: string[] = [];
  let index = 2, cursor = 0;
  while (index < patch.length) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@\n$/.exec(patch[index]!);
    if (!header) throw new Error(`Invalid hunk header: ${patch[index]}`);
    const oldStart = Number(header[1]), oldCount = header[2] === undefined ? 1 : Number(header[2]);
    const newCount = header[4] === undefined ? 1 : Number(header[4]);
    const start = oldCount === 0 ? oldStart : oldStart - 1;
    if (start < cursor) throw new Error('Overlapping hunks.');
    output.push(...source.slice(cursor, start));
    cursor = start; index++;
    let removed = 0, added = 0;
    while (index < patch.length && !patch[index]!.startsWith('@@')) {
      const line = patch[index]!, type = line[0];
      if (type !== ' ' && type !== '-' && type !== '+') throw new Error(`Invalid diff line: ${line}`);
      let text = line.slice(1);
      if (patch[index + 1] === '\\ No newline at end of file\n') { text = text.slice(0, -1); index++; }
      index++;
      if (type !== '+') {
        if (source[cursor] !== text) throw new Error(`Context mismatch at line ${cursor + 1}.`);
        cursor++; removed++;
      }
      if (type !== '-') { output.push(text); added++; }
    }
    if (removed !== oldCount || added !== newCount) throw new Error('Hunk length does not match its header.');
  }
  return [...output, ...source.slice(cursor)].join('');
}
