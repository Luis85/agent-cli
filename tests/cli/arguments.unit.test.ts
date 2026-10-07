import { describe, expect, it } from 'vitest';
import { globalOptions, parseArguments } from '../../src/the-forge/presentation/cli/arguments.ts';
describe('Commander integration', () => {
  it('parses aliases, global flags and command values without altering literal values', () => {
    expect(parseArguments(['--root', 'my project', 'write', 'note.md', '--content=--literal', '--json'], { ...globalOptions, content: 'string' })).toEqual({ args: ['write', 'note.md'], flags: { root: 'my project', content: '--literal', json: true } });
    expect(parseArguments(['-h'], globalOptions).flags.help).toBe(true);
    expect(parseArguments(['-V'], globalOptions).flags.version).toBe(true);
  });
  it('keeps bootstrap command operands and resolves boolean overrides', () => {
    const boot = parseArguments(['make', 'entity', 'WorkItem', '--out', 'src/domain', '--no-json', '--no-dry-run', '--no-plugins'], globalOptions, true);
    expect(boot.args[0]).toBe('make');
    expect(boot.flags).toEqual({ 'no-json': true, 'no-dry-run': true, 'no-plugins': true });
    expect(parseArguments(['read', '--', '--root'], globalOptions)).toEqual({ args: ['read', '--root'], flags: {} });
  });
  it.each(['--constructor', '--toString', '--__proto__', '--wat'])('rejects unregistered option %s', option => {
    expect(() => parseArguments(['read', 'x.md', option, 'value'], globalOptions)).toThrowError(/unknown option/);
  });
  it('rejects repeated options, contradictory booleans and missing values', () => {
    expect(() => parseArguments(['--json', '--json'], globalOptions)).toThrow(/Repeated/);
    expect(() => parseArguments(['--json', '--no-json'], globalOptions)).toThrow(/contradictory/);
    expect(() => parseArguments(['--root'], globalOptions)).toThrow(/argument missing/);
  });
  it('preserves string options beginning with no- independently of their positive names', () => {
    const options = { label: 'string', 'no-label': 'string', 'no-cache': 'boolean' } as const;
    expect(parseArguments(['--label', 'included', '--no-label', '--literal', '--no-cache'], options)).toEqual({
      args: [], flags: { label: 'included', 'no-label': '--literal', 'no-cache': true },
    });
    expect(() => parseArguments(['--no-label', 'first', '--no-label', 'second'], options)).toThrow(/Repeated/);
    expect(() => parseArguments(['--no-label'], options)).toThrow(/argument missing/);
  });
});
