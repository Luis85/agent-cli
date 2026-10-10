import { describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { generateClaude, type ClaudeGenerationOptions } from '../../src/plugins/agents/domain/claude-generation.ts';
import { semanticDiagnostics } from '../../src/plugins/agents/domain/semantics.ts';
import { yamlDefinitions } from '../../src/plugins/agents/infrastructure/yaml-definitions.ts';
import { markdownFrontmatter } from '../../src/plugins/agents/infrastructure/frontmatter.ts';
import { ajvDefinitionSchema } from '../../src/plugins/agents/infrastructure/schema.ts';
import { validateClaudeAgent } from '../../src/domain/claude/agents.ts';
import { example } from './agents-workspace.ts';

/**
 * Golden generation: the committed files under golden/<example>/ are the exact Claude outputs and diagnostics for
 * three docker-agent examples. Set UPDATE_GOLDEN=1 to rewrite them after an intended mapping change, then review.
 */
const golden = join(import.meta.dirname, 'golden');
const update = process.env.UPDATE_GOLDEN === '1';
const options: ClaudeGenerationOptions = { mcp: 'inline', settings: true, commands: true, modelStyle: 'id' };
const sha256 = '0'.repeat(64);

async function expectGolden(path: string, content: string) {
  const file = join(golden, path);
  if (update) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, content); }
  expect(content, path).toBe(await readFile(file, 'utf8'));
}

describe.each(['dev-team.yaml', 'mcp-definitions.yaml', 'agent_switching_commands.yaml'])('generation from %s', name => {
  it('produces stable files and a stable diagnostic set that pass the Claude agent validation', async () => {
    const parsed = yamlDefinitions.parse(await example(name));
    const config = parsed.value as Record<string, unknown>;
    expect([...ajvDefinitionSchema.validate(config), ...semanticDiagnostics(config)]).toEqual([]);
    const output = generateClaude([{ path: `agents/${name}`, sha256, config, instructions: {} }], options);
    const directory = name.replace(/\.yaml$/, '');
    for (const file of [...output.agents, ...output.skills]) {
      const text = markdownFrontmatter.render(file.metadata, file.body);
      const reparsed = markdownFrontmatter.parse(text);
      expect(() => validateClaudeAgent(reparsed.metadata, reparsed.body)).not.toThrow();
      await expectGolden(`${directory}/${file.path}`, text);
    }
    const settings = output.settings ? { settings: output.settings } : {};
    await expectGolden(`${directory}/result.json`, `${JSON.stringify({ agents: output.agents.map(agent => agent.path), skills: output.skills.map(skill => skill.path), mcpServers: output.mcpServers, ...settings, diagnostics: output.diagnostics }, null, 2)}\n`);
  });
});
