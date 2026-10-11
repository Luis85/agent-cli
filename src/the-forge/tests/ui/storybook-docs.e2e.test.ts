import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const dashboard = '---\nschemaVersion: 1\nid: dashboard\nroot:\n  tag: main\n  text: Dashboard\n---\n# The sample dashboard\n';

/** The `node bin/forge.js …` lines of the first `sh` block of a reference page, as CLI arguments. */
async function documentedCommands(page: string): Promise<string[][]> {
  const block = /```sh\n([\s\S]*?)```/.exec(await readFile(join('docs/reference', page), 'utf8'))![1]!;
  return block.trim().split('\n').map(line => {
    expect(line, page).toMatch(/^node bin\/forge\.js [^'"]+$/);
    return line.split(' ').slice(2);
  });
}

describe('the Storybook reference example', () => {
  it('runs the documented make ui and make stories pair in order', async () => {
    expect((await fixture.cli(['components', 'init'])).status).toBe(0);
    await writeFile(join(fixture.project, 'components/dashboard.md'), dashboard);
    const commands = await documentedCommands('storybook.md');
    expect(commands.map(args => args.slice(0, 2).join(' '))).toEqual(['make ui', 'make stories']);
    for (const args of commands) {
      const result = await fixture.cli(args);
      expect(result.body.error, args.join(' ')).toBeUndefined();
      expect(result.status).toBe(0);
    }
  });
});
