import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { boundaryViolations, sdkViolations } from './import-boundaries.ts';

it.each([
  "import 'node:fs';",
  "import { files } from '../infrastructure/files.ts';",
  "export { files } from '../infrastructure/files.ts';",
  "const files = import('../infrastructure/files.ts');",
  "type Files = import('../infrastructure/files.ts').Files;",
  "import files = require('../infrastructure/files.ts');",
  "const files = require('../infrastructure/files.ts');",
  "import('../main.ts');",
  "import(path);",
  "import './nested/../../../infrastructure/files.ts';",
])('rejects outward dependency syntax: %s', source => {
  expect(boundaryViolations(resolve('src/the-forge/application/example.ts'), source)).toHaveLength(1);
});

it('permits inward type imports, re-exports, and nested relative imports', () => {
  const source = "import type { UiNode } from '../../domain/ui.ts'; export { service } from '../service.ts';";
  expect(boundaryViolations(resolve('src/the-forge/application/nested/example.ts'), source)).toEqual([]);
  expect(boundaryViolations(resolve('src/the-forge/domain/nested/example.ts'), "import '../ui.ts';")).toEqual([]);
});

it('rejects application dependencies from the domain while ignoring prose', () => {
  expect(boundaryViolations(resolve('src/the-forge/domain/example.ts'), "export * from '../application/ui.ts';")).toHaveLength(1);
  expect(boundaryViolations(resolve('src/the-forge/domain/example.ts'), "// import 'node:fs';\nconst example = `import 'node:fs';`;")).toEqual([]);
});

it.each([
  "import { NodeFiles } from '../../infrastructure/workspace/files.ts';",
  "export type { NodeFiles } from '../../infrastructure/workspace/files.ts';",
  "const service = import('../../infrastructure/claude/runtime.ts');",
  "import 'node:fs';",
  "import { parseDocument } from 'yaml';",
  "import type { Buffer } from 'node:buffer';",
  "import '../../main.ts';",
  "import(path);",
])('rejects presentation dependencies on concrete adapters: %s', source => {
  expect(boundaryViolations(resolve('src/the-forge/presentation/cli/example.ts'), source)).toHaveLength(1);
});

it('allows the CLI parser, package metadata, and deeply nested inward dependencies', () => {
  expect(boundaryViolations(resolve('src/the-forge/presentation/cli/example.ts'), [
    "import { Command } from 'commander';",
    "import metadata from '../../../../package.json';",
    "import type { Workspace } from '../../application/workspace/workspace.ts';",
    "import { ensure } from '../../domain/shared/errors.ts';",
    "import { parseJson } from './input.ts';",
  ].join('\n'))).toEqual([]);
  expect(boundaryViolations(resolve('src/the-forge/application/deep/concern/example.ts'), "export type { FileSnapshot } from '../../../domain/documents/file.ts';")).toEqual([]);
});

it('lets infrastructure use libraries/assets while rejecting presentation and composition dependencies', () => {
  const file = resolve('src/the-forge/infrastructure/plugins/loader.ts');
  expect(boundaryViolations(file, "import 'node:fs'; import 'yaml'; import asset from '../../../../templates/note.md?raw'; const module = import(path);")).toEqual([]);
  expect(boundaryViolations(file, "import '../../presentation/cli/commands.ts'; import '../../main.ts'; import '../../sdk.ts';")).toHaveLength(3);
});

it('allows only inward type exports in the public SDK', () => {
  const file = resolve('src/the-forge/sdk.ts');
  expect(sdkViolations(file, "export type { Command } from './application/plugins/registry.ts'; export { type FileSnapshot } from './domain/documents/file.ts';")).toEqual([]);
  for (const source of [
    "export { Registry } from './application/plugins/registry.ts';",
    "export type { NodeFiles } from './infrastructure/workspace/files.ts';",
    "export type { Command } from './presentation/cli/commands.ts';",
    "import './main.ts';",
    'export const started = true;',
  ]) expect(sdkViolations(file, source).length).toBeGreaterThan(0);
});
