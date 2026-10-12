import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { committedEvents } from '../support/events.ts';

const fixture = portableCli();

it('exposes webview scaffolding in discovery and the portable guarded project workflow', async () => {
  const schema = await fixture.cli(['schema', 'project']);
  expect(schema.status).toBe(0);
  expect(schema.body.data.commands[0].annotations.actions.create.options.type).toMatchObject({ enum: ['library', 'webview'], default: 'library' });
  const preview = await fixture.cli(['project', 'create', 'task-board', '--type', 'webview', '--dry-run']);
  expect(preview.status).toBe(0);
  expect(preview.body.data.project.type).toBe('webview');
  expect(committedEvents(preview.body.events)).toEqual([]);
  await expect(readFile(join(fixture.project, 'projects/task-board/package.json'))).rejects.toThrow();
  expect((await fixture.cli(['project', 'create', 'task-board', '--type', 'webview'])).status).toBe(0);
  const opened = await fixture.cli(['project', 'open', 'task-board']);
  expect(opened.body.data.project.type).toBe('webview');
  const read = await fixture.cli(['read', 'package.json']);
  expect(read.status).toBe(0);
  expect(read.body.context.project.type).toBe('webview');
  expect((await fixture.cli(['project', 'create', 'invalid', '--type', 'unknown'])).body.error.code).toBe('INVALID_OPTION_VALUE');
  expect((await fixture.cli(['project', 'list', '--type', 'webview'])).body.error.code).toBe('UNKNOWN_OPTION');
  expect((await fixture.cli(['project', 'create', 'admin', '--type', 'webview'])).body.error).toMatchObject({ code: 'INVALID_PROJECT_NAME', message: expect.stringContaining('reserved') });
});
