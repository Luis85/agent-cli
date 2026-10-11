import { describe, expect, it } from 'vitest';
import { globalOptions } from '../../src/application/plugins/command-input.ts';
import { ensureDeclaredValues, parseArguments } from '../../src/presentation/cli/arguments.ts';
import { option } from '../../src/application/plugins/command-metadata.ts';
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
  it('enforces declared enum and required options with their own codes and details', () => {
    const options = { kind: option.string('Kind.', { enum: ['rest', 'json'] }), template: option.string('Template.', { required: true }), quiet: option.boolean('Quiet.') };
    expect(() => ensureDeclaredValues(options, { template: 'a.md', kind: 'json', quiet: true })).not.toThrow();
    expect(() => ensureDeclaredValues(options, { kind: 'rest' })).toThrowError(expect.objectContaining({ code: 'MISSING_ARGUMENT', message: '--template is required.', details: { option: 'template' } }));
    expect(() => ensureDeclaredValues(options, { template: 'a.md', kind: 'xml' })).toThrowError(expect.objectContaining({
      code: 'INVALID_OPTION_VALUE', message: '--kind must be one of: rest, json.', details: { option: 'kind', value: 'xml', allowed: ['rest', 'json'] },
    }));
  });
  it('checks every item of a comma-separated list option against its enum', () => {
    const options = { parts: option.string('Parts.', { enum: ['body', 'links'], list: true }) };
    // Whitespace around an item is ignored, as in --parts "body, links"; an empty item is not a value.
    for (const parts of ['links,body,links', 'body, links', ' body ,links ']) expect(() => ensureDeclaredValues(options, { parts }), parts).not.toThrow();
    for (const parts of ['body,', 'body, ,links', 'nope', 'bo dy']) {
      expect(() => ensureDeclaredValues(options, { parts }), parts).toThrowError(expect.objectContaining({
        code: 'INVALID_OPTION_VALUE', message: '--parts must be a comma-separated list of: body, links.', details: { option: 'parts', value: parts, allowed: ['body', 'links'] },
      }));
    }
  });
});
