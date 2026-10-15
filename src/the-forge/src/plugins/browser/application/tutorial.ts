import type { CommandContext } from '../../../application/plugins/registry.ts';
import type { FileSnapshot, FileStat } from '../../../domain/documents/file.ts';
import { vaultPath } from '../../../domain/documents/file.ts';
import { AppError, ensure } from '../../../domain/shared/errors.ts';
import { extractTutorial, type TutorialPlan, type TutorialBlocks } from '../domain/tutorial.ts';
import { ensureBrowser, browserError } from '../domain/errors.ts';
import type { BrowserRuntime, BrowserFlowResult } from './runtime.ts';
import { browserTimeout, expectedRevision, imageMarkdown } from './requests.ts';

async function optionalStat(context: CommandContext, path: string): Promise<FileStat | null> {
  try { return await context.workspace.files.stat(path); }
  catch (error) { if (error instanceof AppError && error.code === 'NOT_FOUND') return null; throw error; }
}
function plannedFiles(plan: TutorialPlan) {
  return ['index.md', 'flow.json', ...plan.steps.filter(step => step.screenshot).map(step => `screenshots/${step.id}.png`)];
}
function publicUrl(value: string): string {
  const url = new URL(value);
  url.hash = ''; url.search = ''; url.username = ''; url.password = '';
  return url.href;
}
function heading(value: string) { return value.replaceAll('\r', ' ').replaceAll('\n', ' ').replaceAll('#', '\\#'); }
function manual(plan: TutorialPlan, result: BrowserFlowResult): string {
  const lines = [`# ${heading(plan.title)}`, '', ...(plan.description ? [plan.description, ''] : []),
    `[Replay plan](<flow.json>) · Viewport: ${plan.viewport.width} × ${plan.viewport.height}`, ''];
  for (const [index, step] of plan.steps.entries()) {
    lines.push(`## ${index + 1}. ${heading(step.title)}`, '');
    if (step.text) lines.push(step.text, '');
    const image = result.screenshots.find(image => image.stepId === step.id);
    if (image) lines.push(imageMarkdown(`screenshots/${step.id}.png`, step.title), '',
      `Page: <${publicUrl(image.url)}> · Captured: ${image.capturedAt} · ${image.width} × ${image.height}`, '');
  }
  return lines.join('\n');
}

/** Sequential browser work finishes before one guarded publication of the complete tutorial bundle. */
export class BrowserTutorial {
  constructor(private readonly runtime: BrowserRuntime, private readonly blocks: TutorialBlocks) {}

  private async inspect(context: CommandContext, source: string, out?: string) {
    vaultPath(source);
    const snapshot = await context.workspace.files.read(source);
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(snapshot.bytes); }
    catch { throw browserError('BROWSER_FLOW_INVALID', 'Tutorial source must be valid UTF-8.'); }
    const plan = extractTutorial(text, source, this.blocks);
    let current: FileStat | null = null;
    if (out !== undefined) {
      vaultPath(out);
      ensure(source === `${out}/flow.json` || (source !== out && !source.startsWith(`${out}/`)), 'INVALID_ARGUMENT', 'Keep source documents outside the output directory, or replay its generated flow.json.');
      current = await optionalStat(context, out);
      // Resolve each future destination now, including missing children of unsafe existing parents.
      for (const path of plannedFiles(plan)) {
        const destination = await optionalStat(context, `${out}/${path}`);
        ensure(destination === null || destination.kind === 'file', 'INVALID_ARGUMENT', `Tutorial output must be a regular file: ${out}/${path}`);
      }
      ensure(current === null || current.kind === 'folder', 'INVALID_ARGUMENT', '--out must name a directory.');
      if (current?.kind === 'folder') {
        ensureBrowser(current.files.includes('index.md') && current.files.includes('flow.json') &&
          current.files.every(path => ['index.md', 'flow.json'].includes(path) || /^screenshots\/[a-z][a-z0-9-]{0,63}\.png$/.test(path)) &&
          current.folders.every(path => path === 'screenshots'), 'BROWSER_FLOW_INVALID', 'Output contains unrelated files or is not a generated tutorial. Choose a dedicated output directory.');
      }
    }
    return { snapshot, plan, current, report: { source, sourceRevision: snapshot.revision, plan, output: out ?? null,
      revision: current?.revision ?? null, files: plannedFiles(plan) } };
  }

  async validate(context: CommandContext, source: string, out?: string) {
    return (await this.inspect(context, source, out)).report;
  }

  async run(context: CommandContext, input: { source: string; out: string; ifMatch?: string; executablePath?: string; timeoutMs?: number }) {
    const { source, out } = input;
    const timeoutMs = browserTimeout(input.timeoutMs), ifMatch = expectedRevision(input.ifMatch);
    ensure(input.executablePath === undefined || (input.executablePath.trim().length > 0 && !input.executablePath.includes('\0')), 'INVALID_ARGUMENT', '--browser-executable must name a browser executable.');
    const { snapshot, plan, current, report } = await this.inspect(context, source, out);
    ensure(ifMatch === (current?.revision ?? undefined), 'CONFLICT', current ? 'Validate the existing tutorial and pass its folder revision with --if-match before replacing it.' : 'The output no longer exists; omit --if-match to create it.',
      { path: out, expectedRevision: ifMatch ?? null, currentRevision: current?.revision ?? null });
    const guards = [{ path: source, expectedRevision: snapshot.revision }, { path: out, ...(current ? { expectedRevision: current.revision } : {}) }];
    if (context.workspace.dryRun) {
      await context.workspace.commit({ guards }, { operation: 'apply' });
      return { ...report, dryRun: true, executed: false, changes: [], browserVersion: null };
    }
    const previous = new Map<string, FileSnapshot>();
    if (current?.kind === 'folder') for (const path of current.files) previous.set(path, await context.workspace.files.read(`${out}/${path}`));
    const captured = await this.runtime.flow({ plan, viewport: plan.viewport, timeoutMs, ...(input.executablePath ? { executablePath: input.executablePath } : {}) });
    const required = new Set(plan.steps.filter(step => step.screenshot).map(step => step.id));
    ensureBrowser(captured.screenshots.length === required.size && captured.screenshots.every(image => required.delete(image.stepId) && image.bytes.length > 0),
      'BROWSER_FLOW_FAILED', 'Browser did not return exactly one screenshot for every requested tutorial step. No output was published.');
    const encode = (value: string) => new TextEncoder().encode(value);
    const contents = new Map<string, Uint8Array>([
      ['index.md', encode(manual(plan, captured))], ['flow.json', encode(`${JSON.stringify(plan, null, 2)}\n`)],
      ...captured.screenshots.map(image => [`screenshots/${image.stepId}.png`, image.bytes] as [string, Uint8Array]),
    ]);
    const writes = [...contents].map(([path, bytes]) => ({ path: `${out}/${path}`, bytes,
      ...(previous.has(path) ? { expectedRevision: previous.get(path)!.revision } : {}) }));
    const removes = [...previous].filter(([path]) => !contents.has(path)).map(([, file]) => ({ path: file.path, expectedRevision: file.revision }));
    const result = await context.workspace.commit({ guards, writes, removes }, { operation: 'apply' });
    return { ...report, revision: (await context.workspace.files.stat(out)).revision, dryRun: false, executed: true,
      changes: result.changes, browserVersion: captured.browserVersion };
  }
}
