import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tutorialBlocks } from '../../src/plugins/browser/infrastructure/tutorial-markdown.ts';
import { browserCommand } from '../../src/plugins/browser/presentation/commands.ts';
import { commandInputSchema, commandOptions, commandOutputSchema, optionTypes, validateCommandMetadata } from '../../src/application/plugins/command-metadata.ts';
import { validateJsonValue } from '../../src/domain/schema/json-schema.ts';
import { invocationPolicy } from '../../src/presentation/cli/invocation-policy.ts';
import { parseArguments } from '../../src/presentation/cli/arguments.ts';
import type { PluginContext } from '../../src/application/plugins/registry.ts';
import { browserStrings } from '../../src/plugins/browser/presentation/strings.ts';
import { browserStatusView } from '../../src/plugins/browser/presentation/status.ts';
import type { BrowserRuntime, BrowserStatus } from '../../src/plugins/browser/application/runtime.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { scopeServices } from '../support/metadata.ts';

let root: string, context: PluginContext;
const status: BrowserStatus = { available: false, executablePath: null, source: 'managed', version: '1.64.0', verification: 'executable-only', reason: 'missing' };
const runtime: BrowserRuntime = {
  status: vi.fn(async () => status), install: vi.fn(async () => ({ ...status, available: true, reason: 'available' as const })),
  screenshot: vi.fn(async () => { throw new Error('No capture expected'); }),
  flow: vi.fn(async () => { throw new Error('No flow expected'); }),
};
const command = browserCommand(runtime, tutorialBlocks);
const messages = (language: 'en' | 'de') => (key: string) => browserStrings[language]?.messages?.[key] ?? browserStrings.en?.messages?.[key] ?? key;
beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(join(tmpdir(), 'forge-browser-command-'));
  const files = await NodeFiles.at(root), events = new EventBus(new NodeEventScope());
  const workspace = new Workspace(files, new ObsidianDocuments(), events, false);
  context = { workspace, events, root, workspaceRoot: root, project: null, ...scopeServices(workspace, events), input: async () => new Uint8Array(),
    settings: null, services: {} as PluginContext['services'], t: messages('en') };
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const invoke = (args: string[], flags: Record<string, string | boolean> = {}) => command.run(args, flags, context);

describe('browser command contracts', () => {
  it('defaults to workspace browser status independently of project selection', async () => {
    expect(await invoke([])).toEqual({ ...status, nextStep: 'Run browser install or pass --browser-executable for an installed Chromium.' });
    expect(invocationPolicy(command, [], {})).toEqual({ scope: 'workspace', activatePlugins: false });
    expect(runtime.install).not.toHaveBeenCalled();
    expect(runtime.screenshot).not.toHaveBeenCalled();
    expect(validateJsonValue(commandOutputSchema(command, ['status'])!, await invoke([]), 'data').issues).toEqual([]);
  });

  it('derives localized recovery guidance from the status reason and source', () => {
    const en = messages('en'), de = messages('de');
    expect(browserStatusView({ ...status, available: true, reason: 'available' }, en).nextStep).toBeNull();
    expect(browserStatusView({ ...status, source: 'environment' }, en).nextStep).toBe('Update FORGE_BROWSER_EXECUTABLE or pass --browser-executable for an installed Chromium.');
    expect(browserStatusView({ ...status, source: 'explicit', reason: 'not-executable' }, en).nextStep)
      .toBe('Check execution permissions on the selected file. Pass --browser-executable with the path to an installed Chromium.');
    expect(browserStatusView({ ...status, reason: 'inaccessible' }, de).nextStep)
      .toBe('Prüfen Sie den Zugriff auf den ausgewählten Pfad und seine übergeordneten Ordner. Führen Sie browser install aus oder übergeben Sie mit --browser-executable einen installierten Chromium-Browser.');
    expect(browserStatusView({ ...status, source: 'explicit', reason: 'not-file' }, de).nextStep).toBe('Übergeben Sie mit --browser-executable den Pfad zu einem installierten Chromium-Browser.');
  });

  it('installs only explicitly and dry-runs installation without runtime calls', async () => {
    context.workspace = new Workspace(context.workspace.files, context.workspace.codec, new EventBus(new NodeEventScope()), true);
    const preview = await invoke(['install']);
    expect(preview).toEqual({ dryRun: true, executed: false, plan: { browser: 'chromium', operation: 'install' } });
    expect(runtime.install).not.toHaveBeenCalled();
    expect(runtime.status).not.toHaveBeenCalled();
    expect(validateJsonValue(commandOutputSchema(command, ['install'])!, preview, 'data').issues).toEqual([]);
    expect(await readdir(root)).toEqual([]);
    context.workspace = new Workspace(context.workspace.files, context.workspace.codec, new EventBus(new NodeEventScope()), false);
    const result = await invoke(['install']);
    expect(result).toMatchObject({ executed: true, dryRun: false, status: { available: true, nextStep: null } });
    expect(runtime.install).toHaveBeenCalledOnce();
    expect(validateJsonValue(commandOutputSchema(command, ['install'])!, result, 'data').issues).toEqual([]);
  });

  it('routes capture and tutorials through project metadata and publishes action-specific options', () => {
    expect(() => validateCommandMetadata(command as unknown as Record<string, unknown>)).not.toThrow();
    for (const action of ['screenshot', 'tutorial', 'validate']) {
      expect(invocationPolicy(command, [action], { project: 'demo' })).toEqual({ scope: 'project', activatePlugins: true, requestedProject: 'demo' });
    }
    expect(() => parseArguments(['status', '--out', 'image.png'], optionTypes(commandOptions(command, ['status'])))).toThrow(expect.objectContaining({ code: 'UNKNOWN_OPTION' }));
    expect(commandInputSchema(command)).toMatchObject({ oneOf: expect.arrayContaining([
      expect.objectContaining({ title: 'browser screenshot', properties: expect.objectContaining({ options: expect.objectContaining({ required: ['out'] }) }) }),
    ]) });
  });

  it('uses screenshot defaults in a truthful no-browser preview', async () => {
    context.workspace = new Workspace(context.workspace.files, context.workspace.codec, new EventBus(new NodeEventScope()), true);
    const preview = await invoke(['screenshot', 'https://example.test'], { out: 'docs/example.png' });
    expect(preview).toMatchObject({ captured: false, dryRun: true, plan: { viewport: { width: 1440, height: 900 }, fullPage: false, timeoutMs: 30000 } });
    expect(validateJsonValue(commandOutputSchema(command, ['screenshot'])!, preview, 'data').issues).toEqual([]);
    expect(runtime.screenshot).not.toHaveBeenCalled();
  });

  it.each([{ width: '-1' }, { height: '1.5' }, { 'timeout-ms': '0' }, { 'browser-executable': '' }] as Record<string, string>[])('rejects malformed capture options before runtime work: %j', async flags => {
    await expect(invoke(['screenshot', 'https://example.test'], { out: 'image.png', ...flags })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(runtime.screenshot).not.toHaveBeenCalled();
  });

  it('rejects missing output and unknown actions without browser work', async () => {
    await expect(invoke(['screenshot', 'https://example.test'])).rejects.toMatchObject({ code: 'MISSING_ARGUMENT' });
    await expect(invoke(['unknown'])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(runtime.screenshot).not.toHaveBeenCalled();
  });
});
