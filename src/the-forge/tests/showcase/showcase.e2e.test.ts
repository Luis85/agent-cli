import { beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { workspaceRoot } from '../support/workspace.ts';
import { listFiles } from '../../scripts/showcase/tree.mjs';

const showcase = join(workspaceRoot, 'src/forge-showcase');
const targets = ['html', 'htmx', 'vanilla', 'vue', 'svelte', 'react', 'angular'];
const libraries = ['--library', 'src/forge-showcase/library/components', '--interactions-library', 'src/forge-showcase/library/interactions'];
const portable = portableCli();
const cli = (args: string[]) => portable.cli(args);

/** Obsidian-style resolution: exact vault path or unique file name, with an optional .md extension. */
function unresolvedLinks(vault: string[], path: string, text: string) {
  const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  return [...prose.matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)]
    .map(match => (match[1] ?? '').trim())
    .filter(link => vault.filter(file => [link, `${link}.md`].some(name => file === name || basename(file) === name)).length !== 1)
    .map(link => `${path} -> ${link}`);
}

let tree: string[];
beforeAll(async () => {
  // The showcase script's own inventory skips its toolchain outputs (node_modules, dist, reports).
  tree = listFiles(showcase);
  // A private copy keeps the checkout's own project selection untouched.
  await mkdir(join(portable.project, 'bin'), { recursive: true });
  await writeFile(join(portable.project, 'bin/config.json'), JSON.stringify({ schemaVersion: 1, paths: { projects: 'src' } }));
  await cp(showcase, join(portable.project, 'src/forge-showcase'), { recursive: true, filter: source => !source.includes('node_modules') });
});

describe('committed showcase project', () => {
  it('regenerates without drift from the bundled CLI', async () => {
    // Asynchronous so the long regeneration does not block the test worker's event loop.
    const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>(done => {
      const child = execFile(process.execPath, ['scripts/showcase.mjs', '--check'], { encoding: 'utf8', timeout: 240_000, maxBuffer: 16 * 1024 * 1024 },
        (_error, stdout, stderr) => done({ status: child.exitCode, stdout, stderr }));
    });
    expect(result.stderr).toBe('');
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({ ok: true, differences: [], lockfile: [] });
    expect(result.status).toBe(0);
    expect(report.files).toBe(tree.filter(path => path !== 'package-lock.json').length);
  }, 300_000);

  it('contains an independent project toolchain, CI workflow, agent and skills', () => {
    for (const path of ['.forge/project.json', 'package.json', 'package-lock.json', 'tsconfig.json', 'vitest.config.ts', 'configs/quality/fallow.json',
      'src/infrastructure/workflows/check/check.yml', '.claude/agents/trailhead-reviewer.md', '.agents/skills/forge-workflow/SKILL.md']) {
      expect(tree).toContain(path);
    }
    expect(tree.filter(path => path.startsWith('tests/') && /\.(?:unit|integration)\.test\.ts$/.test(path)).length).toBeGreaterThanOrEqual(8);
  });

  it('keeps a connected Obsidian vault whose wikilinks all resolve', async () => {
    const notes = tree.filter(path => path.endsWith('.md') && !path.startsWith('.'));
    expect(notes).toEqual(expect.arrayContaining(['docs/Trailhead.md', 'docs/product/Trailhead PRD.md', 'docs/design/Trip planner design.md', 'docs/delivery/Trip planner verification plan.md']));
    // The showcase renamed the test plan and trashed a scratch note; nothing still names the old paths.
    expect(tree).not.toContain('docs/delivery/Trip planner test plan.md');
    expect(tree).toContain('.trash/docs/scratch/Packing ideas.md');
    const visible = tree.filter(path => !path.startsWith('.'));
    const broken = (await Promise.all(notes.map(async path => unresolvedLinks(visible, path, await readFile(join(showcase, path), 'utf8'))))).flat();
    expect(broken).toEqual([]);
  });

  it('validates its canvas and answers Bases queries through the CLI', () => {
    expect(cli(['project', 'open', 'forge-showcase']).status).toBe(0);
    expect(cli(['validate', 'docs/maps/Trailhead map.canvas']).body.data).toMatchObject({ valid: true, kind: 'canvas' });
    const query = cli(['bases', 'query', 'docs/bases/Requirements.base', '--view', 'REQ-004']);
    expect(query.status).toBe(0);
    expect(query.body.data.files).toEqual(expect.arrayContaining(['docs/product/Trailhead PRD.md', 'docs/use-cases/UC-002 Share an itinerary.md']));
  });

  it('generates UI and stories for every target and adapters with fixtures, all free of drift', () => {
    for (const target of targets) {
      expect(tree.some(path => path.startsWith(`ui/${target}/components/trip-planner.`))).toBe(true);
      expect(tree).toContain(`ui/${target}/stories/trip-planner.stories.ts`);
      const output = ['--out', `ui/${target}/components`, '--stories', '--stories-out', `ui/${target}/stories`];
      const check = cli(['make', 'ui', 'trip-planner', '--framework', target, '--project', 'forge-showcase', ...libraries, ...output, '--check']);
      expect(check.status, target).toBe(0);
    }
    for (const source of ['trips-api', 'trail-guides']) {
      expect(tree).toEqual(expect.arrayContaining([`src/infrastructure/data-sources/${source}.ts`, `test-data/${source}.fixtures.json`]));
      const check = cli(['make', 'data-source', source, '--library', 'src/forge-showcase/library/data-sources', '--out', 'src/infrastructure/data-sources', '--test-data-out', 'test-data', '--check']);
      expect(check.status, source).toBe(0);
    }
  });
});
