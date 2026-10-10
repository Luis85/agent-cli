import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { boundaryViolations, compositionViolations, sdkViolations } from './import-boundaries.ts';

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
  expect(boundaryViolations(resolve('src/application/example.ts'), source)).toHaveLength(1);
});

it('permits inward type imports, re-exports, and nested relative imports', () => {
  const source = "import type { UiNode } from '../../domain/ui.ts'; export { service } from '../service.ts';";
  expect(boundaryViolations(resolve('src/application/nested/example.ts'), source)).toEqual([]);
  expect(boundaryViolations(resolve('src/domain/nested/example.ts'), "import '../ui.ts';")).toEqual([]);
});

it('rejects application dependencies from the domain while ignoring prose', () => {
  expect(boundaryViolations(resolve('src/domain/example.ts'), "export * from '../application/ui.ts';")).toHaveLength(1);
  expect(boundaryViolations(resolve('src/domain/example.ts'), "// import 'node:fs';\nconst example = `import 'node:fs';`;")).toEqual([]);
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
  expect(boundaryViolations(resolve('src/presentation/cli/example.ts'), source)).toHaveLength(1);
});

it('allows the CLI parser, package metadata, and deeply nested inward dependencies', () => {
  expect(boundaryViolations(resolve('src/presentation/cli/example.ts'), [
    "import { Command } from 'commander';",
    "import metadata from '../../../package.json';",
    "import type { Workspace } from '../../application/workspace/workspace.ts';",
    "import { ensure } from '../../domain/shared/errors.ts';",
    "import { parseJson } from './input.ts';",
  ].join('\n'))).toEqual([]);
  expect(boundaryViolations(resolve('src/application/deep/concern/example.ts'), "export type { FileSnapshot } from '../../../domain/documents/file.ts';")).toEqual([]);
});

it('lets infrastructure use libraries and approved asset roots while rejecting presentation and composition dependencies', () => {
  const file = resolve('src/infrastructure/plugins/loader.ts');
  expect(boundaryViolations(file, "import 'node:fs'; import 'yaml'; import asset from '../../../docs/templates/note.md?raw'; import config from '../../../configs/lint/oxlintrc.json?raw'; const module = import(path);")).toEqual([]);
  expect(boundaryViolations(file, "import '../../presentation/cli/commands.ts'; import '../../main.ts'; import '../../sdk.ts';")).toHaveLength(3);
});

it.each([
  "import note from '../../../../templates/note.md?raw';",
  "import helper from '../../../tests/support/workspace.ts';",
  "import release from '../../../scripts/release.mjs?raw';",
  "import readme from '../../../../../README.md?raw';",
])('rejects relative paths that escape src outside the approved asset roots: %s', source => {
  expect(boundaryViolations(resolve('src/infrastructure/templates/example.ts'), source)).toHaveLength(1);
});

it.each([
  ['src/infrastructure/workspace/files.ts', 'const module = await import(path);'],
  ['src/infrastructure/workspace/files.ts', 'const module = require(name);'],
  ['src/plugins/search/infrastructure/index.ts', 'const module = await import(`./${name}.ts`);'],
  ['src/plugins/search/presentation/command.ts', 'const module = await import(path);'],
])('allows computed imports only in the plugin loader: %s', (file, source) => {
  expect(boundaryViolations(resolve(file), source)).toEqual([expect.stringContaining('computed module dependencies')]);
});

it('inspects import.meta.glob patterns like imports', () => {
  const plugin = resolve('src/plugins/skills/infrastructure/bundled-skills.ts');
  expect(boundaryViolations(plugin, "const skills = import.meta.glob('../../../../skills/*/SKILL.md', { query: '?raw' });")).toEqual([]);
  expect(boundaryViolations(plugin, "const skills = import.meta.glob(['../../../../skills/*/SKILL.md', '!../../../../skills/draft-*/SKILL.md']);")).toEqual([]);
  expect(boundaryViolations(plugin, "const all = import.meta.glob('../../links/**/*.ts');")).toHaveLength(1);
  expect(boundaryViolations(plugin, "const all = import.meta.glob('/tests/**/*.ts');")).toHaveLength(1);
  expect(boundaryViolations(plugin, 'const all = import.meta.glob(patterns);')).toHaveLength(1);
  expect(boundaryViolations(resolve('src/application/plugins/example.ts'), "const all = import.meta.glob('../../infrastructure/**/*.ts');")).toHaveLength(1);
});

