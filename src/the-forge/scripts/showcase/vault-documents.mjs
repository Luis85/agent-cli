import { project } from './project.mjs';

const owner = project.owner;
const prd = '[[Trailhead PRD]]';
const design = '[[Trip planner design]]';
const buildSpec = '[[Trip planner build spec]]';
const implementation = '[[Trip planner implementation plan]]';
const testPlan = '[[Trip planner test plan]]';
const release = '[[Trailhead 1.0 release plan]]';
const useCases = ['[[UC-001 Plan a trip]]', '[[UC-002 Share an itinerary]]', '[[UC-003 Browse trail guides]]'];

/**
 * @typedef {{ find: string, replace: string }} Replacement
 * @typedef {{ title: string, template: string, out: string, properties: Record<string, unknown>, replacements: Replacement[], links: string }} WorkflowDocument
 */

/** @param {string} id @param {string} title @param {string[]} requirements @param {Replacement[]} replacements @param {string} links @returns {WorkflowDocument} */
function useCase(id, title, requirements, replacements, links) {
  return {
    title: `${id} ${title}`,
    template: 'workflow/use-case.md',
    out: 'docs/use-cases',
    properties: { stage: 2, status: 'accepted', tags: ['trailhead', 'use-case'], requirements, prd, design },
    replacements: [{ find: 'Use case ID: UC-001. Status: draft.', replace: `Use case ID: ${id}. Status: accepted.` }, ...replacements],
    links,
  };
}

