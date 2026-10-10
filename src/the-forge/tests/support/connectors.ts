import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { Registry, type CommandContext } from '../../src/application/plugins/registry.ts';
import { registerCorePlugins, registrySkills } from '../../src/application/plugins/core-plugins.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { VaultMetadata } from '../../src/application/metadata/vault-metadata.ts';
import { MetadataCacheEvents } from '../../src/application/metadata/cache-events.ts';
import { createApp } from '../../src/application/vault/app.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { ObsidianMetadataParser } from '../../src/infrastructure/metadata/parser.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { nodeFileDates } from '../../src/infrastructure/workspace/file-dates.ts';
import { FetchHttpClient } from '../../src/infrastructure/connectors/http-client.ts';
import { nodeLockFiles } from '../../src/infrastructure/workspace/lock-files.ts';
import { basesPlugin } from '../../src/plugins/bases/plugin.ts';
import { backlogPlugin } from '../../src/plugins/backlog/plugin.ts';
import { connectorPlugin } from '../../src/plugins/connector/plugin.ts';
import { azureDevOpsPlugin } from '../../src/plugins/connector-azure-devops/plugin.ts';
import type { FakeAzureDevOps } from './azure-devops.ts';

export const TOKEN_ENV = 'FORGE_TEST_AZURE_PAT';

/** An Azure DevOps connection profile against the fake server. */
export function azureConnection(fake: FakeAzureDevOps, organization: string, project: string, extra: Record<string, unknown> = {}) {
  return { platform: 'azure-devops', organization: fake.organization(organization), project, tokenEnv: TOKEN_ENV, iterationRoot: project, ...extra };
}

export interface Invocation { dryRun?: boolean; env?: Record<string, string | undefined> }

/**
 * One activated invocation like `src/main.ts` composes it, with the bases, connector, Azure DevOps and backlog core
 * plugins, connection profiles in `plugins.settings.connector`, a metadata cache that follows commits and HTTP
 * retries without waiting. `run` executes a registered command; the result carries the data, every event record
 * and the JSON a CLI would print.
 */
export async function invocation(root: string, connections: Record<string, unknown>, options: Invocation = {}) {
  const registry = new Registry(), events = new EventBus(new NodeEventScope());
  registerHostEvents(events);
  const env = options.env ?? {};
  registerCorePlugins(registry, events, [basesPlugin, connectorPlugin, azureDevOpsPlugin, backlogPlugin], {
    skills: registrySkills(registry), fileDates: nodeFileDates, locks: nodeLockFiles, http: new FetchHttpClient({ sleep: async () => {} }), environment: name => env[name],
  }, []);
  registry.settings.configure({ connector: { connections } }, new Set(registry.origins.keys()));
  const files = await NodeFiles.at(root);
  const codec = new ObsidianDocuments();
  const metadata = new VaultMetadata(files, new ObsidianMetadataParser(codec));
  const workspace = new Workspace(files, codec, events, options.dryRun === true, root, new MetadataCacheEvents(events, metadata));
  const app = createApp({ workspace, metadata, events, project: null });
  const context = { workspace, environment: workspace, events, metadata, app, root, workspaceRoot: root, project: null, language: 'en', input: async () => new Uint8Array() } as unknown as CommandContext;
  await registry.activate(events, context);
  return {
    context, events, registry,
    async run(command: string, args: string[], flags: Record<string, string | boolean> = {}) {
      try {
        const data = await registry.commands.get(command)!.run(args, flags, context) as Record<string, any>;
        return { data, events: events.history, output: JSON.stringify({ data, events: events.history }) };
      } catch (error) { throw registry.catalog.normalize(error); }
    },
  };
}

/** Runs one command in a fresh invocation. */
export async function run(root: string, connections: Record<string, unknown>, command: string, args: string[], flags: Record<string, string | boolean> = {}, options: Invocation = {}) {
  return (await invocation(root, connections, options)).run(command, args, flags);
}

/** A `.base` with one product-backlog view over `folder`, bound to `connection`. */
export const boundBase = (folder: string, view: string, connection: string) => `filters:\n  and:\n    - file.inFolder("${folder}")\nviews:\n  - type: product-backlog\n    name: ${view}\n    homeFolder: ${folder}\n    stateProperty: note.status\n    priorityProperty: note.priority\n    iterationProperty: note.iteration\n    connection: ${connection}\n`;
/** A note with JSON-quoted frontmatter values and a body. */
export const noteText = (fields: Record<string, unknown>, body = '') => `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n${body}`;
/** An Epic › Feature › PBI tree in `work/`, bound to `contoso` by `work/Sync.base`. */
export const planningNotes = () => ({
  'work/Sync.base': boundBase('work', 'Contoso', 'contoso'),
  'work/Trip planning.md': noteText({ type: 'Epic', order: 1000, status: 'Active', tags: ['planning'] }),
  'work/Itinerary builder.md': noteText({ type: 'Feature', parent: '[[Trip planning]]', order: 2000 }),
  'work/Draft a trip.md': noteText({ type: 'PBI', parent: '[[Itinerary builder]]', order: 3000, status: 'Open', priority: '1 - Must' }, 'Plan the **stops**.\n'),
});
