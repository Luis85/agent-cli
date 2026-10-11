import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { errorCodes } from '../../src/domain/shared/error-catalog.ts';
import { commonErrors } from '../../src/presentation/cli/catalog-commands.ts';
import type { Registry } from '../../src/application/plugins/registry.ts';
import { inventoryErrorCodes, type ErrorCodeInventory } from '../support/error-codes.ts';
import { fullRegistry } from '../support/full-registry.ts';

/**
 * Every failure code a command can raise must reach `schema <command>`: its own `errors`, or `commonErrors`. The
 * codes come from the static inventory of `tests/support/error-codes.ts`: `ensure`, `forgeError` and plugin coded
 * failures, by the source file that raises them. Codes a plugin command reaches only through the kernel ports it
 * calls (NOT_FOUND from a file read) are not raised in its source; `declared-failures.e2e.test.ts` checks those with
 * failing invocations.
 */

/**
 * A plugin's failures surface through its own commands and generators. Source that serves other commands through
 * a service is listed here, by path under `src/plugins/`, with every command that reports its codes: the
 * `connector.hub` service and the Azure DevOps connector registered with it reach `connectors test` and
 * `backlog sync`, and the `scaffolds.projects` service reaches `project create` and `project component`.
 */
const reportedThrough: Readonly<Record<string, readonly string[]>> = {
  'connector/application/hub.ts': ['connectors', 'backlog'],
  'connector-azure-devops/': ['connectors', 'backlog'],
  'scaffolds/infrastructure/projects.ts': ['project'],
};

/** Codes a plugin raises only for service callers that pass values its own command validates or fixes first. */
const serviceOnly: Readonly<Record<string, readonly string[]>> = {
  // The claude command checks --timeout itself (INVALID_ARGUMENT) and fixes the output mode and output limit;
  // PLUGIN_LIFECYCLE refuses a claude.lifecycle call made outside a command invocation.
  claude: ['INVALID_CLAUDE_TIMEOUT', 'INVALID_CLAUDE_OUTPUT', 'INVALID_CLAUDE_OUTPUT_LIMIT', 'PLUGIN_LIFECYCLE'],
};

/**
 * Plugin host contract codes report a defective user plugin, while it loads or when it misuses the plugin API,
 * rather than the behaviour of a command; `schema` lists them in `errors` and plugins.md documents them.
 */
const pluginContract = [
  'INVALID_PLUGIN', 'INVALID_PLUGIN_CONFIG', 'INCOMPATIBLE_PLUGIN', 'DUPLICATE_PLUGIN', 'PLUGIN_NAMESPACE', 'PLUGIN_SERVICE_MISSING',
  'PLUGIN_SERVICE_CYCLE', 'PLUGIN_LIFECYCLE', 'DUPLICATE_OR_INVALID_ID', 'INVALID_EVENT', 'INVALID_EVENT_LISTENER', 'INVALID_EVENT_PAYLOAD',
  'DUPLICATE_EVENT', 'UNKNOWN_EVENT', 'EVENT_RECURSION', 'EVENT_OWNERSHIP',
];

const common = new Set<string>(commonErrors);

/** Raised codes by repository-relative source file. */
function raisedByFile(inventory: ErrorCodeInventory): Map<string, Set<string>> {
  const files = new Map<string, Set<string>>();
  for (const map of [inventory.codes, inventory.coded, inventory.forwarded]) {
    for (const [code, locations] of map) {
      for (const location of locations) {
        const file = location.replace(/:\d+$/, '').split(sep).join('/');
        files.set(file, (files.get(file) ?? new Set()).add(code));
      }
    }
  }
  return files;
}

function pluginErrors(registry: Registry, pluginId: string): Set<string> {
  const plugin = registry.plugins.find(entry => entry.manifest.id === pluginId)!;
  return new Set([...plugin.commands ?? [], ...plugin.generators ?? []].flatMap(contribution => contribution.errors ?? []));
}

/** The ids of commands defined as object literals (`id` and `usage`) in a kernel source file. */
async function definedCommands(path: string): Promise<string[]> {
  const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const ids: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const named = (name: string) => node.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === name) as ts.PropertyAssignment | undefined;
      const id = named('id')?.initializer;
      if (id && ts.isStringLiteral(id) && named('usage')) ids.push(id.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return ids;
}

async function kernelPresentationFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? kernelPresentationFiles(join(directory, entry.name)) : Promise.resolve(entry.name.endsWith('.ts') ? [join(directory, entry.name)] : [])));
  return nested.flat();
}

