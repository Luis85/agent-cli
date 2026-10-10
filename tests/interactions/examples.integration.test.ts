import { expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { MarkdownUiDefinitions } from '../../src/the-forge/infrastructure/ui/definitions.ts';
import { MarkdownInteractionDefinitions } from '../../src/the-forge/infrastructure/interactions/definitions.ts';
import { validateUiLibrary } from '../../src/the-forge/domain/ui/library.ts';

it('keeps the interactive-form tutorial examples schema-valid and mutually compatible', async () => {
  const componentPath = 'docs/examples/interactions/components/contact-request.md';
  const component = new MarkdownUiDefinitions().parse(await readFile(componentPath), componentPath);
  const directory = 'docs/examples/interactions/definitions';
  const codec = new MarkdownInteractionDefinitions();
  const interactions = await Promise.all((await readdir(directory)).sort().map(async name => {
    // Definition source paths are vault paths, which are POSIX on every platform.
    const path = `${directory}/${name}`;
    return codec.parse(await readFile(path), path);
  }));
  expect(() => validateUiLibrary([component], interactions)).not.toThrow();
  expect(interactions.map(interaction => interaction.id)).toEqual(['capture-consent', 'capture-email', 'prepare-request']);
});
