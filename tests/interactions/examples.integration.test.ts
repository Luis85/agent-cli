import { expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MarkdownUiDefinitions } from '../../src/infrastructure/ui-definitions.ts';
import { MarkdownInteractionDefinitions } from '../../src/infrastructure/interaction-definitions.ts';
import { validateUiLibrary } from '../../src/domain/ui-library.ts';

it('keeps the interactive-form tutorial examples schema-valid and mutually compatible', async () => {
  const componentPath = 'examples/interactions/components/contact-request.md';
  const component = new MarkdownUiDefinitions().parse(await readFile(componentPath), componentPath);
  const directory = 'examples/interactions/definitions';
  const codec = new MarkdownInteractionDefinitions();
  const interactions = await Promise.all((await readdir(directory)).sort().map(async name => {
    const path = join(directory, name);
    return codec.parse(await readFile(path), path);
  }));
  expect(() => validateUiLibrary([component], interactions)).not.toThrow();
  expect(interactions.map(interaction => interaction.id)).toEqual(['capture-consent', 'capture-email', 'prepare-request']);
});
