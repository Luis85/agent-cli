import { describe, expect, it } from 'vitest';
import { acceptsType, inferPropertyType, propertyTypes, typeRegistry, type PropertyType } from '../../src/plugins/vault-check/domain/property-types.ts';

describe('property value types', () => {
  it('names the Obsidian property types plus object', () => {
    expect(propertyTypes).toStrictEqual(['text', 'list', 'number', 'checkbox', 'date', 'datetime', 'object']);
  });

  it.each([
    [null, null], [undefined, null], ['', null], ['draft', 'text'], [' ', 'text'], [0, 'number'], [3.5, 'number'], [false, 'checkbox'], [true, 'checkbox'],
    [[], 'list'], [['a'], 'list'], [{}, 'object'], [{ a: 1 }, 'object'],
  ])('infers %j as %s', (value, type) => {
    expect(inferPropertyType(value)).toBe(type);
  });

  it.each([
    '2024-05-01T10:30', '2024-05-01 10:30', '2024-05-01T10:30:00', '2024-05-01T10:30:00.5', '2024-05-01T10:30:00.123456789',
    '2024-05-01T10:30Z', '2024-05-01T10:30:00Z', '2024-05-01T10:30+02:00', '2024-05-01T10:30-0200', '2024-05-01T10:30:00.123+05:30',
  ])('reads %s as a date and time', value => {
    expect(inferPropertyType(value)).toBe('datetime');
  });

  it.each(['2024-05-01', '0000-00-00'])('reads %s as a date', value => {
    expect(inferPropertyType(value)).toBe('date');
  });

  it.each([
    'x2024-05-01', '2024-05-01x', '24-05-01', '2024-5-1', '2024-05-1', '2024-05-01T', 'x2024-05-01T10:30', '2024-05-01T10:30x', '2024-05-01X10:30',
    '2024-05-01T1:30', '2024-05-01T10:3', '2024-05-01T10:30:0', '2024-05-01T10:30:00.', '2024-05-01T10:30:00.ab', '2024-05-01T10:30:00.1234567890',
    '2024-05-01T10:30+2:00', '2024-05-01T10:30+02:0', '2024-05-01T10:30+020', '2024-05-01T10:30*02:00', '2024-05-01T10:30+ab:cd',
    '2024-05-01T10:30+02:ab', '2024-05-01T10:30+02::00', '2024-05-01T10:30z',
  ])('reads %s as text', value => {
    expect(inferPropertyType(value)).toBe('text');
  });
});

describe('declared property types', () => {
  /** The inferred types each `.obsidian/types.json` type accepts. */
  const accepted: Array<[string, PropertyType[]]> = [
    ['text', ['text', 'date', 'datetime']],
    ['multitext', ['list']],
    ['tags', ['list', 'text']],
    ['aliases', ['list', 'text']],
    ['number', ['number']],
    ['checkbox', ['checkbox']],
    ['date', ['date']],
    ['datetime', ['datetime', 'date']],
  ];

  it.each(accepted.flatMap(([declared, types]) => propertyTypes.map(actual => [declared, actual, types.includes(actual)] as const)))(
    'a value declared %s accepts a %s value: %s', (declared, actual, accepts) => {
      expect(acceptsType(declared, actual)).toBe(accepts);
    });

  it.each(propertyTypes)('an unknown declared type accepts a %s value', actual => {
    expect(acceptsType('rating', actual)).toBe(true);
  });

  it.each(['toString', 'constructor', '__proto__', 'hasOwnProperty'])('treats the declared type %s, an Object member name, as unknown', declared => {
    for (const actual of propertyTypes) expect(acceptsType(declared, actual)).toBe(true);
  });
});

describe('.obsidian/types.json', () => {
  it.each([
    [null, { status: 'missing', types: {} }],
    ['\uFEFF{"types":{"status":"text","n":3,"due":"date"}}', { status: 'loaded', types: { status: 'text', due: 'date' } }],
    ['{"types":{"mark":"x\uFEFF"}}', { status: 'loaded', types: { mark: 'x\uFEFF' } }],
    ['{"types":{}}', { status: 'loaded', types: {} }],
    ['{oops', { status: 'invalid', types: {}, reason: 'json' }],
    ['', { status: 'invalid', types: {}, reason: 'json' }],
    ['{"status":"text"}', { status: 'invalid', types: {}, reason: 'shape' }],
    ['{"types":["text"]}', { status: 'invalid', types: {}, reason: 'shape' }],
    ['{"types":"text"}', { status: 'invalid', types: {}, reason: 'shape' }],
    ['{"types":null}', { status: 'invalid', types: {}, reason: 'shape' }],
    ['[{"types":{}}]', { status: 'invalid', types: {}, reason: 'shape' }],
    ['null', { status: 'invalid', types: {}, reason: 'shape' }],
  ])('reads %j', (text, registry) => {
    expect(typeRegistry(text)).toStrictEqual(registry);
  });
});
