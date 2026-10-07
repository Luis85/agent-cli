import { AppError, ensure } from '../domain/errors.ts';
import { vaultPath, type WriteRequest } from '../domain/file.ts';
import type { AppConfig } from './config.ts';
import type { Skill } from './plugins.ts';
import type { Workspace } from './workspace.ts';

export interface SetupArtifact { path: string; bytes: Uint8Array }
const encode = (value: string) => new TextEncoder().encode(value);
const instructions = `# The Forge workflow

Read bin/app/README.md and bin/app/docs/cli.md before using the CLI.
Run \`node bin/app help\` or \`node bin/app schema --json\` to discover commands.
Project defaults and enabled plugins live in bin/config.json.

Establish acceptance criteria before generating or editing files. Read existing files first,
preview mutations with --dry-run, and supply the current revision with --if-match when replacing files.
Treat conflicts as a request to reread and reconcile. Verify changes with the project's checks.
Keep domain invariants explicit, application use cases dependent on injected ports, and adapters at the edges.
Use clear names and focused functions; verify acceptance criteria and failure behavior with meaningful tests.
Use the installed agent skills for the development and file-editing workflows.
Enable only reviewed plugins: plugins execute with Node's permissions.
`;
const entityTemplate = `---
type: entity
title: '{{title}}'
created: '{{date:YYYY-MM-DD}}'
---
# {{title}}

Created: {{date:YYYY-MM-DD}}

## Purpose

Describe the entity's responsibility and identity.

## Invariants

- Define the rules that must always hold.

## Acceptance criteria

- Describe observable behavior and verification.
`;

/** Idempotent installation: existing project files always remain owned by the user. */
export class SetupService {
  constructor(
    private readonly workspace: Workspace,
    private readonly config: AppConfig,
    private readonly artifacts: readonly SetupArtifact[],
    private readonly skills: readonly Skill[],
  ) {}

  async run() {
    ensure(this.artifacts.some(artifact => artifact.path === 'app.cjs') && this.artifacts.some(artifact => artifact.path === 'package.json'), 'INVALID_SETUP', 'Setup requires the complete built app directory. Run the bundled CLI or build it first.');
    const portableConfig: AppConfig = { ...this.config, paths: { ...this.config.paths, root: '..' } };
    const candidates: WriteRequest[] = [
      ...this.artifacts.map(artifact => ({ path: `bin/app/${vaultPath(artifact.path)}`, bytes: Uint8Array.from(artifact.bytes) })),
      { path: 'bin/config.json', bytes: encode(JSON.stringify(portableConfig, null, 2) + '\n') },
      ...this.skills.map(skill => ({ path: `${this.config.paths.skills}/${vaultPath(skill.id)}/SKILL.md`, bytes: encode(skill.content) })),
      { path: `${this.config.paths.templates}/entity.md`, bytes: encode(entityTemplate) },
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
    return { ...result, skipped };
  }
}
