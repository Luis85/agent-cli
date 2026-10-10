import { project } from './project.mjs';
import { documents } from './vault-documents.mjs';
import { maintainVault } from './vault-maintenance.mjs';

export const vaultPaths = {
  hub: 'docs/Trailhead.md',
  canvas: 'docs/maps/Trailhead map.canvas',
  bases: { documents: 'docs/bases/Documents.base', requirements: 'docs/bases/Requirements.base', library: 'docs/bases/Library.base' },
};

const requirementIds = ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004', 'REQ-005'];

const bases = {
  [vaultPaths.bases.documents]: `filters:
  and:
    - file.ext == "md"
    - file.inFolder("docs")
    - stage > 0
formulas:
  outgoing: file.links.length
views:
  - type: table
    name: By stage
    order:
      - file.name
      - stage
      - type
      - status
      - formula.outgoing
    sort:
      - property: stage
        direction: ASC
  - type: table
    name: Needs review
    filters:
      and:
        - status != "approved"
        - status != "accepted"
    order:
      - file.name
      - status
      - owner
    sort:
      - property: stage
        direction: ASC
  - type: table
    name: Linked to PRD
    filters: file.hasLink(link("docs/product/Trailhead PRD.md"))
    order:
      - file.name
      - type
`,
  [vaultPaths.bases.requirements]: `filters:
  and:
    - file.ext == "md"
    - file.inFolder("docs")
    - file.hasProperty("requirements")
formulas:
  coverage: requirements.length
views:
${requirementIds.map(id => `  - type: table
    name: ${id}
    filters: requirements.contains("${id}")
    order:
      - file.name
      - type
      - status
      - formula.coverage
    sort:
      - property: stage
        direction: ASC
`).join('')}`,
  [vaultPaths.bases.library]: `filters:
  and:
    - file.ext == "md"
    - file.inFolder("library")
views:
  - type: table
    name: Trailhead definitions
    filters: file.hasLink(link("docs/design/Trip planner design.md"))
    order:
      - file.name
      - file.folder
  - type: cards
    name: Data sources
    filters: file.inFolder("library/data-sources")
    order:
      - file.name
      - kind
`,
};

/** @param {{ title: string, out: string }} document */
const notePath = document => `${document.out}/${document.title}.md`;

/**
 * Workflow documents rendered from templates, connected through guarded
 * property and body edits, plus a hub note, a Canvas map and Bases views,
 * then a link-preserving rename and a delete to the trash.
 * @param {import('./cli.mjs').ForgeCli} cli
 * @returns {Promise<{ queries: { base: string, view: string, files: string[], total: number }[] }>}
 */
export async function buildVault(cli) {
  cli.begin('Workflow documents');
  cli.run(['templates', 'install', 'workflow']);
  cli.run(['templates', 'inspect', 'workflow/prd.md']);
  const values = JSON.stringify({ owner: project.owner });
  for (const document of documents) {
    cli.run(['make', 'document', document.title, '--template', document.template, '--values', values, '--out', document.out, '--date', project.date]);
  }

  cli.begin('Knowledge graph links');
  for (const document of documents) {
    const path = notePath(document);
    cli.guarded(path, ['properties', path, '--set', JSON.stringify(document.properties)]);
    for (const { find, replace } of document.replacements) cli.guarded(path, ['edit', path, '--find', find, '--replace', replace]);
    cli.guarded(path, ['edit', path, '--append', '--content', `\n## Knowledge graph\n\n${document.links}\n`]);
  }
  cli.create(vaultPaths.hub, hubNote());

  cli.begin('Canvas map');
  cli.run(['create', vaultPaths.canvas]);
  // Replace whole arrays once, then append single elements with the "-" pointer.
  const nodes = canvasNodes();
  const edges = canvasEdges();
  const patch = (/** @type {string} */ pointer, /** @type {unknown} */ value) => cli.guarded(vaultPaths.canvas, ['patch', vaultPaths.canvas, '--pointer', pointer, '--value', JSON.stringify(value)]);
  patch('/nodes', nodes.slice(0, -1));
  patch('/nodes/-', nodes.at(-1));
  patch('/edges', edges.slice(0, -1));
  patch('/edges/-', edges.at(-1));
  cli.run(['validate', vaultPaths.canvas]);

  cli.begin('Bases');
  for (const [path, content] of Object.entries(bases)) {
    cli.create(path, content);
    cli.run(['validate', path]);
  }
  maintainVault(cli);

  cli.begin('Bases queries');
  cli.run(['bases', 'list']);
  /** @type {{ base: string, view: string }[]} */
  const selected = [];
  for (const path of Object.values(vaultPaths.bases)) {
    const views = cli.run(['bases', 'inspect', path]).data?.views;
    if (!Array.isArray(views)) throw new Error(`bases inspect ${path} returned no views`);
    for (const view of views) selected.push({ base: path, view: String(view.name) });
  }
  // Queries are read-only, so they run concurrently.
  const results = await cli.runConcurrently(selected.map(({ base, view }) => ['bases', 'query', base, '--view', view]));
  return { queries: selected.map((query, index) => ({ ...query, files: results[index].data.files, total: results[index].data.total })) };
}

