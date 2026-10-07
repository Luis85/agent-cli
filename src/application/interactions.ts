import { ensure } from '../domain/errors.ts';
import { ensureSeparateDirectories, vaultPath, type WriteRequest } from '../domain/file.ts';
import { validateInteractionLibrary, type InteractionDefinition, type InteractionEvent } from '../domain/interaction.ts';
import type { Workspace } from './workspace.ts';

export interface InteractionDefinitionCodec {
  parse(bytes: Uint8Array, path: string): InteractionDefinition;
  serialize(definition: InteractionDefinition): Uint8Array;
}

function starter(directory: string, id: string, event: InteractionEvent = 'click'): InteractionDefinition {
  const input = event === 'input' || event === 'change';
  return {
    schemaVersion: 1, id, event, sourcePath: `${directory}/${id}.md`,
    description: `# ${id}\n\n${input ? 'Copies the input value into string state named value.' : 'Toggles boolean state named expanded.'} Declare that state on each consuming component.\n`,
    actions: input ? [{ type: 'set-state', state: 'value', fromEvent: 'value' }] : [{ type: 'toggle-state', state: 'expanded' }],
  };
}

/** Interaction definitions remain shared workspace assets; UI generation consumes them through a port. */
export class InteractionLibrary {
  constructor(private readonly workspace: Workspace, private readonly codec: InteractionDefinitionCodec) {}

  async list(directory: string): Promise<InteractionDefinition[]> {
    const definitions = (await this.sources(directory)).map(source => source.definition);
    validateInteractionLibrary(definitions); return definitions;
  }
  async inspect(directory: string, id: string): Promise<InteractionDefinition & { revision: string; bytes: number }> {
    const sources = await this.sources(directory);
    validateInteractionLibrary(sources.map(source => source.definition));
    const source = sources.find(candidate => candidate.definition.id === id);
    ensure(source, 'UNKNOWN_INTERACTION', `No interaction ${id} in ${directory}. Run interactions list --library ${directory}.`);
    return { ...source.definition, revision: source.revision, bytes: source.bytes.length };
  }
  async validate(directory: string) {
    const definitions = await this.list(directory);
    return { directory, valid: true, status: definitions.length ? 'ready' : 'empty', count: definitions.length, interactions: definitions.map(definition => definition.id),
      ...(!definitions.length ? { nextStep: `Run interactions init --library ${directory}, or add a Markdown interaction definition.` } : {}),
    };
  }
  async create(directory: string, id: string, event: InteractionEvent = 'click') {
    vaultPath(directory);
    const definition = starter(directory, id, event), bytes = this.codec.serialize(definition);
    validateInteractionLibrary([...await this.list(directory), this.codec.parse(bytes, definition.sourcePath)]);
    return { interaction: id, ...await this.commit([{ path: definition.sourcePath, bytes }]) };
  }
  async init(directory: string) {
    vaultPath(directory);
    const existing = await this.list(directory), ids = new Set(existing.map(definition => definition.id));
    const additions = [starter(directory, 'toggle-expanded'), starter(directory, 'input-value', 'input')].filter(definition => !ids.has(definition.id));
    const plan = additions.map(definition => ({ path: definition.sourcePath, bytes: this.codec.serialize(definition) }));
    return { interactions: additions.map(definition => definition.id), skipped: [...ids].sort(), ...await this.commit(plan) };
  }
  async import(sourceDirectory: string, directory: string) {
    ensureSeparateDirectories(sourceDirectory, directory);
    const sources = await this.sources(sourceDirectory);
    ensure(sources.length, 'EMPTY_INTERACTION_LIBRARY', `No interaction definitions in ${sourceDirectory}.`);
    validateInteractionLibrary([...await this.list(directory), ...sources.map(source => source.definition)]);
    const plan = sources.map(({ definition, bytes }) => ({ path: `${directory}/${definition.sourcePath.slice(sourceDirectory.length + 1)}`, bytes }));
    return { interactions: sources.map(source => source.definition.id), ...await this.commit(plan) };
  }
  async export(directory: string, outputDirectory: string) {
    ensureSeparateDirectories(directory, outputDirectory);
    const sources = await this.sources(directory), definitions = sources.map(source => source.definition);
    validateInteractionLibrary([...await this.list(outputDirectory), ...definitions]);
    const plan = sources.map(({ definition, bytes }) => ({ path: `${outputDirectory}/${definition.sourcePath.slice(directory.length + 1)}`, bytes }));
    return { interactions: definitions.map(definition => definition.id), ...await this.commit(plan) };
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
