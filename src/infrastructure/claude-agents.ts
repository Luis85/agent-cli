import { stringify } from 'yaml';
import { AppError, ensure, isRecord } from '../domain/errors.ts';
import { validateClaudeAgent, type ClaudeAgentDocument } from '../domain/claude-agents.ts';
import { ObsidianDocuments, parseMarkdownParts } from './documents.ts';

/** Keep authored prompt bytes intact while using the established Markdown/YAML boundary. */
export function parseClaudeAgent(text: string): ClaudeAgentDocument {
  try {
    ensure(typeof text === 'string', 'INVALID_CLAUDE_AGENT', 'Agent definition must be Markdown text.');
    const parts = parseMarkdownParts(text);
    ensure(parts.exists, 'INVALID_CLAUDE_AGENT', 'Agent definitions require YAML frontmatter on the first line.');
    const document = new ObsidianDocuments().inspect('agent.md', new TextEncoder().encode(text)) as { properties: unknown; body: string };
    validateClaudeAgent(document.properties, document.body);
    return { metadata: document.properties, prompt: document.body };
  } catch (error) {
    if (error instanceof AppError && error.code === 'INVALID_CLAUDE_AGENT') throw error;
    throw new AppError('INVALID_CLAUDE_AGENT', `Invalid agent definition: ${error instanceof Error ? error.message : String(error)}`, 2);
  }
}

/** Canonicalize frontmatter only; retain optional fields without adding defaults. */
export function renderClaudeAgent(document: ClaudeAgentDocument): string {
  ensure(isRecord(document), 'INVALID_CLAUDE_AGENT', 'Agent definition must contain metadata and prompt.');
  validateClaudeAgent(document.metadata, document.prompt);
  return `---\n${stringify(document.metadata)}---\n${document.prompt}`;
}
