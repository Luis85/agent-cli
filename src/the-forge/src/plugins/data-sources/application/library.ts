import { ensure } from '../../../domain/shared/errors.ts';
import { vaultPath, ensureSeparateDirectories, type WriteRequest } from '../../../domain/documents/file.ts';
import type { DataSourceDefinition } from '../domain/definition.ts';
import type { Workspace } from '../../../application/workspace/workspace.ts';
import { GenerationService } from '../../../application/generation/plans.ts';

export interface DataSourceDefinitionCodec {
  parse(bytes: Uint8Array, path: string): DataSourceDefinition;
  serialize(definition: DataSourceDefinition): Uint8Array;
}
export interface DataSourceGenerateOptions {
  source?: string;
  outputDirectory: string;
  testDataDirectory: string;
  revisions?: Record<string, string>;
}
export interface DataSourceRenderer {
  generate(definitions: readonly DataSourceDefinition[], options: DataSourceGenerateOptions): readonly WriteRequest[];
}
function validateLibrary(definitions: readonly DataSourceDefinition[]) {
  const ids = new Set<string>();
  for (const definition of definitions) {
    ensure(!ids.has(definition.id), 'DUPLICATE_DATA_SOURCE', `Duplicate data source ${definition.id}.`);
    ids.add(definition.id);
  }
}
function starter(directory: string, id: string, kind: DataSourceDefinition['kind']): DataSourceDefinition {
  return {
    schemaVersion: 1, id, kind, sourcePath: `${directory}/${id}.md`,
    description: `# ${id}\n\nDescribe this data source, its ownership and error behavior.\n`,
    model: { name: 'Item', idField: 'id', fields: { id: { type: 'string' }, title: { type: 'string', example: 'Example item' } } },
    ...(kind === 'rest' ? { rest: { baseUrl: 'https://api.example.com', operations: { list: { method: 'GET' as const, path: '/items' }, get: { method: 'GET' as const, path: '/items/{id}' } } } } : { json: { path: 'data/items.json' } }),
    testData: { count: 3 },
  };
}

/** Discovery, transfers and generated files share the workspace's revision and event policy. */
export class DataSourceLibrary {
  constructor(private readonly workspace: Workspace, private readonly codec: DataSourceDefinitionCodec, private readonly renderer?: DataSourceRenderer) {}

  async list(directory: string): Promise<DataSourceDefinition[]> {
    const definitions = (await this.sources(directory)).map(source => source.definition);
    validateLibrary(definitions); return definitions;
  }
  async inspect(directory: string, id: string): Promise<DataSourceDefinition & { revision: string }> {
    const sources = await this.sources(directory);
    validateLibrary(sources.map(source => source.definition));
    const source = sources.find(candidate => candidate.definition.id === id);
    ensure(source, 'UNKNOWN_DATA_SOURCE', `No data source ${id} in ${directory}.`);
    return { ...source.definition, revision: source.revision };
  }
  async validate(directory: string) {
    return { valid: true, sources: (await this.list(directory)).map(definition => definition.id) };
  }
  async create(directory: string, id: string, kind: DataSourceDefinition['kind'] = 'rest') {
    vaultPath(directory);
    const definition = starter(directory, id, kind), bytes = this.codec.serialize(definition);
    validateLibrary([...await this.list(directory), this.codec.parse(bytes, definition.sourcePath)]);
    return { source: id, ...await this.commit([{ path: definition.sourcePath, bytes }]) };
  }
  async init(directory: string) {
    vaultPath(directory);
    const existing = await this.list(directory), ids = new Set(existing.map(definition => definition.id));
    const additions = [starter(directory, 'example-rest', 'rest'), starter(directory, 'example-json', 'json')].filter(definition => !ids.has(definition.id));
    const plan = additions.map(definition => ({ path: definition.sourcePath, bytes: this.codec.serialize(definition) }));
    return { sources: additions.map(definition => definition.id), skipped: [...ids].sort(), ...await this.commit(plan) };
  }
  async import(sourceDirectory: string, directory: string) {
    ensureSeparateDirectories(sourceDirectory, directory);
    const sources = await this.sources(sourceDirectory);
    ensure(sources.length, 'EMPTY_DATA_SOURCE_LIBRARY', `No data-source definitions in ${sourceDirectory}.`);
    validateLibrary([...await this.list(directory), ...sources.map(source => source.definition)]);
    const plan = sources.map(({ definition, bytes }) => ({ path: `${directory}/${definition.sourcePath.slice(sourceDirectory.length + 1)}`, bytes }));
    return { sources: sources.map(source => source.definition.id), ...await this.commit(plan) };
  }
  async export(directory: string, outputDirectory: string) {
    ensureSeparateDirectories(directory, outputDirectory);
    const sources = await this.sources(directory), definitions = sources.map(source => source.definition);
    validateLibrary([...await this.list(outputDirectory), ...definitions]);
    const plan = sources.map(({ definition, bytes }) => ({ path: `${outputDirectory}/${definition.sourcePath.slice(directory.length + 1)}`, bytes }));
    return { sources: definitions.map(definition => definition.id), ...await this.commit(plan) };
  }
  async generate(directory: string, options: DataSourceGenerateOptions) {
    const { definitions, writes } = await this.prepare(directory, options);
    return { sources: definitions.map(definition => definition.id), ...await new GenerationService(this.workspace).commit(writes, options.revisions) };
  }
  async plan(directory: string, options: DataSourceGenerateOptions, manifestPath?: string) {
    ensure(options.revisions === undefined, 'INVALID_GENERATION_PLAN', 'Planning does not accept regeneration revisions.');
    return new GenerationService(this.workspace).plan((await this.prepare(directory, options)).writes, manifestPath);
  }
  async check(directory: string, options: DataSourceGenerateOptions) {
    ensure(options.revisions === undefined, 'INVALID_GENERATION_PLAN', 'Checks do not accept regeneration revisions.');
    return new GenerationService(this.workspace).check((await this.prepare(directory, options)).writes, 'DATA_SOURCE_DRIFT');
  }
  private async prepare(directory: string, options: DataSourceGenerateOptions) {
    ensure(this.renderer, 'DATA_SOURCE_RENDERER_UNAVAILABLE', 'No data-source renderer is configured.');
    vaultPath(options.outputDirectory); vaultPath(options.testDataDirectory);
    let definitions = await this.list(directory);
    ensure(definitions.length, 'EMPTY_DATA_SOURCE_LIBRARY', `No data-source definitions in ${directory}.`);
    if (options.source) {
      definitions = definitions.filter(definition => definition.id === options.source);
      ensure(definitions.length, 'UNKNOWN_DATA_SOURCE', `No data source ${options.source} in ${directory}.`);
    }
    return { definitions, writes: this.renderer.generate(definitions, options) };
  }

  private async sources(directory: string) {
    vaultPath(directory);
    const paths = (await this.workspace.files.list()).filter(path => path.startsWith(`${directory}/`) && /\.md$/i.test(path)).sort();
    return Promise.all(paths.map(async path => {
      const { bytes, revision } = await this.workspace.files.read(path);
      return { bytes, revision, definition: this.codec.parse(bytes, path) };
    }));
  }
  private async commit(plan: readonly WriteRequest[]) {
    const result = plan.length ? await this.workspace.write(plan) : { dryRun: this.workspace.dryRun, changes: [] };
    return { ...result, ...(this.workspace.dryRun ? { preview: plan.map(file => ({ path: file.path, content: new TextDecoder().decode(file.bytes) })) } : {}) };
  }
}