function hubNote() {
  const links = documents.map(document => `- [[${document.title}]]`).join('\n');
  return `---
type: hub
tags: [trailhead]
prd: "[[Trailhead PRD]]"
---
# Trailhead

Trailhead is a fictional trip-planning web app for small hiking groups. This vault is its knowledge graph: every note, definition and generated file below was produced by The Forge CLI and is regenerated by the repository's showcase script.

## Product and delivery

${links}

## Design system and data

- Components: [[trip-planner]] composes [[trip-card]] with starter components such as [[page]] and [[card]].
- Interactions: [[toggle-favorite]], [[capture-destination]], [[save-trip-draft]] and [[toggle-expanded]].
- Data sources: [[trips-api]] (REST) and [[trail-guides]] (local JSON).

## Maps and views

- Architecture map: [[Trailhead map.canvas]]
- Documents by stage:

![[Documents.base#By stage]]

- Requirement traceability: [[Requirements.base]]
- Library definitions: [[Library.base]]
- How it was built: [[Build log]]
`;
}

const fileNode = (/** @type {string} */ id, /** @type {string} */ file, /** @type {number} */ x, /** @type {number} */ y) => ({ id, type: 'file', file, x, y, width: 260, height: 120 });

function canvasNodes() {
  return [
    { id: 'group-product', type: 'group', label: 'Product', x: -40, y: -60, width: 1000, height: 260 },
    fileNode('prd', 'docs/product/Trailhead PRD.md', 0, 0),
    fileNode('uc-001', 'docs/use-cases/UC-001 Plan a trip.md', 340, -20),
    fileNode('uc-002', 'docs/use-cases/UC-002 Share an itinerary.md', 340, 80),
    fileNode('uc-003', 'docs/use-cases/UC-003 Browse trail guides.md', 660, 30),
    { id: 'group-design', type: 'group', label: 'Design system', x: -40, y: 260, width: 1000, height: 220 },
    fileNode('design', 'docs/design/Trip planner design.md', 0, 300),
    fileNode('trip-planner', 'library/components/trip-planner.md', 340, 300),
    fileNode('trip-card', 'library/components/trip-card.md', 660, 300),
    { id: 'group-data', type: 'group', label: 'Data', x: 1000, y: 260, width: 340, height: 360 },
    fileNode('trips-api', 'library/data-sources/trips-api.md', 1040, 300),
    fileNode('trail-guides', 'library/data-sources/trail-guides.md', 1040, 460),
    { id: 'group-delivery', type: 'group', label: 'Delivery', x: -40, y: 540, width: 1000, height: 220 },
    fileNode('build-spec', 'docs/delivery/Trip planner build spec.md', 0, 580),
    fileNode('implementation', 'docs/delivery/Trip planner implementation plan.md', 340, 580),
    fileNode('test-plan', 'docs/delivery/Trip planner test plan.md', 660, 580),
    fileNode('release', 'docs/delivery/Trailhead 1.0 release plan.md', 1040, 660),
    { id: 'code', type: 'text', text: '## Code\n\n- `src/domain` and `src/application`: generated model and use cases\n- `src/infrastructure/data-sources`: generated adapters\n- `ui/<target>`: generated UI and stories for seven targets', x: 1380, y: 300, width: 340, height: 220 },
  ];
}

const edge = (/** @type {string} */ fromNode, /** @type {string} */ toNode, /** @type {string} */ label) => ({ id: `${fromNode}--${toNode}`, fromNode, fromSide: 'right', toNode, toSide: 'left', label });

function canvasEdges() {
  return [
    edge('prd', 'uc-001', 'REQ-001, 003, 005'),
    edge('prd', 'uc-002', 'REQ-004'),
    edge('uc-002', 'uc-003', 'REQ-002'),
    { ...edge('uc-001', 'design', 'designed by'), fromSide: 'bottom', toSide: 'top' },
    edge('design', 'trip-planner', 'composes'),
    edge('trip-planner', 'trip-card', 'contains'),
    edge('trip-card', 'trips-api', 'reads'),
    { ...edge('design', 'build-spec', 'specified by'), fromSide: 'bottom', toSide: 'top' },
    edge('build-spec', 'implementation', 'tasks'),
    edge('implementation', 'test-plan', 'verified by'),
    edge('test-plan', 'release', 'gates'),
    edge('trips-api', 'code', 'generates'),
  ];
}
