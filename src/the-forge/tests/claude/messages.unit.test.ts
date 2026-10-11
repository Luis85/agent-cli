import { describe, expect, it } from 'vitest';
import type { CommandContext } from '../../src/application/plugins/registry.ts';
import { fill } from '../../src/domain/shared/messages.ts';
import { claudeMessages, type ClaudeMessage } from '../../src/plugins/claude/domain/messages.ts';
import { germanClaudeMessages, withLocalizedResults } from '../../src/plugins/claude/presentation/messages.ts';

const result = {
  valid: true, validation: 'structure',
  diagnostics: [{ path: 'agents/a.md', severity: 'warning', message: fill(claudeMessages.ignoredAgentField, { key: 'hooks' }) }],
  limitations: [claudeMessages.noCodeExecuted],
  stdout: 'Native Claude Code output stays as printed.',
};
const command = withLocalizedResults({ id: 'claude', description: 'Claude', usage: 'claude', run: () => result });
const run = (language: 'en' | 'de') => command.run([], {}, { language } as CommandContext);

describe('claude result texts', () => {
  it('read in German, keeping values, paths and native output', async () => {
    expect(await run('de')).toEqual({
      ...result,
      diagnostics: [{ ...result.diagnostics[0], message: 'Claude ignoriert hooks in Plugin-Agenten; verwenden Sie für agentenspezifische Konfiguration einen Projekt- oder Benutzeragenten.' }],
      limitations: ['Es wurden kein Plugin-Code, keine Hooks und keine MCP- oder LSP-Server ausgeführt.'],
    });
    expect(await run('en')).toBe(result);
  });

  it('have a distinct German text with the same placeholders for every English one', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const key of Object.keys(claudeMessages) as ClaudeMessage[]) {
      expect(germanClaudeMessages[key], key).not.toBe(claudeMessages[key]);
      expect(placeholders(germanClaudeMessages[key]), key).toEqual(placeholders(claudeMessages[key]));
    }
  });
});
