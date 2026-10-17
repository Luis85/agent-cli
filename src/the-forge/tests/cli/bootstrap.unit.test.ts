import { describe, expect, it } from 'vitest';
import { parseBootstrap } from '../../src/presentation/cli/arguments.ts';

describe('prefix-only command bootstrap', () => {
  it('resolves routing options before the command and preserves its complete tail', () => {
    const tail = ['make', 'document', 'Plan', '--template', 'entity.md', '--dry-run'];
    expect(parseBootstrap(['--root', 'my project', '--no-plugins', '--json', ...tail])).toEqual({
      args: tail,
      flags: { root: 'my project', 'no-plugins': true, json: true },
    });
  });

  it.each(['--no-dry-run', '--dry-run', '--config', '--version', '--help', '--json'])('never interprets the command token %s after the command as a bootstrap option', literal => {
    const tail = ['create', 'note.md', '--content', literal];
    expect(parseBootstrap(['--root', '/workspace/project', ...tail])).toEqual({
      args: tail,
      flags: { root: '/workspace/project' },
    });
  });

  it('does not treat opposite-looking tail tokens as contradictory prefix options', () => {
    const tail = ['create', 'note.md', '--content', '--no-dry-run'];
    expect(parseBootstrap(['--dry-run', ...tail])).toEqual({ args: tail, flags: { 'dry-run': true } });
  });

  it('reads routing options after the command, before --, and keeps the complete tail for the command parse', () => {
    const tail = ['read', 'note.md', '--root', '/different', '--config', 'different.json', '--no-plugins'];
    expect(parseBootstrap(tail)).toEqual({ args: tail, flags: { root: '/different', 'no-plugins': true } });
    expect(parseBootstrap(['read', '--root=/inline', 'note.md'])).toEqual({ args: ['read', '--root=/inline', 'note.md'], flags: { root: '/inline' } });
    expect(parseBootstrap(['write', 'a.md', '--', '--root', '/data', '--no-plugins'])).toEqual({ args: ['write', 'a.md', '--', '--root', '/data', '--no-plugins'], flags: {} });
    expect(parseBootstrap(['--', 'read', '--root', '/data'])).toEqual({ args: ['read', '--root', '/data'], flags: {} });
  });

  it('rejects routing options after the command that repeat, miss or swallow a value', () => {
    expect(() => parseBootstrap(['--root', '/a', 'read', 'x.md', '--root', '/b'])).toThrow(expect.objectContaining({ code: 'DUPLICATE_OPTION' }));
    expect(() => parseBootstrap(['read', 'x.md', '--root'])).toThrow(expect.objectContaining({ code: 'MISSING_ARGUMENT' }));
    expect(() => parseBootstrap(['read', 'x.md', '--root', '--json'])).toThrow(expect.objectContaining({ code: 'MISSING_ARGUMENT', details: { option: 'root', next: '--json' } }));
  });

  it('leaves plugin options and values untouched until their descriptor is loaded', () => {
    const tail = ['quality.check', '--label', '--config', '--custom', 'text'];
    expect(parseBootstrap(['--no-plugins', ...tail])).toEqual({ args: tail, flags: { 'no-plugins': true } });
  });

  it.each([
    ['project', 'open', 'alpha', '--dry-run'],
    ['project', 'current'],
    ['project', 'close', '--dry-run'],
    ['project', 'component', 'WorkItem', '--kind', 'domain'],
  ])('preserves project context actions after workspace routing: %j', (...tail) => {
    expect(parseBootstrap(['--root', '/workspace/forge', ...tail])).toEqual({
      args: tail,
      flags: { root: '/workspace/forge' },
    });
  });

  it('preserves option-looking prefix string values', () => {
    expect(parseBootstrap(['--root=--dry-run', 'schema'])).toEqual({ args: ['schema'], flags: { root: '--dry-run' } });
  });

  it('supports an empty invocation and standalone discovery aliases', () => {
    expect(parseBootstrap([])).toEqual({ args: [], flags: {} });
    expect(parseBootstrap(['-h'])).toEqual({ args: [], flags: { help: true } });
    expect(parseBootstrap(['-V'])).toEqual({ args: [], flags: { version: true } });
  });

  it('rejects malformed and contradictory prefix options before routing', () => {
    expect(() => parseBootstrap(['--root'])).toThrow(expect.objectContaining({ code: 'MISSING_ARGUMENT' }));
    expect(() => parseBootstrap(['--json', '--no-json', 'schema'])).toThrow(expect.objectContaining({ code: 'DUPLICATE_OPTION' }));
    expect(() => parseBootstrap(['--root', 'a', '--root', 'b', 'schema'])).toThrow(expect.objectContaining({ code: 'DUPLICATE_OPTION' }));
    expect(() => parseBootstrap(['--config', 'custom.json'])).toThrow(expect.objectContaining({ code: 'UNKNOWN_OPTION' }));
    expect(() => parseBootstrap(['--unknown', 'schema'])).toThrow(expect.objectContaining({ code: 'UNKNOWN_OPTION' }));
  });
});
