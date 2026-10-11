import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serverCommands } from '../../src/presentation/server/commands.ts';
import { commandInputSchema, commandMode, commandOptions, commandOutputSchema, optionTypes, validateCommandMetadata } from '../../src/application/plugins/command-metadata.ts';
import { declaredValues, parseArguments } from '../../src/presentation/cli/arguments.ts';
import { invocationPolicy } from '../../src/presentation/cli/invocation-policy.ts';
import type { CommandContext } from '../../src/application/plugins/registry.ts';
import type { ServerController, ServerStatus } from '../../src/application/server/contracts.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { scopeServices } from '../support/metadata.ts';
import { Localizer } from '../../src/presentation/localization/localization.ts';
import { validateJsonValue } from '../../src/domain/schema/json-schema.ts';

let root: string;
let context: CommandContext;
const stopped: ServerStatus = { running: false, stale: false, server: null, url: null, webviews: [] };
const controller: ServerController = {
  start: vi.fn(async () => stopped), status: vi.fn(async () => stopped), stop: vi.fn(async () => stopped),
};
const command = serverCommands(controller)[0]!;

beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(join(tmpdir(), 'forge-server-commands-'));
  const files = await NodeFiles.at(root);
  const events = new EventBus(new NodeEventScope());
  const workspace = new Workspace(files, new ObsidianDocuments(), events, false);
  context = { workspace, events, root, workspaceRoot: root, project: null, ...scopeServices(workspace, events), input: async () => new Uint8Array() };
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function invoke(args: string[], flags: Record<string, string | boolean> = {}) {
  return command.run(args, flags, context);
}

describe('server CLI controller boundary', () => {
  it('defaults to read-only workspace discovery and never starts a server while inspecting', async () => {
    expect(await invoke([])).toEqual(stopped);
    expect(await invoke(['status'])).toEqual(stopped);
    expect(controller.status).toHaveBeenCalledTimes(2);
    expect(controller.start).not.toHaveBeenCalled();
    expect(controller.stop).not.toHaveBeenCalled();
    expect(commandMode(command, [])).toEqual({ action: 'status', scope: 'workspace', discovery: true, mutating: false });
    for (const action of ['status', 'start', 'stop']) {
      expect(invocationPolicy(command, [action], {})).toEqual({ scope: 'workspace', activatePlugins: false });
    }
    expect(await readdir(root)).toEqual([]);
  });

  it('passes optional view and ephemeral port to the reusable controller without changing selection', async () => {
    await invoke(['start'], { port: '0', webview: 'admin' });
    expect(controller.start).toHaveBeenLastCalledWith({ port: 0, webview: 'admin', dryRun: false });
    await invoke(['start']);
    expect(controller.start).toHaveBeenLastCalledWith({ dryRun: false });
    await invoke(['start'], { port: '65535', webview: 'future-view' });
    expect(controller.start).toHaveBeenLastCalledWith({ port: 65535, webview: 'future-view', dryRun: false });
    expect(await readdir(root)).toEqual([]);
  });

  it('uses the effective workspace dry-run setting for both lifecycle mutations', async () => {
    context.workspace = new Workspace(context.workspace.files, context.workspace.codec, new EventBus(new NodeEventScope()), true);
    await invoke(['start']);
    await invoke(['stop']);
    expect(controller.start).toHaveBeenCalledWith({ dryRun: true });
    expect(controller.stop).toHaveBeenCalledWith({ dryRun: true });
    expect(await readdir(root)).toEqual([]);
  });

  it.each(['-1', '65536', '1.5', '1e3', 'NaN', '9007199254740992', ''])('rejects invalid port %j before controller calls', async port => {
    await expect(invoke(['start'], { port })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(controller.start).not.toHaveBeenCalled();
  });

  it.each(['../admin', 'Admin', '', 'admin/view', '__proto__'])('rejects invalid webview id %j', async webview => {
    await expect(invoke(['start'], { webview })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(controller.start).not.toHaveBeenCalled();
  });

  it('limits start options to start, with standard parser errors and one action argument', async () => {
    for (const action of ['status', 'stop']) {
      expect(() => parseArguments([action, '--port', '3000'], optionTypes(commandOptions(command, [action])))).toThrow(expect.objectContaining({ code: 'UNKNOWN_OPTION' }));
      await expect(invoke([action], { webview: 'admin' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    await expect(invoke(['start', 'extra'])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(invoke(['unknown'])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const options = commandOptions(command, ['start']);
    const parsed = parseArguments(['start', '--port', '3000', '--webview', 'admin'], optionTypes(options));
    await invoke(parsed.args, declaredValues(options, parsed.flags));
    expect(controller.start).toHaveBeenCalledWith({ port: 3000, webview: 'admin', dryRun: false });
  });

  it('publishes action input and output contracts and translated discovery text', () => {
    expect(() => validateCommandMetadata(command as unknown as Record<string, unknown>)).not.toThrow();
    expect(commandInputSchema(command)).toMatchObject({ oneOf: expect.arrayContaining([
      expect.objectContaining({ title: 'server start', properties: expect.objectContaining({ options: expect.objectContaining({ properties: expect.objectContaining({ port: { type: 'string', default: '0', description: expect.any(String) }, webview: expect.any(Object) }) }) }) }),
    ]) });
    expect(commandOutputSchema(command, ['status'])).toMatchObject({ required: ['running', 'stale', 'server', 'url', 'webviews'] });
    expect(command.actions!.start).toMatchObject({ mutating: true, destructive: false, idempotent: true });
    const localized = new Localizer('de').command(command);
    expect(localized.description).not.toBe(command.description);
    expect(localized.actions!.start!.description).not.toBe(command.actions!.start!.description);
    expect(localized.actions!.start!.options!.port!.description).not.toBe(command.actions!.start!.options!.port!.description);
    expect(localized.args![0]!.description).not.toBe(command.args![0]!.description);
  });

  it('distinguishes lifecycle results from status and documents preview-only fields', () => {
    expect(validateJsonValue(commandOutputSchema(command, ['status'])!, stopped, 'data').issues).toEqual([]);
    for (const action of ['start', 'stop']) {
      const output = commandOutputSchema(command, [action])!;
      expect(validateJsonValue(output, stopped, 'data').issues).toContain('data.changed: is required');
      for (const changed of [true, false]) {
        expect(validateJsonValue(output, { ...stopped, changed }, 'data').issues).toEqual([]);
        expect(validateJsonValue(output, { ...stopped, changed, dryRun: true }, 'data').issues).toEqual([]);
      }
      expect(validateJsonValue(output, { ...stopped, changed: false, dryRun: false }, 'data').issues).not.toEqual([]);
    }
  });
});
