import { beforeAll, describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { errorCodes } from '../../src/domain/shared/error-catalog.ts';
import { globalOptionMetadata } from '../../src/presentation/cli/arguments.ts';
import type { Registry } from '../../src/application/plugins/registry.ts';
import { bundledCorePlugins } from '../support/core-plugins.ts';
import { fullRegistry } from '../support/full-registry.ts';

/**
 * The reference documentation agrees with the installed contracts: every command, generator, option, error code,
 * core plugin and plugin setting the registry declares has its row or mention, and no row names an unknown one.
 */
let registry: Registry;
let reference: Record<string, string>;
beforeAll(async () => {
  registry = await fullRegistry();
  const files = (await readdir('docs/reference')).filter(file => file.endsWith('.md'));
  reference = Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(`docs/reference/${file}`, 'utf8')] as const)));
});

/** The lines of one Markdown section, from its heading to the next heading of the same or a higher level. */
function section(text: string, heading: string): string[] {
  const lines = text.split('\n'), start = lines.findIndex(line => line.replace(/^#+ /, '') === heading && line.startsWith('#'));
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const level = lines[start]!.indexOf(' ');
  const end = lines.findIndex((line, index) => index > start && /^#+ /.test(line) && line.indexOf(' ') <= level);
  return lines.slice(start + 1, end === -1 ? undefined : end);
}
/** The first backticked cell of every row of the section's first table. */
function firstCells(lines: readonly string[]): string[] {
  const start = lines.findIndex(line => line.startsWith('|')), end = lines.findIndex((line, index) => index > start && !line.startsWith('|'));
  return lines.slice(start, end === -1 ? undefined : end).flatMap(line => /^\| `([^`]+)` \|/.exec(line)?.[1] ?? []);
}

describe('reference documentation consistency', () => {
  it('gives every command a row in the CLI command table and every generator its own make row', () => {
    const rows = firstCells(section(reference['cli.md']!, 'Commands'));
    const commandIds = [...registry.commands.keys()];
    expect(commandIds.filter(id => !rows.some(row => row.split(' ')[0] === id))).toEqual([]);
    expect(rows.filter(row => !commandIds.includes(row.split(' ')[0]!))).toEqual([]);
    expect([...registry.generators.keys()].filter(id => !rows.includes(`make ${id}`))).toEqual([]);
  });

  it('documents every option of every command and every global option in the reference pages', () => {
    const text = Object.values(reference).join('\n');
    const mentioned = (name: string) => new RegExp(`--${name}(?![a-z-])`).test(text);
    const options = [...registry.commands.values()].flatMap(command => [
      ...Object.keys(command.options ?? {}).map(name => `${command.id} --${name}`),
      ...Object.entries(command.actions ?? {}).flatMap(([action, definition]) => Object.keys(definition.options ?? {}).map(name => `${command.id} ${action} --${name}`)),
    ]);
    expect(options.filter(entry => !mentioned(entry.split('--')[1]!))).toEqual([]);
    expect(Object.keys(globalOptionMetadata).filter(name => !mentioned(name))).toEqual([]);
  });

  it('gives every built-in and plugin error code exactly one row in the error reference', () => {
    const rows = reference['errors.md']!.split('\n').flatMap(line => /^\| `([A-Z][A-Z0-9_]+)` \|/.exec(line)?.[1] ?? []);
    const codes = [...errorCodes, ...registry.catalog.errors().map(entry => entry.code)];
    expect(codes.filter(code => rows.filter(row => row === code).length !== 1)).toEqual([]);
    expect(rows.filter(row => !codes.includes(row))).toEqual([]);
  });

  it('lists the bundled core plugins in bundle order', () => {
    const rows = firstCells(section(reference['plugins.md']!, 'Bundled core plugins'));
    expect(rows).toEqual([...bundledCorePlugins]);
    expect(registry.plugins.filter(plugin => registry.origins.get(plugin.manifest.id) === 'core').map(plugin => plugin.manifest.id)).toEqual([...bundledCorePlugins]);
  });

  it('documents every core plugin setting with its default in the configuration reference', () => {
    const rows = section(reference['configuration.md']!, 'Core plugin settings').flatMap(line => {
      const cells = /^\| `([a-z-]+)` \| (?:`([A-Za-z]+)`|none) \|/.exec(line);
      return cells ? [`${cells[1]}.${cells[2] ?? ''}`] : [];
    });
    expect(bundledCorePlugins.filter(id => !rows.some(row => row.startsWith(`${id}.`)))).toEqual([]);
    const declared = registry.settings.sections().flatMap(({ plugin, schema }) => Object.keys((schema as { properties?: object }).properties ?? {}).map(key => `${plugin}.${key}`));
    expect(declared.length).toBeGreaterThan(20);
    expect(declared.filter(key => !rows.includes(key))).toEqual([]);
    expect(rows.filter(row => !row.endsWith('.') && !declared.includes(row))).toEqual([]);
    const withSettings = new Set(registry.settings.sections().map(({ plugin }) => plugin));
    expect(rows.filter(row => row.endsWith('.')).map(row => row.slice(0, -1)).filter(plugin => withSettings.has(plugin))).toEqual([]);
  });
});
