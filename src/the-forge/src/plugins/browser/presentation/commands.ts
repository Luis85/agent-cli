import type { Command, PluginContext } from '../../../application/plugins/registry.ts';
import { ensure } from '../../../domain/shared/errors.ts';
import { option } from '../../../application/plugins/command-metadata.ts';
import { arity, integer, value } from '../../../application/plugins/command-input.ts';
import type { TutorialBlocks } from '../domain/tutorial.ts';
import type { BrowserRuntime } from '../application/runtime.ts';
import { BrowserScreenshot } from '../application/screenshot.ts';
import { BrowserTutorial } from '../application/tutorial.ts';
import { browserExecutable, browserTimeout, browserViewport, expectedRevision } from '../application/requests.ts';
import { browserStatusView } from './status.ts';
import { browserStatusSchema, installSchema, screenshotSchema, tutorialSchema, tutorialValidationSchema } from './schemas.ts';

const project = option.string('Use this project instead of the selected project.');
const executable = option.string('Use this Chromium executable; otherwise use FORGE_BROWSER_EXECUTABLE or the installed managed browser.');
const timeout = option.string('Browser operation timeout in milliseconds, from 1 to 120000.', { default: '30000' });
const revision = option.string('Current output revision from read (screenshot) or browser validate (tutorial); required before replacing existing output.');
const noSandbox = option.boolean('Run Chromium without its operating-system sandbox; only for trusted pages where the sandbox cannot start.');
const projectMode = { scope: 'project', projectOption: 'project', discovery: false } as const;

export function browserCommand(runtime: BrowserRuntime, blocks: TutorialBlocks): Command<PluginContext> {
  const screenshot = new BrowserScreenshot(runtime), tutorial = new BrowserTutorial(runtime, blocks);
  return {
    id: 'browser', description: 'Capture webpage screenshots and repeatable illustrated tutorials through the portable CLI.',
    usage: 'browser [status | install | screenshot <url> --out <image.png> | validate <source> | tutorial <source> --out <directory>]',
    scope: 'workspace', discovery: false, mutating: false, defaultAction: 'status', unknownAction: 'INVALID_ARGUMENT',
    args: [{ name: 'action', description: 'status (default), install, screenshot, validate or tutorial.', enum: ['status', 'install', 'screenshot', 'validate', 'tutorial'] },
      { name: 'source', description: 'Absolute HTTP(S) URL for screenshot, or a project-relative flow JSON, Markdown or Canvas source.' }],
    actions: {
      status: { description: 'Inspect executable-file availability without launching a browser or verifying browser compatibility.', discovery: true, output: browserStatusSchema,
        options: { 'browser-executable': executable } },
      install: { description: 'Download the managed Chromium browser explicitly; a dry run does not start the installer.', discovery: true,
        mutating: true, destructive: false, idempotent: true, output: installSchema },
      screenshot: { description: 'Save a webpage screenshot as a guarded PNG and return a Markdown image reference.', ...projectMode,
        mutating: true, destructive: true, idempotent: true, output: screenshotSchema,
        usage: 'browser screenshot <url> --out <image.png> [--width <pixels>] [--height <pixels>] [--full-page] [--wait-for-selector <selector>] [--timeout-ms <milliseconds>] [--browser-executable <path>] [--if-match <revision>] [--project <id>]',
        options: {
          project, out: option.string('Project-relative PNG output path.', { required: true }),
          width: option.string('Viewport width in pixels, from 1 to 7680.', { default: '1440' }),
          height: option.string('Viewport height in pixels, from 1 to 7680.', { default: '900' }),
          'full-page': option.boolean('Capture the full page instead of only the viewport.'),
          'wait-for-selector': option.string('Wait for this selector to become visible before capturing the page.'),
          'timeout-ms': timeout, 'browser-executable': executable, 'if-match': revision, 'no-browser-sandbox': noSandbox,
        } },
      validate: { description: 'Validate a declared tutorial flow without opening a browser and inspect its output revision.', ...projectMode,
        options: { project, out: option.string('Optional project-relative tutorial directory whose current revision should be inspected.') },
        output: tutorialValidationSchema },
      tutorial: { description: 'Replay a declared flow and atomically save its manual, screenshots and repeatable plan.', ...projectMode,
        mutating: true, destructive: true, idempotent: true,
        options: { project, out: option.string('Project-relative tutorial directory for index.md, screenshots and flow.json.', { required: true }),
          'timeout-ms': timeout, 'browser-executable': executable, 'if-match': revision, 'no-browser-sandbox': noSandbox },
        output: tutorialSchema },
    },
    errors: ['INVALID_ARGUMENT', 'INVALID_PATH', 'UNSAFE_PATH', 'CONFLICT', 'NOT_FOUND', 'BROWSER_UNAVAILABLE', 'BROWSER_CAPTURE_FAILED', 'BROWSER_INSTALL_FAILED', 'BROWSER_FLOW_INVALID', 'BROWSER_FLOW_FAILED'],
    async run(args, flags, context) {
      const action = args[0] ?? 'status';
      ensure(['status', 'install', 'screenshot', 'validate', 'tutorial'].includes(action), 'INVALID_ARGUMENT', 'Use browser status, install, screenshot, validate or tutorial.');
      if (action === 'status') { arity(args, 0, 1); return browserStatusView(await runtime.status(browserExecutable(value(flags, 'browser-executable'))), context.t); }
      if (action === 'install') {
        arity(args, 1);
        if (context.workspace.dryRun) return { dryRun: true, executed: false, plan: { browser: 'chromium', operation: 'install' } };
        return { dryRun: false, executed: true, status: browserStatusView(await runtime.install(), context.t) };
      }
      arity(args, 2);
      if (action === 'validate') return tutorial.validate(context, args[1]!, value(flags, 'out'));
      const out = value(flags, 'out', true)!;
      const timeoutMs = browserTimeout(integer(flags, 'timeout-ms', 1));
      const executablePath = browserExecutable(value(flags, 'browser-executable')), ifMatch = expectedRevision(value(flags, 'if-match'));
      const disableSandbox = flags['no-browser-sandbox'] === true;
      if (action === 'tutorial') return tutorial.run(context, { source: args[1]!, out, timeoutMs, executablePath, ifMatch, disableSandbox });
      return screenshot.run(context, { url: args[1]!, out, viewport: browserViewport(integer(flags, 'width', 1), integer(flags, 'height', 1)),
        fullPage: flags['full-page'] === true, waitForSelector: value(flags, 'wait-for-selector'), timeoutMs, executablePath, ifMatch, disableSandbox });
    },
  };
}
