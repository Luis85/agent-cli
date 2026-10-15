import { describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { validateJsonValue } from '../../src/domain/schema/json-schema.ts';

const fixture = portableCli();

describe('portable browser status diagnostics', () => {
  it('explains missing overrides and validates filesystem-only results against the published schema', async () => {
    const missing = join(fixture.project, 'missing-chromium');
    const schema = await fixture.cli(['schema', 'browser']);
    expect(schema.status).toBe(0);
    const output = schema.body.data.commands[0].annotations.actions.status.outputSchema;
    const before = await readdir(fixture.project);
    const unavailable = await fixture.cli(['browser', 'status'], undefined, { env: { FORGE_BROWSER_EXECUTABLE: missing } });
    expect(unavailable.status).toBe(0);
    expect(unavailable.body.data).toMatchObject({ available: false, executablePath: missing, source: 'environment',
      verification: 'executable-only', reason: 'missing', nextStep: expect.stringContaining('FORGE_BROWSER_EXECUTABLE') });
    expect(validateJsonValue(output, unavailable.body.data, 'data').issues).toEqual([]);
    const available = await fixture.cli(['browser', 'status', '--browser-executable', process.execPath], undefined,
      { env: { FORGE_BROWSER_EXECUTABLE: missing } });
    expect(available.status).toBe(0);
    expect(available.body.data).toMatchObject({ available: true, executablePath: process.execPath, source: 'explicit',
      verification: 'executable-only', reason: 'available', nextStep: null });
    expect(output.properties.version.description).toContain('Playwright');
    expect(validateJsonValue(output, available.body.data, 'data').issues).toEqual([]);
    const german = await fixture.cli(['--lang', 'de', 'browser', 'status'], undefined, { env: { FORGE_BROWSER_EXECUTABLE: missing } });
    expect(german.status).toBe(0);
    expect(german.body.data).toMatchObject({ available: false, source: 'environment', reason: 'missing',
      nextStep: 'Passen Sie FORGE_BROWSER_EXECUTABLE an oder übergeben Sie mit --browser-executable einen installierten Chromium-Browser.' });
    expect(validateJsonValue(output, german.body.data, 'data').issues).toEqual([]);
    expect(available.body.events).toEqual([]);
    expect(await readdir(fixture.project)).toEqual(before);
  }, 30_000);
});