describe('declared command errors', async () => {
  const registry = await fullRegistry();
  const inventory = await inventoryErrorCodes('src');
  const raised = raisedByFile(inventory);
  const pluginIds = registry.plugins.map(plugin => plugin.manifest.id);
  const servedFrom = (file: string) => Object.keys(reportedThrough).find(prefix => file.startsWith(`plugins/${prefix}`));
  const codesIn = (files: (file: string) => boolean) => new Set([...raised].filter(([file]) => files(file)).flatMap(([, codes]) => [...codes]));
  const raisedIn = (pluginId: string) => codesIn(file => file.startsWith(`plugins/${pluginId}/`));
  const required = (pluginId: string, codes: Set<string>) => [...codes].filter(code => !common.has(code) && !serviceOnly[pluginId]?.includes(code)).sort();

  it('resolves every plugin failure code statically', () => {
    expect(inventory.unresolved, 'error codes must resolve statically; see tests/support/error-codes.ts').toEqual([]);
    // The scan is not vacuous: each plugin family's helper and the host's built-in codes are found.
    for (const [pluginId, code] of [['backlog', 'SYNC_INTERRUPTED'], ['agents', 'AGENT_DRIFT'], ['search', 'SEARCH_TIMEOUT'], ['connector-azure-devops', 'CONNECTOR_AUTH_FAILED'], ['claude', 'CLAUDE_OUTPUT_LIMIT'], ['ui', 'UI_DRIFT']] as const) {
      expect(raisedIn(pluginId), pluginId).toContain(code);
    }
  });

  it.each(['templates', 'scaffolds', 'ui', 'data-sources', 'claude', 'bases', 'skills', 'search', 'links', 'vault-check', 'agents', 'connector', 'connector-azure-devops', 'backlog', 'webviews', 'browser'])(
    'declares every code the %s plugin raises on the commands that report it', pluginId => {
      expect(pluginIds).toContain(pluginId);
      const own = pluginErrors(registry, pluginId);
      const inPlugin = (file: string) => file.startsWith(`plugins/${pluginId}/`);
      const ownCodes = required(pluginId, codesIn(file => inPlugin(file) && servedFrom(file) === undefined));
      expect(ownCodes.filter(code => !own.has(code)), `${pluginId} commands and generators`).toEqual([]);
      for (const prefix of Object.keys(reportedThrough).filter(entry => entry.startsWith(`${pluginId}/`))) {
        const served = required(pluginId, codesIn(file => servedFrom(file) === prefix));
        expect(served, `${prefix} raises codes`).not.toEqual([]);
        for (const commandId of reportedThrough[prefix]!) {
          const declared = new Set(registry.commands.get(commandId)!.errors ?? []);
          expect(served.filter(code => !declared.has(code)), `${commandId} reports ${prefix}`).toEqual([]);
        }
      }
      for (const code of serviceOnly[pluginId] ?? []) expect(raisedIn(pluginId), `stale service-only code ${code}`).toContain(code);
    });

  it('declares PLUGIN_UNAVAILABLE on every plugin command and generator', () => {
    for (const plugin of registry.plugins) {
      for (const contribution of [...plugin.commands ?? [], ...plugin.generators ?? []]) {
        const registered = registry.commands.get(contribution.id) ?? registry.generators.get(contribution.id)!;
        expect(registered.errors ?? [], `${plugin.manifest.id} ${contribution.id}`).toContain('PLUGIN_UNAVAILABLE');
      }
    }
  });

  it('publishes the generators\' codes on make', () => {
    const make = new Set(registry.commands.get('make')!.errors);
    for (const generator of registry.generators.values()) {
      expect((generator.errors ?? []).filter(code => !make.has(code)), `make ${generator.id}`).toEqual([]);
    }
  });

  it('declares the codes each kernel command module raises on the commands it defines', async () => {
    const missing: string[] = [];
    for (const path of await kernelPresentationFiles('src/presentation')) {
      const file = relative('src', path).split(sep).join('/');
      const ids = (await definedCommands(path)).filter(id => registry.commands.has(id));
      if (ids.length === 0) continue;
      const declared = new Set(ids.flatMap(id => registry.commands.get(id)!.errors ?? []));
      for (const code of raised.get(file) ?? []) if (!common.has(code) && !declared.has(code)) missing.push(`${code} in ${file} (${ids.join(', ')})`);
    }
    expect(missing).toEqual([]);
  });

  it('leaves no catalog code undeclared except the plugin host contract', () => {
    const declared = new Set([...registry.commands.values()].flatMap(command => command.errors ?? []));
    const codes = [...errorCodes, ...registry.catalog.errors().map(entry => entry.code)];
    const exempt = new Set([...pluginContract, ...Object.values(serviceOnly).flat()]);
    expect(codes.filter(code => !common.has(code) && !declared.has(code) && !exempt.has(code))).toEqual([]);
    expect(pluginContract.filter(code => declared.has(code) || common.has(code)), 'stale plugin contract exemptions').toEqual([]);
  });
});
