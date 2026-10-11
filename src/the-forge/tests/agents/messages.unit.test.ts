import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fill } from '../../src/domain/shared/messages.ts';
import { agentMessages, type AgentMessage } from '../../src/plugins/agents/domain/messages.ts';
import { germanAgentMessages, localizedDiagnostics } from '../../src/plugins/agents/presentation/messages.ts';

const placeholders = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]!))].sort();
const keys = Object.keys(agentMessages) as AgentMessage[];
const diagnostic = (message: string) => ({ severity: 'warning', code: 'toolset-approximated', pointer: '/agents/root', message });

describe('agents diagnostic messages', () => {
  it('have a distinct German template for every English one, using only its placeholders', () => {
    for (const key of keys) {
      expect(germanAgentMessages[key], key).not.toBe(agentMessages[key]);
      expect(placeholders(germanAgentMessages[key]).filter(name => !placeholders(agentMessages[key]).includes(name)), key).toEqual([]);
    }
  });

  it('render each English message in German from the template that produced it, never from another', () => {
    for (const key of keys) {
      const params = Object.fromEntries(placeholders(agentMessages[key]).map(name => [name, `v${name}`]));
      const [localized] = localizedDiagnostics([diagnostic(fill(agentMessages[key], params))], 'de');
      expect(localized!.message, key).toBe(fill(germanAgentMessages[key], params));
    }
  });

  it('render nested fragments and leave docker-agent and parser messages, codes and pointers alone', () => {
    const reason = fill(agentMessages.reasonUnmapped, { tools: 'create_directory, think' });
    const english = { files: [{ path: 'agents/team.yaml', diagnostics: [
      diagnostic(fill(agentMessages.permissionPartial, { list: 'allow', pattern: 'read_*', reason, rules: 'Read' })),
      diagnostic("At least one agent must be configured (add an entry under 'agents')."),
    ] }] };
    const german = localizedDiagnostics(english, 'de');
    expect(german.files[0]!.diagnostics.map(entry => entry.message)).toEqual([
      'Das allow-Muster read_* trifft create_directory, think, die keine Claude-Berechtigungsregel gleicher Reichweite haben; nur Read wird ausgegeben.',
      "At least one agent must be configured (add an entry under 'agents').",
    ]);
    expect(german.files[0]!.diagnostics[0]).toMatchObject({ severity: 'warning', code: 'toolset-approximated', pointer: '/agents/root' });
    expect(localizedDiagnostics(english, 'en')).toBe(english);
  });

  it('render every diagnostic of the golden generations in German', async () => {
    for (const example of ['dev-team', 'mcp-definitions', 'agent_switching_commands']) {
      const golden = JSON.parse(await readFile(join(import.meta.dirname, 'golden', example, 'result.json'), 'utf8')) as { diagnostics: Array<{ message: string }> };
      const german = localizedDiagnostics(golden, 'de');
      expect(golden.diagnostics.length, example).toBeGreaterThan(0);
      german.diagnostics.forEach((entry, index) => expect(entry.message, golden.diagnostics[index]!.message).not.toBe(golden.diagnostics[index]!.message));
    }
  });
});
