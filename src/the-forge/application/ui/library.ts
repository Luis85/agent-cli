import { AppError, ensure } from '../../domain/shared/errors.ts';
import { vaultPath, ensureSeparateDirectories, type WriteRequest } from '../../domain/documents/file.ts';
import { uiFrameworks, type UiDefinition, type UiFramework } from '../../domain/ui/definition.ts';
import type { InteractionDefinition } from '../../domain/interactions/definition.ts';
import { componentInteractionIds } from '../../domain/ui/interactions.ts';
import { uiVoidTags } from '../../domain/ui/syntax.ts';
import { selectUiComponents, validateUiLibrary } from '../../domain/ui/library.ts';
import type { Workspace } from '../workspace/workspace.ts';
import { GenerationService } from '../generation/plans.ts';

export interface UiDefinitionCodec {
  parse(bytes: Uint8Array, path: string): UiDefinition;
  serialize(definition: UiDefinition): Uint8Array;
}
export interface UiGenerateOptions { framework: UiFramework; component?: string; outputDirectory: string; storiesDirectory?: string; storybook?: boolean; storiesOnly?: boolean; revisions?: Record<string, string>; interactionDirectory?: string }
export interface InteractionSource { list(directory: string): Promise<InteractionDefinition[]> }
export interface UiRenderOptions extends UiGenerateOptions { interactions: readonly InteractionDefinition[] }
export interface UiRenderer {
  generate(definitions: readonly UiDefinition[], options: UiRenderOptions): readonly WriteRequest[];
  componentPaths?(definitions: readonly UiDefinition[], options: UiRenderOptions): readonly string[];
}

/** All writes, including imports and generated artifacts, use workspace revision policy. */
export class UiLibrary {
  constructor(private readonly workspace: Workspace, private readonly codec: UiDefinitionCodec, private readonly catalog: readonly UiDefinition[], private readonly renderer?: UiRenderer, private readonly interactionSource?: InteractionSource, private readonly interactionDirectory = 'interactions') {}

  async list(directory: string, interactionDirectory?: string): Promise<UiDefinition[]> {
    const definitions = await this.discover(directory); await this.validateDefinitions(definitions, interactionDirectory); return definitions;
  }
  async inspect(directory: string, id: string, interactionDirectory?: string): Promise<UiDefinition & { revision: string; bytes: number }> {
    const sources = await this.sources(directory);
    await this.validateDefinitions(sources.map(source => source.definition), interactionDirectory);
    const source = sources.find(candidate => candidate.definition.id === id);
    ensure(source, 'UNKNOWN_UI_COMPONENT', `No component ${id} in ${directory}. Run components list --library ${directory} to discover component IDs.`);
    return { ...source.definition, revision: source.revision, bytes: source.bytes.length };
  }
  async validate(directory: string, interactionDirectory?: string) {
    const definitions = await this.list(directory, interactionDirectory);
    return { directory, valid: true, status: definitions.length ? 'ready' : 'empty', count: definitions.length, components: definitions.map(definition => definition.id), ...(!definitions.length ? { nextStep: `Run components init --library ${directory}, or add a Markdown component definition.` } : {}) };
  }
  async create(directory: string, id: string, tag = 'div', interactionDirectory?: string) {
    vaultPath(directory);
    const voidElement = uiVoidTags.has(tag);
    const definition: UiDefinition = { schemaVersion: 1, id, sourcePath: `${directory}/${id}.md`, description: `# ${id}\n\nDescribe this component.\n`, props: {}, root: { tag, ...(!voidElement ? { children: [{ slot: 'children' as const }] } : {}) } };
    const bytes = this.codec.serialize(definition);
    await this.validateDefinitions([...await this.discover(directory), this.codec.parse(bytes, definition.sourcePath)], interactionDirectory);
    return { component: id, ...await this.commit([{ path: definition.sourcePath, bytes }]) };
  }
  async init(directory: string, interactionDirectory?: string) {
    vaultPath(directory);
    const existing = await this.discover(directory), ids = new Set(existing.map(definition => definition.id));
    const additions = this.catalog.filter(definition => !ids.has(definition.id));
    await this.validateDefinitions([...existing, ...additions], interactionDirectory);
    const plan = additions.map(definition => ({ path: `${directory}/${definition.id}.md`, bytes: this.codec.serialize(definition) }));
    return { components: additions.map(definition => definition.id), skipped: [...ids].sort(), ...await this.commit(plan) };
  }
  async import(sourceDirectory: string, directory: string, interactionDirectory?: string) {
    vaultPath(sourceDirectory); vaultPath(directory);
    ensureSeparateDirectories(sourceDirectory, directory);
    const sources = await this.sources(sourceDirectory), imported = sources.map(source => source.definition), existing = await this.discover(directory);
    ensure(imported.length, 'EMPTY_UI_LIBRARY', `No component definitions in ${sourceDirectory}.`);
    await this.validateDefinitions([...existing, ...imported], interactionDirectory);
    const plan = sources.map(({ definition, bytes }) => ({ path: `${directory}/${definition.sourcePath.slice(sourceDirectory.length + 1)}`, bytes }));
    return { components: imported.map(definition => definition.id), ...await this.commit(plan) };
  }
  async export(directory: string, outputDirectory: string, interactionDirectory?: string) {
    vaultPath(directory); vaultPath(outputDirectory);
    ensureSeparateDirectories(directory, outputDirectory);
    const sources = await this.sources(directory), definitions = sources.map(source => source.definition);
    const interactions = await this.interactions(interactionDirectory);
    validateUiLibrary(definitions, interactions);
    // Export into a library only when the combined destination graph remains valid.
    validateUiLibrary([...await this.discover(outputDirectory), ...definitions], interactions);
    const plan = sources.map(({ definition, bytes }) => ({ path: `${outputDirectory}/${definition.sourcePath.slice(directory.length + 1)}`, bytes }));
    return { components: definitions.map(definition => definition.id), ...await this.commit(plan) };
  }
  async generate(directory: string, options: UiGenerateOptions) {
    return { framework: options.framework, ...await new GenerationService(this.workspace).commit(await this.render(directory, options), options.revisions) };
  }
  async plan(directory: string, options: UiGenerateOptions, manifestPath?: string) {
    ensure(options.revisions === undefined, 'INVALID_GENERATION_PLAN', 'Planning does not accept regeneration revisions.');
    return { framework: options.framework, ...await new GenerationService(this.workspace).plan(await this.render(directory, options), manifestPath) };
  }
  async check(directory: string, options: UiGenerateOptions) {
    ensure(options.revisions === undefined, 'INVALID_GENERATION_PLAN', 'Checks do not accept regeneration revisions.');
    return { framework: options.framework, ...await new GenerationService(this.workspace).check(await this.render(directory, options), 'UI_DRIFT') };
  }

