import { ensure, forgeError, isRecord } from '../../domain/shared/errors.ts';
import { vaultPath } from '../../domain/documents/file.ts';
import type { FileRepository } from '../workspace/ports.ts';
import { value } from '../plugins/command-input.ts';
import { option, type CommandFlags, type CommandOption } from '../plugins/command-metadata.ts';
import type { hostGeneratorOptions } from '../plugins/registry.ts';

/**
 * Review controls of every reviewed generator: plan, check drift, or regenerate with approved revisions. Kernel
 * generators and core plugins (`agents generate`) share them with `GenerationService`.
 */
export const reviewOptions = {
  'revisions-from': option.string('JSON file mapping generated paths to approved SHA-256 revisions (from --plan-out).'),
  plan: option.boolean('Report planned outputs and their status without writing.'),
  'plan-out': option.string('Write the plan\'s revision manifest to this path.'),
  check: option.boolean('Fail with a drift code when outputs are missing or differ.'),
} satisfies Record<Exclude<typeof hostGeneratorOptions[number], 'out'>, CommandOption>;

export type GenerationMode = 'check' | 'plan' | 'generate';

/** The review mode of one invocation; `--revisions-from` is read from the command scope. */
export async function generationControls(flags: CommandFlags, files: Pick<FileRepository, 'read'>) {
  const revisionsPath = value(flags, 'revisions-from'), manifestPath = value(flags, 'plan-out');
  const planning = flags.plan === true || manifestPath !== undefined;
  ensure(!(planning && flags.check), 'INVALID_ARGUMENT', 'Choose --plan/--plan-out or --check.');
  ensure(!(revisionsPath !== undefined && (planning || flags.check)), 'INVALID_ARGUMENT', 'Planning and checks do not accept --revisions-from. Review a plan before authorizing regeneration.');
  let revisions: Record<string, string> | undefined;
  if (revisionsPath !== undefined) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode((await files.read(revisionsPath)).bytes);
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { throw forgeError('INVALID_JSON', 'Expected valid JSON input.'); }
    ensure(isRecord(parsed) && Object.values(parsed).every(revision => typeof revision === 'string' && /^[a-f0-9]{64}$/.test(revision)), 'INVALID_INPUT', '--revisions-from must contain a JSON object mapping generated workspace paths to SHA-256 revisions.');
    revisions = parsed as Record<string, string>;
  }
  const mode: GenerationMode = flags.check ? 'check' : planning ? 'plan' : 'generate';
  return { mode, manifestPath, revisions };
}

/**
 * Options of a generator that renders a workspace definition library into a project (`make ui`, `make stories`,
 * `make data-source`): `--project` selects the output project for one invocation and `--library` the definitions.
 * Such generators set `review`, so `make` adds the review controls after their own options.
 */
export const libraryGenerationOptions = {
  project: option.string('Generate into this project instead of the selected one.'),
  library: option.string('Definition library directory; defaults to the configured path.'),
};

/** Output writes use workspace paths; input manifests remain in the selected scope. */
export function generationOutputPath(path: string, project: { directory: string } | null): string {
  const relative = vaultPath(path);
  return project ? `${project.directory}/${relative}` : relative;
}
