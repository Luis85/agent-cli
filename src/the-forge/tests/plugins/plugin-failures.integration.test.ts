import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/shared/errors.ts';
import { isCodedFailure, PluginFailure } from '../../src/domain/shared/plugin-failure.ts';
import { webviewError } from '../../src/plugins/webviews/domain/errors.ts';
import { browserError } from '../../src/plugins/browser/domain/errors.ts';
import { updateError } from '../../src/plugins/updates/domain/release.ts';
import { fullRegistry } from '../support/full-registry.ts';

describe('plugin failures', async () => {
  const registry = await fullRegistry();

  it.each([
    ['webviews', webviewError('WEBVIEW_DRIFT', 'drift', { revision: 'r' }), 5],
    ['webviews', webviewError('WEBVIEW_INVALID', 'invalid'), 2],
    ['browser', browserError('BROWSER_FLOW_INVALID', 'flow'), 2],
    ['browser', browserError('BROWSER_CAPTURE_FAILED', 'capture'), 1],
    ['browser', browserError('BROWSER_INSTALL_FAILED', 'install'), 1],
    ['updates', updateError('UPDATE_DOWNLOAD_FAILED', 'download'), 1],
    ['updates', updateError('UPDATE_SCOPE_INVALID', 'scope'), 2],
  ] as const)('maps a %s failure to its catalog exit status through the owner', (pluginId, failure, exitCode) => {
    expect(failure).toBeInstanceOf(PluginFailure);
    expect(failure).not.toBeInstanceOf(AppError);
    const normalized = registry.catalog.normalize(failure, pluginId);
    expect(normalized).toBeInstanceOf(AppError);
    expect(normalized).toMatchObject({ code: failure.code, message: failure.message, exitCode, details: failure.details });
  });

  it('keeps another plugin\'s failure uncoded and leaves details out unless given', () => {
    const failure = webviewError('WEBVIEW_DRIFT', 'drift');
    expect(Object.hasOwn(failure, 'details')).toBe(false);
    expect(registry.catalog.normalize(failure, 'browser')).toBe(failure);
  });

  it('recognizes host errors and plugin failures as already coded, but not Node errors with a code', () => {
    expect(isCodedFailure(new AppError('NOT_FOUND', 'missing', 3))).toBe(true);
    expect(isCodedFailure(new PluginFailure('BROWSER_FLOW_FAILED', 'failed'))).toBe(true);
    expect(isCodedFailure(Object.assign(new Error('spawn curl ENOENT'), { code: 'ENOENT' }))).toBe(false);
  });
});
