import type { AgentConfigDocument, AgentDiagnostic } from '../domain/config.ts';

/** A parsed definition: its value when the YAML is well formed, syntax diagnostics, and pointer positions. */
export interface ParsedDefinition {
  value?: unknown;
  diagnostics: AgentDiagnostic[];
  /** 1-based source position of the value a JSON pointer names, or of its nearest existing ancestor. */
  locate(pointer: string): { line: number; column: number } | undefined;
}

/** docker-agent YAML text: parsing and comment-preserving edits. */
export interface DefinitionCodec {
  parse(text: string): ParsedDefinition;
  /** The file with `agent` added under `agents.<name>`; every other definition and comment is preserved. */
  addAgent(text: string, name: string, agent: Record<string, unknown>): string;
  /** A new definition file. */
  render(document: AgentConfigDocument): string;
}

/** Validation against the vendored docker-agent JSON Schema (draft-07). */
export interface DefinitionSchema { validate(value: unknown): AgentDiagnostic[] }

/** Markdown with YAML frontmatter, as Claude agents and skills use it. `parse` fails on missing frontmatter. */
export interface FrontmatterCodec {
  render(metadata: Record<string, unknown>, body: string): string;
  parse(text: string): { metadata: Record<string, unknown>; body: string };
}

export interface AgentPorts { codec: DefinitionCodec; schema: DefinitionSchema; markdown: FrontmatterCodec }
