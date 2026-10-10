import { committedEvents } from '../support/events.ts';
import { beforeAll, expect, it } from 'vitest';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;
let project: string, bundle: string;
beforeAll(() => { project = fixture.project; bundle = fixture.bundle; });

it('sets up a portable installation idempotently while preserving user-owned files', async () => {
    const installation = join(project, 'installed-workspace');
    await mkdir(installation);
    await writeFile(join(installation, 'AGENTS.md'), '# Existing engineering process\n');
    const invocation = { root: installation };
    const preview = cli(['setup', '--dry-run'], undefined, invocation);
    expect(preview.status).toBe(0); expect(committedEvents(preview.body.events)).toEqual([]);
    expect(preview.body.data.skipped).toContain('AGENTS.md');
    expect(await readdir(installation)).toEqual(['AGENTS.md']);
    const setup = cli(['setup'], undefined, invocation);
    expect(setup.status).toBe(0); expect(committedEvents(setup.body.events).length).toBeGreaterThan(0);
    expect(await readFile(join(installation, 'AGENTS.md'), 'utf8')).toBe('# Existing engineering process\n');
    expect(JSON.parse(await readFile(join(installation, 'bin/config.json'), 'utf8')).paths).toEqual({ projects: 'projects' });
    expect(await readFile(join(installation, '.agents/skills/forge-workflow/SKILL.md'), 'utf8')).toContain('CONFLICT');
    expect(await readFile(join(installation, 'bin/templates/entity.md'), 'utf8')).toContain('{{title}}');
    const repeated = cli(['setup'], undefined, invocation);
    expect(repeated.status).toBe(0); expect(repeated.body.data.changes).toEqual([]); expect(committedEvents(repeated.body.events)).toEqual([]);
    const installed = { entry: join(installation, 'bin/forge.js'), root: null, cwd: bundle };
    const config = cli(['config'], undefined, installed);
    expect(config.status).toBe(0); expect(config.body.data.root).toBe(installation);
    expect(cli(['make', 'document', 'Installed Entity', '--template', 'entity.md', '--date', '2026-10-07'], undefined, installed).status).toBe(0);
    expect(await readFile(join(installation, 'notes/Installed Entity.md'), 'utf8')).toContain('# Installed Entity');
  });