  private async render(directory: string, options: UiGenerateOptions): Promise<readonly WriteRequest[]> {
    ensure(this.renderer, 'UI_RENDERER_UNAVAILABLE', 'No UI renderer is configured.');
    ensure(uiFrameworks.includes(options.framework), 'INVALID_UI_FRAMEWORK', `Unknown framework ${options.framework}.`);
    vaultPath(options.outputDirectory); if (options.storiesDirectory) vaultPath(options.storiesDirectory);
    ensure(!(options.storybook || options.storiesOnly) || options.storiesDirectory, 'INVALID_UI', 'Storybook generation requires a stories directory.');
    const interactions = await this.interactions(options.interactionDirectory);
    let definitions = await this.discover(directory);
    validateUiLibrary(definitions, interactions);
    ensure(definitions.length, 'EMPTY_UI_LIBRARY', `No component definitions in ${directory}. Run components init --library ${directory}, or add a Markdown component definition.`);
    if (options.component) ensure(definitions.some(definition => definition.id === options.component), 'UNKNOWN_UI_COMPONENT', `No component ${options.component} in ${directory}. Run components list --library ${directory} to discover component IDs.`);
    if (options.component) definitions = selectUiComponents(definitions, options.component);
    for (const definition of definitions) if ((options.storybook || options.storiesOnly) && definition.storybook?.extension) {
      try { await this.workspace.files.read(definition.storybook.extension); }
      catch (error) { if (error instanceof AppError && error.code === 'NOT_FOUND') throw new AppError('INVALID_UI', `Missing Storybook extension ${definition.storybook.extension}.`, 2); throw error; }
    }
    const ids = new Set(definitions.flatMap(componentInteractionIds));
    const renderOptions: UiRenderOptions = { ...options, interactions: interactions.filter(interaction => ids.has(interaction.id)) };
    if (options.storiesOnly) {
      ensure(this.renderer.componentPaths, 'UI_RENDERER_UNAVAILABLE', 'Standalone stories require a renderer with component artifact paths.');
      for (const path of this.renderer.componentPaths(definitions, renderOptions)) await this.workspace.files.read(path);
    }
    return this.renderer.generate(definitions, renderOptions);
  }
  private async interactions(directory = this.interactionDirectory): Promise<InteractionDefinition[]> {
    vaultPath(directory);
    return this.interactionSource ? this.interactionSource.list(directory) : [];
  }
  private async validateDefinitions(definitions: readonly UiDefinition[], interactionDirectory?: string): Promise<void> {
    validateUiLibrary(definitions, await this.interactions(interactionDirectory));
  }
  private async discover(directory: string): Promise<UiDefinition[]> {
    return (await this.sources(directory)).map(source => source.definition);
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
