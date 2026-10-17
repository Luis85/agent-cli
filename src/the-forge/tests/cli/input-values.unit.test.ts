import { describe, expect, it } from 'vitest';
import { maximumWaitMs, parseJson, waitBudget } from '../../src/application/plugins/command-input.ts';
import { base64Bytes } from '../../src/domain/documents/base64.ts';

describe('input values agents produce on other platforms', () => {
  it('parses JSON after a leading UTF-8 byte order mark, and only there', () => {
    expect(parseJson('﻿{"op":"write"}')).toEqual({ op: 'write' });
    expect(parseJson('﻿[1]')).toEqual([1]);
    expect(() => parseJson('[1]﻿')).toThrowError(expect.objectContaining({ code: 'INVALID_JSON' }));
    expect(() => parseJson('﻿﻿[1]')).toThrowError(expect.objectContaining({ code: 'INVALID_JSON' }));
  });

  it('decodes wrapped base64 like the same text on one line', () => {
    const bytes = Uint8Array.from({ length: 200 }, (_, index) => (index * 37) % 256);
    const line = Buffer.from(bytes).toString('base64');
    const wrapped = `${line.match(/.{1,76}/g)!.join('\n')}\n`;
    expect(base64Bytes(wrapped, 'bad')).toEqual(bytes);
    expect(base64Bytes(line.replace(/(.{60})/g, '$1\r\n\t '), 'bad')).toEqual(bytes);
    expect(base64Bytes(line, 'bad')).toEqual(bytes);
    for (const invalid of ['abc', 'ab=c', 'YQ==YQ==', 'Y Q==', 'YQ-_']) expect(() => base64Bytes(invalid, 'bad'), invalid).toThrowError(expect.objectContaining({ code: 'INVALID_ENCODING', message: 'bad' }));
  });

  it('reads the global --wait budget in milliseconds', () => {
    expect(waitBudget({})).toBe(0);
    expect(waitBudget({ wait: '1500' })).toBe(1500);
    expect(waitBudget({ wait: String(maximumWaitMs) })).toBe(600_000);
    for (const wait of ['-1', '1.5', 'soon', '', String(maximumWaitMs + 1)]) expect(() => waitBudget({ wait }), wait).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});
