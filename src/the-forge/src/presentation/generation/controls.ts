import { vaultPath } from '../../domain/documents/file.ts';
import { option } from '../../application/plugins/command-metadata.ts';
import { reviewOptions } from '../../application/generation/controls.ts';

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