/** Workflow-template documents, then the guarded edits that connect them. @type {WorkflowDocument[]} */
export const documents = [
  {
    title: 'Trailhead PRD',
    template: 'workflow/prd.md',
    out: 'docs/product',
    properties: { stage: 1, status: 'approved', tags: ['trailhead', 'product'], requirements: ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004', 'REQ-005'], use_cases: useCases, design },
    replacements: [
      { find: 'Status: draft; this document records intent', replace: 'Status: approved; this document records intent' },
      { find: `| REQ-001 | TBD | Given / When / Then: TBD | TBD | ${owner} |`, replace: [
        `| REQ-001 | Plan a trip with a destination and number of nights | Given a hiker, When they save "Lake Tahoe" for 2 nights, Then the trip appears under Upcoming trips | Must | ${owner} |`,
        `| REQ-002 | Browse trail guides without a network connection | Given no network, When the hiker opens trail guides, Then the bundled catalogue lists every guide | Must | ${owner} |`,
        `| REQ-003 | Mark favourite trips | Given a trip card, When the hiker presses Favourite, Then the button is pressed and trip:favorite-changed is emitted | Should | ${owner} |`,
        `| REQ-004 | Share a read-only itinerary | Given a planned trip, When the hiker shares it, Then a read-only itinerary link exists only for known trips | Should | ${owner} |`,
        `| REQ-005 | Accessible planning form | Given keyboard-only use, When the hiker completes the form, Then every field has a visible label and the summary is announced politely | Must | ${owner} |`,
      ].join('\n') },
      { find: `| Q-001 | TBD | TBD | ${owner} | open |`, replace: `| Q-001 | Do hikers need shared editing, or is a read-only itinerary enough for 1.0? | Interviews with three hiking groups | ${owner} | open |` },
    ],
    links: `Trailhead helps small hiking groups plan multi-day trips. Use cases: ${useCases.join(', ')}. Design: ${design}. Delivery: ${buildSpec}, ${implementation}, ${testPlan} and ${release}. Start from the [[Trailhead]] hub.`,
  },
  useCase('UC-001', 'Plan a trip', ['REQ-001', 'REQ-003', 'REQ-005'], [
    { find: '| 1 | TBD | TBD | REQ-001 |', replace: [
      '| 1 | Hiker types a destination | The summary announces "Planning: Lake Tahoe" ([[capture-destination]]) | REQ-001, REQ-005 |',
      '| 2 | Hiker saves the draft | The form is stored as trailhead-trip-draft ([[save-trip-draft]]) | REQ-001 |',
      '| 3 | Hiker marks a trip as favourite | The [[trip-card]] button is pressed and the change is emitted ([[toggle-favorite]]) | REQ-003 |',
    ].join('\n') },
    { find: '| UC-001-A | TBD | TBD | TBD | REQ-001 |', replace: '| UC-001-A | the planner is open | the hiker saves "Lake Tahoe" for 2 nights | the trip is stored through [[trips-api]] | REQ-001 |' },
  ], `Implements ${prd} requirements REQ-001, REQ-003 and REQ-005 on the [[trip-planner]] page. Designed in ${design}; verified by ${testPlan}.`),
  useCase('UC-002', 'Share an itinerary', ['REQ-004'], [
    { find: '| 1 | TBD | TBD | REQ-001 |', replace: '| 1 | Hiker shares a planned trip | ShareItinerary confirms the itinerary exists before a link is offered | REQ-004 |' },
    { find: '| UC-001-A | TBD | TBD | TBD | REQ-001 |', replace: '| UC-002-A | an unknown itinerary | the hiker shares it | no link is offered | REQ-004 |' },
  ], `Implements ${prd} requirement REQ-004 using [[trips-api]]. Specified in ${buildSpec}; verified by ${testPlan}.`),
  useCase('UC-003', 'Browse trail guides', ['REQ-002'], [
    { find: '| 1 | TBD | TBD | REQ-001 |', replace: '| 1 | Hiker opens trail guides offline | The bundled [[trail-guides]] catalogue is listed | REQ-002 |' },
    { find: '| UC-001-A | TBD | TBD | TBD | REQ-001 |', replace: '| UC-003-A | no network | the hiker opens trail guides | four guides are listed from the local JSON file | REQ-002 |' },
  ], `Implements ${prd} requirement REQ-002. Specified in ${buildSpec}; verified by ${testPlan}.`),
  {
    title: 'Trip planner design',
    template: 'workflow/design.md',
    out: 'docs/design',
    properties: { stage: 3, status: 'in-review', tags: ['trailhead', 'design'], requirements: ['REQ-001', 'REQ-003', 'REQ-005'], prd, use_cases: useCases, components: ['[[trip-planner]]', '[[trip-card]]'], interactions: ['[[toggle-favorite]]', '[[capture-destination]]', '[[save-trip-draft]]'], data_sources: ['[[trips-api]]', '[[trail-guides]]'] },
    replacements: [
      { find: 'Design decision ID: DSN-001. Status: draft.', replace: 'Design decision ID: DSN-001. Status: in review.' },
      { find: '| TBD | TBD | TBD | unverified |', replace: [
        '| One planner page composed from [[trip-card]] and starter components | Everything on one screen | Low: generated for all seven targets | Storybook review pending |',
        '| Separate wizard steps | Slower for returning hikers | Higher: routing per framework | unverified |',
      ].join('\n') },
      { find: 'Decision: pending.', replace: 'Decision: one planner page, pending usability review.' },
    ],
    links: `Satisfies ${prd} through ${useCases.join(', ')}. Components: [[trip-planner]] composes [[trip-card]] with the starter [[page]] and [[card]] definitions. Interactions: [[toggle-favorite]], [[capture-destination]], [[save-trip-draft]] and the starter [[toggle-expanded]]. Data: [[trips-api]] and [[trail-guides]]. Stories exist for every target under \`ui/<target>/stories\`. Next: ${buildSpec}.`,
  },
  {
    title: 'Trip planner build spec',
    template: 'workflow/build-spec.md',
    out: 'docs/delivery',
    properties: { stage: 4, status: 'draft', tags: ['trailhead', 'delivery'], requirements: ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004', 'REQ-005'], prd, design, use_cases: useCases },
    replacements: [
      { find: '| TBD | TBD | TBD | workspace or project | REQ-001 |', replace: [
        '| UI components | `library/components/trip-planner.md` | `ui/<target>/components` | project | REQ-001 |',
        '| Storybook stories | `library/components/trip-card.md` | `ui/<target>/stories` | project | REQ-003 |',
        '| REST adapter | `library/data-sources/trips-api.md` | `src/infrastructure/data-sources/trips-api.ts` | project | REQ-004 |',
        '| JSON adapter and fixture | `library/data-sources/trail-guides.md` | `test-data/trail-guides.fixtures.json` | project | REQ-002 |',
        '| Trip request form | `make form TripRequest` | `src/presentation/forms/trip-request.form.ts` | project | REQ-005 |',
      ].join('\n') },
    ],
    links: `Specifies ${prd} as designed in ${design}. Domain: [Trip](../../src/domain/trip.ts), [Itinerary](../../src/domain/trips/itinerary.ts), [TripWindow](../../src/domain/trips/trip-window.ts) and [TripPlanned](../../src/domain/trips/trip-planned.ts). Application: [PlanTrip](../../src/application/plan-trip.ts) and [ShareItinerary](../../src/application/trips/share-itinerary.ts). Adapters from [[trips-api]] and [[trail-guides]]. Next: ${implementation}.`,
  },
  {
    title: 'Trip planner implementation plan',
    template: 'workflow/implementation-plan.md',
    out: 'docs/delivery',
    properties: { stage: 5, status: 'in-progress', tags: ['trailhead', 'delivery'], requirements: ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004', 'REQ-005'], prd, build_spec: buildSpec, test_plan: testPlan },
    replacements: [
      { find: 'Status: draft; all work below is planned', replace: 'Status: in progress; all work below is planned' },
      { find: `| IMP-001 | TBD | none or task ID | TBD | ${owner} | planned |`, replace: [
        `| IMP-001 | Trip, Itinerary, TripWindow and TripPlanned domain model | none | REQ-001 / UC-001 | ${owner} | generated |`,
        `| IMP-002 | PlanTrip and ShareItinerary use cases with injected repositories | IMP-001 | REQ-001, REQ-004 / UC-001, UC-002 | ${owner} | generated |`,
        `| IMP-003 | Typed adapters and fixtures from [[trips-api]] and [[trail-guides]] | none | REQ-002, REQ-004 / UC-002, UC-003 | ${owner} | generated |`,
        `| IMP-004 | [[trip-planner]] UI and stories for all seven targets | IMP-003 | REQ-001, REQ-003, REQ-005 / DSN-001 | ${owner} | generated |`,
      ].join('\n') },
    ],
    links: `Delivers ${buildSpec} for ${prd}. Every task is generated by the Forge CLI and regenerated by the repository's showcase script; business behavior beyond the scaffolds is planned work. Verification: ${testPlan}.`,
  },
  {
    title: 'Trip planner test plan',
    template: 'workflow/test-plan.md',
    out: 'docs/delivery',
    properties: { stage: 6, status: 'draft', tags: ['trailhead', 'quality'], requirements: ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004', 'REQ-005'], prd, implementation, use_cases: useCases },
    replacements: [
      { find: `| TEST-001 | TBD | TBD | unit / integration / end-to-end | ${owner} |`, replace: [
        `| TEST-001 | REQ-001 / UC-001 / IMP-001 | Trip model invariants (\`tests/trips/trip-model.domain.unit.test.ts\`) | unit | ${owner} |`,
        `| TEST-002 | REQ-004 / UC-002 / IMP-002 | Unknown itineraries are not shared (\`tests/trips/share-itinerary.application.unit.test.ts\`) | unit | ${owner} |`,
        `| TEST-003 | REQ-004 / UC-002 / IMP-003 | REST adapter against fixtures (\`tests/data-sources/trips-api.integration.test.ts\`) | integration | ${owner} |`,
        `| TEST-004 | REQ-002 / UC-003 / IMP-003 | Offline catalogue (\`tests/data-sources/trail-guides.integration.test.ts\`) | integration | ${owner} |`,
        `| TEST-005 | all / DSN-001 | Every wikilink and canvas node resolves (\`tests/vault/knowledge-graph.integration.test.ts\`) | integration | ${owner} |`,
      ].join('\n') },
      { find: '| TBD | TBD | TBD | TBD | TBD |', replace: '| Project gate | `src/forge-showcase` | `npm ci && npm run check` | exit 0 | `.quality-reports/` |' },
    ],
    links: `Verifies ${prd} and ${useCases.join(', ')} as delivered by ${implementation}. Execution evidence is recorded by the project's own CI workflow, not by this plan. Feeds ${release}.`,
  },
  {
    title: 'Trailhead 1.0 release plan',
    template: 'workflow/release-plan.md',
    out: 'docs/delivery',
    properties: { stage: 7, status: 'draft', tags: ['trailhead', 'release'], requirements: ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004', 'REQ-005'], prd, test_plan: testPlan, implementation },
    replacements: [
      { find: '| REL-001 | TBD | TBD | TBD | TBD |', replace: '| REL-001 | Build the library and form preview | `src/forge-showcase` | `npm run build` | `dist/` and `demo-dist/` exist |' },
    ],
    links: `Releases ${prd} once ${testPlan} passes. Implementation: ${implementation}. Deployment is out of scope for the showcase.`,
  },
];
