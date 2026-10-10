import { ensure, isRecord } from '../../domain/shared/errors.ts';
import { vaultPath } from '../../domain/documents/file.ts';
import type { FileRepository } from '../../application/workspace/ports.ts';
import type { ParsedArguments } from '../cli/arguments.ts';
import { value } from '../../application/plugins/command-input.ts';
import { parseJson } from '../cli/input.ts';
import { option } from '../../application/plugins/command-metadata.ts';

/** Review controls of every reviewed generator: plan, check drift, or regenerate with approved revisions. */
export const reviewOptions = {
  'revisions-from': option.string('JSON file mapping generated paths to approved SHA-256 revisions (from --plan-out).'),
  plan: option.boolean('Report planned outputs and their status without writing.'),
  'plan-out': option.string('Write the plan\'s revision manifest to this path.'),
  check: option.boolean('Fail with a drift code when outputs are missing or differ.'),
};
export const libraryGenerationOptions = {
  project: option.string('Generate into this project instead of the selected one.'),
  library: option.string('Definition library directory; defaults to the configured path.'),
  ...reviewOptions,
};

/** Output writes use workspace paths; input manifests remain in the selected scope. */
export function generationOutputPath(path: string, project: { directory: string } | null): string {
  const relative = vaultPath(path);
  return project ? `${project.directory}/${relative}` : relative;
}

export async function generationControls(flags: ParsedArguments['flags'], files: Pick<FileRepository, 'read'>) {
  const revisionsPath = value(flags, 'revisions-from'), manifestPath = value(flags, 'plan-out');
  const planning = flags.plan === true || manifestPath !== undefined;
  ensure(!(planning && flags.check), 'INVALID_ARGUMENT', 'Choose --plan/--plan-out or --check.');
  ensure(!(revisionsPath !== undefined && (planning || flags.check)), 'INVALID_ARGUMENT', 'Planning and checks do not accept --revisions-from. Review a plan before authorizing regeneration.');
  let revisions: Record<string, string> | undefined;
  if (revisionsPath !== undefined) {
    const parsed = parseJson(new TextDecoder('utf-8', { fatal: true }).decode((await files.read(revisionsPath)).bytes));
    ensure(isRecord(parsed) && Object.values(parsed).every(revision => typeof revision === 'string' && /^[a-f0-9]{64}$/.test(revision)), 'INVALID_INPUT', '--revisions-from must contain a JSON object mapping generated workspace paths to SHA-256 revisions.');
    revisions = parsed as Record<string, string>;
  }
  const mode = flags.check ? 'check' : planning ? 'plan' : 'generate';
  return { mode, manifestPath, revisions };
}
