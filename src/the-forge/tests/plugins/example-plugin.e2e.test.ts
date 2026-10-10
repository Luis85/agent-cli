import { describe, expect, it } from 'vitest';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();

describe('the packaged quality example plugin', () => {
  it('reacts to vault renames and edits frontmatter through the app facade', async () => {
    const root = join(fixture.project, 'example');
    await mkdir(join(root, 'bin/plugins'), { recursive: true });
    await cp(join(fixture.bundle, 'bin/data/docs/examples/plugins/quality'), join(root, 'bin/plugins/quality'), { recursive: true });
    await writeFile(join(root, 'bin/config.json'), JSON.stringify({ plugins: { enabled: ['quality'] } }));
    const run = (...args: string[]) => fixture.cli(args, undefined, { root });
    expect(run('create', 'notes/Spec.md', '--content', '---\ndraft: true\n---\n# Spec\n').status).toBe(0);
    expect(run('quality.check').body.data).toEqual({ notes: 1 });

    const preview = run('quality.mark-reviewed', 'notes/Spec.md', '--dry-run');
    expect(preview.body.data.changes[0].diff).toContain('-draft: true\n+reviewed: true');
    const reviewed = run('quality.mark-reviewed', 'notes/Spec.md');
    expect(reviewed.status, reviewed.stdout).toBe(0);
    expect(await readFile(join(root, 'notes/Spec.md'), 'utf8')).toBe('---\nreviewed: true\n---\n# Spec\n');

    const revision = run('read', 'notes/Spec.md').body.data.revision;
    const moved = run('rename', 'notes/Spec.md', 'Requirements', '--if-match', revision);
    expect(moved.status, moved.stdout).toBe(0);
    expect(moved.body.warnings).toEqual(['Quality noticed notes/Spec.md moved to notes/Requirements.md; review notes that describe it.']);
  });
});
