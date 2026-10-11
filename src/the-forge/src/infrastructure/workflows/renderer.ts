import { Document, isMap, isScalar, isSeq, parseDocument, Pair, YAMLMap, type Scalar } from 'yaml';
import { ensure } from '../../domain/shared/errors.ts';
import {
  generatedHeader, projectPathVariable, projectRelative, scopedTriggerPaths, type WorkflowSource,
} from '../../domain/workflows/workflow.ts';
import type { WorkflowRenderer } from '../../application/workflows/workflows.ts';

const scopedEvents = ['push', 'pull_request'];

/** One authored workflow being scoped to its project; every edit creates proper YAML nodes. */
class ScopedWorkflow {
  constructor(private readonly document: Document, private readonly root: YAMLMap, private readonly source: WorkflowSource) {}

  invalid(message: string): never {
    ensure(false, 'INVALID_WORKFLOW', `${this.source.source}: ${message}`);
  }

  /** Push and pull_request triggers run for the project's files and the generated entrypoint itself. */
  scopeTriggers() {
    const on = this.triggers();
    for (const event of scopedEvents) {
      if (!on.has(event)) continue;
      const trigger = this.mapAt(on, event);
      const paths = trigger.has('paths') ? this.patterns(trigger.get('paths', true), `on.${event}.paths`) : undefined;
      const pathsIgnore = trigger.has('paths-ignore') ? this.patterns(trigger.get('paths-ignore', true), `on.${event}.paths-ignore`) : undefined;
      if (paths && pathsIgnore) this.invalid(`on.${event} cannot declare both paths and paths-ignore.`);
      trigger.delete('paths-ignore');
      const scoped = scopedTriggerPaths({ ...(paths ? { paths } : {}), ...(pathsIgnore ? { pathsIgnore } : {}) }, this.source.projectDirectory, this.source.target);
      trigger.set('paths', this.document.createNode(scoped));
    }
  }

  /** Workflow-level `env.FORGE_PROJECT_PATH` lets action inputs such as cache paths name the project. */
  injectProjectPath() {
    this.mapAt(this.root, 'env', true).set(projectPathVariable, this.document.createNode(this.source.projectDirectory));
  }

  /** Authored working directories are project-relative; the workflow default is the project directory. */
  scopeWorkingDirectories() {
    const run = this.mapAt(this.mapAt(this.root, 'defaults', true), 'run');
    if (run.has('working-directory')) this.scopeWorkingDirectory(run);
    else run.set('working-directory', this.document.createNode(this.source.projectDirectory));
    const jobs = this.root.get('jobs', true);
    if (!isMap(jobs)) this.invalid('jobs must be a mapping.');
    for (const { value: job } of jobs.items) {
      if (!isMap(job)) this.invalid('every job must be a mapping.');
      const defaults = job.get('defaults', true);
      const jobRun = isMap(defaults) ? defaults.get('run', true) : undefined;
      if (isMap(jobRun)) this.scopeWorkingDirectory(jobRun);
      const steps = job.get('steps', true);
      if (isSeq(steps)) for (const step of steps.items) if (isMap(step)) this.scopeWorkingDirectory(step);
    }
  }

  private scopeWorkingDirectory(map: YAMLMap) {
    const value = map.get('working-directory', true);
    if (value === undefined) return;
    if (!isScalar(value) || typeof value.value !== 'string') this.invalid('working-directory must be a string.');
    if (!value.value.includes('${{')) value.value = projectRelative(value.value, this.source.projectDirectory);
  }

  /** `on: push` and `on: [push, pull_request]` become mappings so path filters can be attached. */
  private triggers(): YAMLMap {
    const on = this.root.get('on', true);
    if (isMap(on)) return on;
    const events = isScalar(on) && typeof on.value === 'string' ? [on.value]
      : isSeq(on) && on.items.every(item => isScalar(item) && typeof item.value === 'string') ? on.items.map(item => (item as Scalar<string>).value)
        : this.invalid('on must name events as a string, list or mapping.');
    const map = new YAMLMap();
    for (const event of events) map.set(event, this.document.createNode(null));
    this.root.set('on', map);
    return map;
  }

  /** An existing mapping, or a new one replacing a null value; new top-level keys precede `jobs`. */
  private mapAt(parent: YAMLMap, key: string, beforeJobs = false): YAMLMap {
    const existing = parent.get(key, true);
    if (isMap(existing)) return existing;
    if (existing !== undefined && !(isScalar(existing) && existing.value === null)) this.invalid(`${key} must be a mapping.`);
    const created = new YAMLMap();
    const jobs = parent.items.findIndex(pair => isScalar(pair.key) && pair.key.value === 'jobs');
    if (existing === undefined && beforeJobs && jobs >= 0) parent.items.splice(jobs, 0, new Pair(this.document.createNode(key), created));
    else parent.set(key, created);
    return created;
  }

  private patterns(node: unknown, name: string): string[] {
    if (!isSeq(node) || !node.items.every(item => isScalar(item) && typeof item.value === 'string')) this.invalid(`${name} must be a list of path patterns.`);
    return node.items.map(item => (item as Scalar<string>).value);
  }
}

/**
 * Parse with the YAML 1.2 core schema (so `on` stays a key, not a boolean), apply the project scope
 * and keep every other node, comment and scalar style verbatim. Output is deterministic for equal input.
 */
export const yamlWorkflowRenderer: WorkflowRenderer = {
  render(bytes, source) {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { ensure(false, 'INVALID_WORKFLOW', `${source.source}: the file is not valid UTF-8.`); }
    const document = parseDocument(text, { uniqueKeys: true, prettyErrors: false });
    ensure(!document.errors.length, 'INVALID_WORKFLOW', `${source.source}: ${document.errors.map(error => error.message).join('; ')}`);
    const root = document.contents;
    ensure(isMap(root) && root.has('on') && root.has('jobs'), 'INVALID_WORKFLOW', `${source.source}: a workflow must be a YAML mapping that declares on and jobs.`);
    const workflow = new ScopedWorkflow(document, root, source);
    workflow.scopeTriggers();
    workflow.injectProjectPath();
    workflow.scopeWorkingDirectories();
    return new TextEncoder().encode(`${generatedHeader(source.source)}\n${document.toString({ lineWidth: 0 })}`);
  },
};
