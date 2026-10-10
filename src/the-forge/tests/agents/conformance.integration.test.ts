import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { AgentDefinitions } from '../../src/plugins/agents/application/definitions.ts';
import { yamlDefinitions } from '../../src/plugins/agents/infrastructure/yaml-definitions.ts';
import { ajvDefinitionSchema, vendoredSchema } from '../../src/plugins/agents/infrastructure/schema.ts';
import schema from '../../src/plugins/agents/infrastructure/vendor/agent-schema.json';
import { dockerAgentExamples } from './agents-workspace.ts';

const fixtures = join(dockerAgentExamples, '..');

describe('docker-agent conformance', () => {
  it('pins the vendored schema and the fixtures to the same docker-agent commit', async () => {
    expect(vendoredSchema).toEqual({ repository: 'https://github.com/docker/docker-agent', commit: expect.stringMatching(/^[a-f0-9]{40}$/), configVersion: '16' });
    expect(await readFile(join(fixtures, 'README.md'), 'utf8')).toContain(`commit \`${vendoredSchema.commit}\``);
    // The version Forge reads and writes is the newest one the vendored schema accepts.
    expect(ajvDefinitionSchema.configVersion).toBe(vendoredSchema.configVersion);
    expect((schema.properties.version.enum as string[]).at(-1)).toBe(vendoredSchema.configVersion);
  });

  it('validates every examples/*.yaml of the pinned commit without errors, resolving instruction files', async () => {
    const definitions = new AgentDefinitions(await NodeFiles.at(fixtures), { codec: yamlDefinitions, schema: ajvDefinitionSchema }, 'examples');
    const paths = await definitions.paths();
    expect(paths).toHaveLength((await readdir(dockerAgentExamples)).filter(name => name.endsWith('.yaml')).length);
    expect(paths.length).toBeGreaterThan(150);
    const failures = [];
    for (const path of paths) {
      const loaded = await definitions.load(path);
      const errors = loaded.diagnostics.filter(entry => entry.severity === 'error');
      if (errors.length > 0) failures.push({ path, errors });
    }
    expect(failures).toEqual([]);
    const instructionFile = await definitions.load('examples/instruction_file.yaml');
    expect(instructionFile.instructions.writer).toMatch(/\n\n/);
  });
});
