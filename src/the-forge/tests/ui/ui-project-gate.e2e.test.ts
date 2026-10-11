import { expect, it } from 'vitest';
import { rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { uiFrameworks } from '../../src/plugins/ui/domain/components/definition.ts';
import { components, interactions } from '../../scripts/showcase/design-system.mjs';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;
const execute = promisify(execFile);

/** A component without interactions, so the DOM targets render static factories: required and default props, a child component and a slot. */
const statCard = `---
schemaVersion: 1
id: stat-card
props:
  label:
    type: string
    required: true
  value:
    type: number
    default: 0
  highlighted:
    type: boolean
    default: false
root:
  component: card
  children:
    - tag: h3
      attrs:
        data-highlighted: "{{highlighted}}"
      text: "{{label}}"
    - tag: p
      text: "Value: {{value}}"
    - slot: children
---
A statistic.
`;

/** Runs one of the generated project's quality scripts, as `npm run` would. */
async function check(project: string, name: string) {
  await execute(process.execPath, [`scripts/quality/${name}.mjs`], { cwd: project, timeout: 45_000, maxBuffer: 4 * 1024 * 1024 })
    .catch((error: Error & { stdout?: string }) => { throw new Error(`${name} failed: ${error.message}\n${error.stdout ?? ''}`); });
}

/** `make ui <id>` for every target into `<directory>/<target>`, checking where the files land. */
async function generate(id: string, directory: (framework: string) => string | undefined, extra: string[] = []) {
  for (const framework of uiFrameworks) {
    const out = directory(framework);
    const result = await cli(['make', 'ui', id, '--framework', framework, ...(out ? ['--out', out] : []), ...extra]);
    expect(result.status, `${id} ${framework}`).toBe(0);
    const paths: string[] = result.body.data.changes.map((change: { path: string }) => change.path);
    const expected = out ? [`projects/demo/${out}/`] : [`projects/demo/ui/${framework}/components/`, `projects/demo/ui/${framework}/stories/`];
    expect(paths.filter(path => !expected.some(prefix => path.startsWith(prefix))), `${id} ${framework}`).toEqual([]);
  }
}

it('generates every UI target where the generated project\'s static checks pass, by default and inside its source', async () => {
  for (const args of [['project', 'create', 'demo'], ['project', 'open', 'demo'], ['components', 'init'], ['interactions', 'init'], ['components', 'create', 'stat-card']]) expect((await cli(args)).status, args.join(' ')).toBe(0);
  await writeFile(join(fixture.project, 'components/stat-card.md'), statCard);
  // By default each framework gets its own folder outside the gated source, so targets that share file names never collide.
  await generate('card', () => undefined, ['--stories']);
  // Inside the source, the output must pass lint and type checks as it is: static factories first, then live ones.
  await generate('stat-card', framework => `src/presentation/ui/static/${framework}`);
  for (const [id, content] of Object.entries(interactions)) {
    expect((await cli(['interactions', 'create', id, '--event', /^event: (\S+)$/m.exec(content)?.[1] ?? 'click'])).status, id).toBe(0);
    await writeFile(join(fixture.project, `interactions/${id}.md`), content);
  }
  for (const [id, content] of Object.entries(components)) {
    expect((await cli(['components', 'create', id, '--tag', 'article'])).status, id).toBe(0);
    await writeFile(join(fixture.project, `components/${id}.md`), content);
  }
  await generate('trip-planner', framework => `src/presentation/ui/live/${framework}`);
  // Use the Forge toolchain; no dependency install or network access. The checks run as the project's scripts do.
  const project = join(fixture.project, 'projects/demo');
  await symlink(resolve('node_modules'), join(project, 'node_modules'), 'junction');
  for (const name of ['lint', 'typecheck']) await check(project, name);
  // Nothing imports the output placed in the source and React, Vue and Angular are not dependencies, so the
  // dead-code analysis runs over the default placement only.
  await rm(join(project, 'src/presentation/ui'), { recursive: true });
  for (const name of ['structure', 'analyze']) await check(project, name);
}, 120_000);
