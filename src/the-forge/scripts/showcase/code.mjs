import { project } from './project.mjs';
import { projectTests } from './project-tests.mjs';

export const workflowPath = 'src/infrastructure/workflows/check/check.yml';

const checkWorkflow = `# Quality gate for the forge-showcase project, authored inside the project.
# The file stays independent of its location: \`node bin/app.js workflows sync\` in the
# containing workspace generates .github/workflows/forge-showcase--check.yml from it,
# runs its steps in the project directory, limits push and pull_request triggers to
# the project's files and sets env.FORGE_PROJECT_PATH for action inputs such as the cache path.
name: forge-showcase check

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  check:
    name: Install, check and test (Node \${{ matrix.node }})
    runs-on: ubuntu-latest
    timeout-minutes: 15
    strategy:
      fail-fast: false
      matrix:
        node: ['22.12.0', 24]
    steps:
      # Actions are pinned to full commit SHAs; the comment names the release.
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
        with:
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: \${{ matrix.node }}
          cache: npm
          cache-dependency-path: \${{ env.FORGE_PROJECT_PATH }}/package-lock.json
      - name: Install locked dependencies
        run: npm ci
      - name: Structure, lint, analysis, types, builds and tests
        run: npm run check
`;

const reviewerPrompt = `You review the Trailhead showcase for traceability.

1. Start at docs/Trailhead.md and the PRD. Every REQ ID must reach a use case, the design, the build spec, an implementation task and a test-plan entry.
2. Follow wikilinks and frontmatter links; report any note, component, interaction or data source that is unreachable from the PRD.
3. Compare library definitions under library/ with generated code under ui/ and src/infrastructure/data-sources/; regenerate with the Forge CLI instead of editing generated files by hand.
4. Report findings as a list of file paths with the missing or broken link. Do not change files.
`;

/**
 * Project scaffold, domain/application components, forms, authored tests,
 * project CI workflow, a native Claude agent and agent skills.
 * @param {import('./cli.mjs').ForgeCli} cli
 */
export function buildProject(cli) {
  cli.begin('Project');
  cli.run(['project', 'list']);
  cli.run(['project', 'create', project.id, '--dry-run']);
  cli.run(['project', 'create', project.id]);
  cli.run(['project', 'open', project.id]);
  const current = cli.run(['project', 'current']);
  if (current.data?.project?.name !== project.id) throw new Error(`Expected ${project.id} to be selected`);
}

/** @param {import('./cli.mjs').ForgeCli} cli */
export function buildCode(cli) {
  cli.begin('Domain and application code');
  cli.run(['project', 'component', project.id, 'Trip', '--kind', 'domain']);
  cli.run(['project', 'component', project.id, 'PlanTrip', '--kind', 'application']);
  cli.run(['make', 'entity', 'Itinerary', '--out', 'src/domain/trips', '--dry-run']);
  cli.run(['make', 'entity', 'Itinerary', '--out', 'src/domain/trips']);
  cli.run(['make', 'value-object', 'TripWindow', '--out', 'src/domain/trips']);
  cli.run(['make', 'event', 'TripPlanned', '--out', 'src/domain/trips']);
  cli.run(['make', 'use-case', 'ShareItinerary', '--out', 'src/application/trips']);

  cli.begin('Forms');
  cli.run(['make', 'form', 'TripRequest']);

  cli.begin('Project tests');
  for (const [path, content] of Object.entries(projectTests)) cli.create(path, content);
}

/** @param {import('./cli.mjs').ForgeCli} cli */
export function buildAutomation(cli) {
  cli.begin('Project CI workflow');
  cli.create(workflowPath, checkWorkflow);
  cli.run(['workflows', 'list']);

  cli.begin('Agents and skills');
  const metadata = {
    name: 'trailhead-reviewer',
    description: 'Reviews Trailhead specs, designs and generated code for traceability from REQ IDs to tests. Use before handing off a Trailhead change.',
    tools: 'Read, Grep, Glob',
  };
  cli.run(['claude', 'agents', 'create', 'trailhead-reviewer', '--metadata', JSON.stringify(metadata), '--prompt', reviewerPrompt]);
  cli.run(['claude', 'agents', 'list']);
  cli.run(['skills', 'install']);
}