describe('core plugin boundaries', () => {
  it.each([
    ['src/plugins/search/application/query.ts', "import { links } from '../../links/application/links.ts';"],
    ['src/plugins/search/plugin.ts', "import { linksPlugin } from '../links/plugin.ts';"],
    ['src/plugins/search/presentation/commands.ts', "import type { Index } from '../../links/domain/index.ts';"],
    ['src/plugins/search/application/query.ts', "import { NodeFiles } from '../../../infrastructure/workspace/files.ts';"],
    ['src/plugins/search/infrastructure/index.ts', "import { NodeFiles } from '../../../infrastructure/workspace/files.ts';"],
    ['src/plugins/search/presentation/commands.ts', "import { parseArguments } from '../../../presentation/cli/arguments.ts';"],
    ['src/plugins/search/plugin.ts', "import '../../main.ts';"],
    ['src/plugins/search/domain/query.ts', "import type { Workspace } from '../../../application/workspace/workspace.ts';"],
    ['src/plugins/search/domain/query.ts', "import '../application/query.ts';"],
    ['src/plugins/search/application/query.ts', "import 'node:fs';"],
    ['src/plugins/search/presentation/commands.ts', "import { Command } from 'commander';"],
    ['src/plugins/search/presentation/commands.ts', "import '../infrastructure/index.ts';"],
  ])('rejects %s importing another plugin, kernel adapters or outward layers: %s', (file, source) => {
    expect(boundaryViolations(resolve(file), source)).toHaveLength(1);
  });

  it('lets plugin layers use kernel domain and application ports and their own inward layers', () => {
    expect(boundaryViolations(resolve('src/plugins/search/presentation/commands.ts'), [
      "import type { Command } from '../../../application/plugins/registry.ts';",
      "import { arity } from '../../../application/plugins/command-input.ts';",
      "import { ensure } from '../../../domain/shared/errors.ts';",
      "import { search } from '../application/search.ts';",
      "import type { Hit } from '../domain/hit.ts';",
    ].join('\n'))).toEqual([]);
    expect(boundaryViolations(resolve('src/plugins/search/infrastructure/index.ts'), "import { parse } from 'yaml'; import skill from '../../../../skills/forge-search/SKILL.md?raw'; import '../application/ports.ts';")).toEqual([]);
    expect(boundaryViolations(resolve('src/plugins/search/plugin.ts'), "import '../../application/plugins/core-plugins.ts'; import './infrastructure/index.ts'; import './presentation/commands.ts';")).toEqual([]);
  });

  it('keeps the kernel independent of plugins and the composition root on plugin factories', () => {
    expect(boundaryViolations(resolve('src/application/plugins/example.ts'), "import { skillsPlugin } from '../../plugins/skills/plugin.ts';")).toHaveLength(1);
    expect(compositionViolations(resolve('src/main.ts'), "import { skillsPlugin } from './plugins/skills/plugin.ts';")).toEqual([]);
    expect(compositionViolations(resolve('src/main.ts'), "import { skillsCommand } from './plugins/skills/presentation/commands.ts';")).toHaveLength(1);
  });
});

it('allows only inward type exports in the public SDK', () => {
  const file = resolve('src/sdk.ts');
  expect(sdkViolations(file, "export type { Command } from './application/plugins/registry.ts'; export { type FileSnapshot } from './domain/documents/file.ts';")).toEqual([]);
  for (const source of [
    "export { Registry } from './application/plugins/registry.ts';",
    "export type { NodeFiles } from './infrastructure/workspace/files.ts';",
    "export type { Command } from './presentation/cli/commands.ts';",
    "import './main.ts';",
    'export const started = true;',
  ]) expect(sdkViolations(file, source).length).toBeGreaterThan(0);
});
