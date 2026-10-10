import { AppError, ensure } from '../../domain/shared/errors.ts';
import { vaultPath, type WriteRequest } from '../../domain/documents/file.ts';
import type { AppConfig } from './config.ts';
import type { Skill } from '../plugins/registry.ts';
import type { Workspace } from './workspace.ts';
import { skillPaths, skillTargets } from '../../domain/skills/skill.ts';

export interface SetupArtifact { path: string; bytes: Uint8Array }
/** An editable Markdown template; `path` is relative to the workspace's `bin/templates`. */
export interface TemplateArtifact { path: string; content: string }
/**
 * The `templates.installer` service of the `templates` core plugin: the editable templates `setup` installs into
 * `bin/templates`. Without an available provider, setup installs no templates and warns.
 */
export interface TemplateInstallerService { setupTemplates(): readonly TemplateArtifact[] }
export const templateInstallerService = 'templates.installer';
const encode = (value: string) => new TextEncoder().encode(value);
const instructions = `# The Forge workflow

Read bin/data/README.md and bin/data/docs/reference/cli.md before using the CLI.
Run \`node bin/forge.js help\` or \`node bin/forge.js schema --json\` to discover commands.
Environment settings and enabled plugins live in bin/config.json.
Shared templates live in bin/templates and plugins live in bin/plugins.

Run \`node bin/forge.js project list\` to discover projects, then
\`node bin/forge.js project open <id>\` to select a project before working on its files.
Check \`node bin/forge.js project current\` before scoped operations; paths resolve inside the open project.
Run \`node bin/forge.js project close\` when finished with that project.

Establish acceptance criteria before generating or editing files. Read existing files first,
preview mutations with --dry-run, and supply the current revision with --if-match when replacing files.
Treat conflicts as a request to reread and reconcile. Verify changes with the project's checks.
Keep domain invariants explicit, application use cases dependent on injected ports, and adapters at the edges.
Use clear names and focused functions; verify acceptance criteria and failure behavior with meaningful tests.
Use the installed agent skills in .claude/skills or .agents/skills for the development and file-editing workflows.
Enable only reviewed plugins: plugins execute with Node's permissions.
`;
/** Idempotent installation: existing project files always remain owned by the user. */
export class SetupService {
  constructor(
    private readonly workspace: Workspace,
    private readonly config: AppConfig,
    private readonly artifacts: readonly SetupArtifact[],
    private readonly skills: readonly Skill[],
    /** The templates to install, or null when the `templates` core plugin is disabled or unavailable. */
    private readonly templates: readonly TemplateArtifact[] | null,
  ) {}

  async run() {
    ensure(this.artifacts.some(artifact => artifact.path === 'forge.js') && this.artifacts.some(artifact => artifact.path === 'package.json'), 'INVALID_SETUP', 'Setup requires the complete built bin distribution. Run the bundled CLI or build it first.');
    const candidates: WriteRequest[] = [
      ...this.artifacts.map(artifact => ({ path: `bin/${vaultPath(artifact.path)}`, bytes: Uint8Array.from(artifact.bytes) })),
      { path: 'bin/config.json', bytes: encode(JSON.stringify(this.config, null, 2) + '\n') },
      // Every skill goes to both agent skill roots: .claude/skills for Claude Code and .agents/skills for other agents.
      ...this.skills.flatMap(skill => skillPaths(vaultPath(skill.id), Object.values(skillTargets)).map(path => ({ path, bytes: encode(skill.content) }))),
      ...(this.templates ?? []).map(template => ({ path: `bin/templates/${vaultPath(template.path)}`, bytes: encode(template.content) })),
      { path: 'bin/plugins/.gitkeep', bytes: new Uint8Array() },
      { path: `${this.config.paths.projects}/.gitkeep`, bytes: new Uint8Array() },
      { path: 'AGENTS.md', bytes: encode(instructions) },
    ];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      vaultPath(candidate.path);
      ensure(!seen.has(candidate.path), 'INVALID_SETUP', `Setup destinations overlap: ${candidate.path}`);
      seen.add(candidate.path);
    }
    const writes: WriteRequest[] = [], skipped: string[] = [];
    for (const candidate of candidates) {
      try { await this.workspace.files.read(candidate.path); skipped.push(candidate.path); }
      catch (error) {
        if (!(error instanceof AppError) || error.code !== 'NOT_FOUND') throw error;
        writes.push(candidate);
      }
    }
    // An empty plan is a successful no-op, not an invalid workspace write.
    const result = writes.length ? await this.workspace.write(writes) : { dryRun: this.workspace.dryRun, changes: [] };
    return { ...result, skipped, nextSteps: [
      ...(this.templates === null ? [] : [
        { scope: 'workspace', command: 'node bin/forge.js templates list', purpose: 'Discover the installed editable planning templates.' },
        { scope: 'workspace', command: 'node bin/forge.js templates inspect workflow/prd.md', purpose: 'Inspect planning inputs before generating a requirements document.' },
      ]),
      { scope: 'workspace', command: 'node bin/forge.js project list', purpose: 'Find a project, then explicitly open it before generating project files.' },
    ] };
  }
}
