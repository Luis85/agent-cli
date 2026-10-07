import { committedEvents } from '../support/events.ts';
import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;
let project: string;
beforeAll(() => { project = fixture.project; });

it('previews generation without side effects and refuses generator overwrite', async () => {
    const preview = cli(['make', 'entity', 'Task', '--out', 'domain', '--dry-run']);
    expect(preview.body.data.preview[0].content).toContain('class Task'); expect(committedEvents(preview.body.events)).toEqual([]);
    await expect(readFile(join(project, 'domain/task.ts'))).rejects.toThrow();
    expect(cli(['make', 'entity', 'Task', '--out', 'domain']).status).toBe(0);
    expect(cli(['make', 'entity', 'Task', '--out', 'domain']).body.error.code).toBe('CONFLICT');
    expect(cli(['make', 'entity', '../Task']).body.error.code).toBe('INVALID_NAME');
  });
