import { expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;

it('installs an editable shared planning pack and renders required inputs in the selected project', async () => {
  const preview = cli(['templates', 'install', 'workflow', '--dry-run']);
  expect(preview.status, preview.stdout).toBe(0);
  expect(preview.body.data.changes).toHaveLength(7); expect(preview.body.events).toEqual([]);
  await expect(readFile(join(fixture.project, 'bin/templates/workflow/prd.md'))).rejects.toThrow();
  const installed = cli(['templates', 'install', 'workflow']);
  expect(installed.status, installed.stdout).toBe(0); expect(installed.body.events).toHaveLength(7);
  const template = cli(['templates', 'inspect', 'workflow/prd.md']);
  expect(template.body.data.requiredVariables).toEqual(['owner']);
  expect(template.body.data.builtins).toEqual(expect.arrayContaining(['title', 'date:YYYY-MM-DD']));
  expect(cli(['project', 'create', 'planning']).status).toBe(0);
  expect(cli(['project', 'open', 'planning']).status).toBe(0);
  const repeated = cli(['templates', 'install']);
  expect(repeated.body.context.project).toBeNull(); expect(repeated.body.data.changes).toEqual([]);
  const generated = cli(['make', 'document', 'Requirements', '--template', 'workflow/prd.md', '--out', 'plans', '--values', '{"owner":"Product team"}', '--date', '2026-10-07']);
  expect(generated.status, generated.stdout).toBe(0); expect(generated.body.context.project.name).toBe('planning');
  const document = await readFile(join(fixture.project, 'projects/planning/plans/Requirements.md'), 'utf8');
  expect(document).toContain('Product team'); expect(document).toContain('REQ-001');
  const path = join(fixture.project, 'bin/templates/workflow/prd.md');
  await writeFile(path, '# Customized planning process\n');
  expect(cli(['templates', 'install', 'workflow']).body.data.skipped).toContain('bin/templates/workflow/prd.md');
  expect(await readFile(path, 'utf8')).toBe('# Customized planning process\n');
  expect(cli(['templates', 'install', 'unknown']).body.error.code).toBe('INVALID_ARGUMENT');
});
