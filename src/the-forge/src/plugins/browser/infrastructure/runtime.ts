import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Browser, Page } from 'playwright-core';
import type { BrowserImage, BrowserOptions, BrowserRuntime, BrowserStatus } from '../application/runtime.ts';
import type { TutorialLocator } from '../domain/tutorial.ts';
import { browserError, ensureBrowser } from '../domain/errors.ts';
import { AppError } from '../../../domain/shared/errors.ts';

const execute = promisify(execFile);
type Playwright = typeof import('playwright-core');
type Session = { browser: Browser; page: Page };

function proxy() {
  const configured = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
  if (!configured) return undefined;
  const url = new URL(configured);
  return { server: `${url.protocol}//${url.host}`,
    bypass: ['localhost', '127.0.0.1', '[::1]', process.env.NO_PROXY ?? process.env.no_proxy ?? ''].filter(Boolean).join(','),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}), ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
  };
}

function publicUrl(value: string): string {
  const url = new URL(value);
  ensureBrowser(['http:', 'https:'].includes(url.protocol), 'BROWSER_CAPTURE_FAILED', 'Browser navigation must remain on an HTTP or HTTPS page.');
  url.hash = ''; url.username = ''; url.password = '';
  return url.toString();
}

function locate(page: Page, locator: TutorialLocator) {
  if ('role' in locator) return page.getByRole(locator.role as Parameters<Page['getByRole']>[0], { name: locator.name, exact: true });
  if ('label' in locator) return page.getByLabel(locator.label, { exact: true });
  if ('testId' in locator) return page.getByTestId(locator.testId);
  return page.locator(locator.css);
}

/** Maps a failed filesystem check to a status reason; only the access check can reveal missing execution permission. */
function reasonFor(code: string | undefined, accessCheck = false): BrowserStatus['reason'] {
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing';
  return accessCheck && process.platform !== 'win32' && (code === 'EACCES' || code === 'EPERM') ? 'not-executable' : 'inaccessible';
}

