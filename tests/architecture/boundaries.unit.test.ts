import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { boundaryViolations } from './import-boundaries.ts';

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
