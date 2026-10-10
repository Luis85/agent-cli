// Refresh the vendored docker-agent assets from a local docker-agent checkout.
// Run from src/the-forge:
//
//   git clone https://github.com/docker/docker-agent ../docker-agent && git -C ../docker-agent checkout <commit>
//   npm run vendor:docker-agent -- ../docker-agent
//
// It copies agent-schema.json (the JSON Schema the agents plugin validates with), records the source commit,
// copies the Apache-2.0 license for the distribution's notices, and replaces the conformance fixtures with the
// checkout's examples/*.yaml and the instruction files they reference. Review the diff, then run npm run check.
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const vendor = 'src/plugins/agents/infrastructure/vendor';
const fixtures = 'tests/agents/fixtures/docker-agent';
const checkout = process.argv[2];
if (process.argv.length !== 3 || !checkout || !existsSync(join(checkout, 'agent-schema.json'))) {
  process.stderr.write('Usage: node scripts/vendor-docker-agent.mjs <docker-agent checkout>\n');
  process.exit(2);
}
const git = (/** @type {string[]} */ ...args) => execFileSync('git', ['-C', resolve(checkout), ...args], { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
if (git('status', '--porcelain', '--', 'agent-schema.json', 'examples', 'LICENSE') !== '') throw new Error('The docker-agent checkout has local changes; vendor a clean commit.');

mkdirSync(vendor, { recursive: true });
copyFileSync(join(checkout, 'agent-schema.json'), join(vendor, 'agent-schema.json'));
copyFileSync(join(checkout, 'LICENSE'), 'scripts/licenses/docker-agent-LICENSE');
const source = { repository: 'https://github.com/docker/docker-agent', commit, files: ['agent-schema.json'], license: 'Apache-2.0', configVersion: '16' };
writeFileSync(join(vendor, 'source.json'), `${JSON.stringify(source, null, 2)}\n`);

rmSync(fixtures, { recursive: true, force: true });
mkdirSync(join(fixtures, 'examples'), { recursive: true });
const examples = readdirSync(join(checkout, 'examples')).filter(name => name.endsWith('.yaml')).sort();
for (const name of examples) copyFileSync(join(checkout, 'examples', name), join(fixtures, 'examples', name));
// instruction_file examples read files relative to the configuration.
cpSync(join(checkout, 'examples', 'instructions'), join(fixtures, 'examples', 'instructions'), { recursive: true });
writeFileSync(join(fixtures, 'README.md'), [
  '# docker-agent conformance fixtures',
  '',
  `The \`examples/\` files are copied unchanged from [docker-agent](https://github.com/docker/docker-agent/tree/${commit}/examples) at commit \`${commit}\`.`,
  'They belong to the docker-agent authors and are licensed under the [Apache License 2.0](../../../../scripts/licenses/docker-agent-LICENSE).',
  'Refresh them with `node scripts/vendor-docker-agent.mjs <docker-agent checkout>`; do not edit them by hand.',
  '',
].join('\n'));
process.stdout.write(`${JSON.stringify({ ok: true, commit, examples: examples.length }, null, 2)}\n`);