/** The module is shipped intact: its internal asset resolution must retain the upstream directory layout. */
export function createBrowserRuntime(distributionPath: string): BrowserRuntime {
  const packageRoot = join(resolve(distributionPath), 'browser-runtime/playwright-core');
  const require = createRequire(join(packageRoot, 'package.json'));
  let loaded: Playwright | undefined;
  async function playwright() {
    // The package self-reference resolves from this anchored require, preserving its shipped exports/layout.
    try { return loaded ??= require('playwright-core') as Playwright; }
    catch { throw browserError('BROWSER_UNAVAILABLE', 'The packaged browser runtime is missing or invalid. Replace the complete Forge distribution.'); }
  }

  async function status(executablePath?: string, managed = false): Promise<BrowserStatus> {
    const api = await playwright();
    const configured = managed ? undefined : executablePath ?? process.env.FORGE_BROWSER_EXECUTABLE;
    const path = configured === undefined ? api.chromium.executablePath() : resolve(configured);
    const source = configured === undefined ? 'managed' : executablePath === undefined ? 'environment' : 'explicit';
    let reason: BrowserStatus['reason'] = 'available';
    try {
      if (!(await stat(path)).isFile()) reason = 'not-file';
    } catch (error) { reason = reasonFor((error as NodeJS.ErrnoException).code); }
    if (reason === 'available') {
      try { await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK); }
      catch (error) { reason = reasonFor((error as NodeJS.ErrnoException).code, true); }
    }
    let version: string;
    try { version = (JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as { version: string }).version; }
    catch { throw browserError('BROWSER_UNAVAILABLE', 'The packaged browser runtime metadata is missing. Replace the complete Forge distribution.'); }
    return { available: reason === 'available', executablePath: path, source, version, verification: 'executable-only', reason };
  }

  async function session(options: BrowserOptions): Promise<Session> {
    const info = await status(options.executablePath);
    ensureBrowser(info.available, 'BROWSER_UNAVAILABLE', 'No usable Chromium executable was found. Run browser install or provide --browser-executable.');
    let browser: Browser | undefined;
    try {
      browser = await (await playwright()).chromium.launch({ headless: true, channel: 'chromium', executablePath: info.executablePath!, timeout: options.timeoutMs, proxy: proxy() });
      const context = await browser.newContext({ viewport: options.viewport, deviceScaleFactor: 1, acceptDownloads: false, serviceWorkers: 'block' });
      context.setDefaultTimeout(options.timeoutMs); context.setDefaultNavigationTimeout(options.timeoutMs);
      await context.route('**/*', route => {
        const request = route.request();
        if (request.isNavigationRequest() && !/^https?:/.test(request.url())) return route.abort('blockedbyclient');
        return route.continue();
      });
      const page = await context.newPage();
      return { browser, page };
    } catch (error) {
      await browser?.close().catch(() => {});
      if (error instanceof AppError) throw error;
      throw browserError('BROWSER_UNAVAILABLE', 'Chromium could not start. Check the executable and its operating-system dependencies.');
    }
  }

  async function navigate(page: Page, url: string) {
    publicUrl(url);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    publicUrl(page.url());
  }

  async function capture(page: Page, fullPage: boolean, timeout: number): Promise<BrowserImage> {
    const url = publicUrl(page.url());
    const bytes = await page.screenshot({ type: 'png', fullPage, animations: 'disabled', timeout });
    return { bytes, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), url, title: await page.title(), capturedAt: new Date().toISOString() };
  }

  return {
    status,
    async install() {
      await playwright();
      const current = await status(undefined, true);
      if (current.available) return current;
      try {
        await execute(process.execPath, [join(packageRoot, 'cli.js'), 'install', 'chromium', '--no-shell'], {
          timeout: 600_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
        });
        const installed = await status(undefined, true);
        ensureBrowser(installed.available, 'BROWSER_INSTALL_FAILED', 'Chromium installation completed without a usable executable. Check the browser cache and try again.');
        return installed;
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw browserError('BROWSER_INSTALL_FAILED', 'Chromium installation failed. Check network access to the Playwright download hosts, available disk space and cache permissions; then retry.');
      }
    },
    async screenshot(request) {
      const started = Date.now();
      const { browser, page } = await session(request);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const operation = async () => {
          await navigate(page, request.url);
          if (request.waitForSelector) await page.locator(request.waitForSelector).waitFor({ state: 'visible' });
          return capture(page, request.fullPage, request.timeoutMs);
        };
        return await Promise.race([operation(), new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(browserError('BROWSER_CAPTURE_FAILED', 'The screenshot exceeded its total timeout. Increase --timeout-ms or simplify the page readiness condition.')), Math.max(1, request.timeoutMs - (Date.now() - started)));
        })]);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw browserError('BROWSER_CAPTURE_FAILED', 'The page could not be captured. Check its address, readiness selector and timeout, then retry.');
      } finally { clearTimeout(timer); await browser.close().catch(() => {}); }
    },
    async flow(request) {
      const values = new Map<object, string>();
      for (const step of request.plan.steps) for (const action of step.actions) {
        if (action.type === 'fill' && action.valueFromEnv !== undefined) {
          const value = process.env[action.valueFromEnv];
          ensureBrowser(value !== undefined, 'BROWSER_FLOW_FAILED', 'A required tutorial environment variable is not set.', { stepId: step.id });
          values.set(action, value);
        }
      }
      const { browser, page } = await session(request);
      const screenshots: Array<BrowserImage & { stepId: string }> = [];
      let stepId: string | undefined;
      let popupOpened = false;
      page.on('popup', () => { popupOpened = true; });
      page.context().on('page', opened => { if (opened !== page) popupOpened = true; });
      const ensureSinglePage = () => ensureBrowser(!popupOpened && page.context().pages().length === 1,
        'BROWSER_FLOW_FAILED', 'Tutorials support one browser tab. This step opened another tab or popup; revise the flow to navigate in the current tab.', stepId ? { stepId } : {});
      try {
        if (request.plan.startUrl) await navigate(page, request.plan.startUrl);
        for (const step of request.plan.steps) {
          stepId = step.id;
          for (const action of step.actions) {
            ensureSinglePage();
            if (action.type === 'goto') { await navigate(page, action.url); ensureSinglePage(); continue; }
            const target = locate(page, action.locator);
            if (action.type === 'click') await target.click();
            else if (action.type === 'fill') await target.fill(action.value !== undefined ? action.value : values.get(action)!);
            else if (action.type === 'select') await target.selectOption(action.value);
            else if (action.type === 'check') await target.setChecked(action.checked);
            else if (action.type === 'press') await target.press(action.key);
            else await target.waitFor({ state: action.state });
            ensureSinglePage();
          }
          ensureSinglePage();
          if (step.screenshot) screenshots.push({ ...await capture(page, step.fullPage, request.timeoutMs), stepId: step.id });
          ensureSinglePage();
        }
        return { screenshots, browserVersion: browser.version() };
      } catch (error) {
        if (error instanceof AppError && error.code === 'BROWSER_FLOW_FAILED') throw error;
        throw browserError('BROWSER_FLOW_FAILED', 'The tutorial could not complete. Inspect the failing step, locator and timeout before retrying.', stepId ? { stepId } : {});
      } finally { await browser.close().catch(() => {}); }
    },
  };
}
