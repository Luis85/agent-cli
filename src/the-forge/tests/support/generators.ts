import type { CommandContext, Generator, GeneratorRequest } from '../../src/application/plugins/registry.ts';
import type { GenerationService } from '../../src/application/generation/plans.ts';
import type { WriteRequest } from '../../src/domain/documents/file.ts';

/**
 * Runs a `generate` generator in isolation. The stub context has a selected project whose files all exist, which
 * satisfies preconditions such as the form generator's form-model check; pass `context` to override it.
 */
export async function generatePlan(generator: Generator, name: string, directory: string, context: Partial<CommandContext> = {}): Promise<readonly WriteRequest[]> {
  const stub = { project: { name: 'fixture', directory: 'projects/fixture' }, workspace: { files: { read: async () => ({}) } }, ...context };
  const request: GeneratorRequest = { name, directory, flags: {}, context: stub as unknown as CommandContext, generation: undefined as unknown as GenerationService };
  return generator.generate!(request);
}
