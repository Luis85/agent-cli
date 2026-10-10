import { libraries, project } from './project.mjs';

/** Every UI target the CLI supports, in documentation order. */
export const uiTargets = ['html', 'htmx', 'vanilla', 'vue', 'svelte', 'react', 'angular'];

const interactions = {
  'toggle-favorite': `---
schemaVersion: 1
id: toggle-favorite
event: click
actions:
  - type: toggle-state
    state: favorite
  - type: emit
    event: trip:favorite-changed
    detail:
      favorite: "{{state.favorite}}"
---
# Toggle favourite

Marks a trip as a favourite and emits \`trip:favorite-changed\` so the application can persist it through the [[trips-api]] data source. Requirement REQ-003; see [[Trip planner design]].
`,
  'capture-destination': `---
schemaVersion: 1
id: capture-destination
event: input
actions:
  - type: set-state
    state: destination
    fromEvent: value
---
# Capture destination

Copies the destination field into the planner's \`destination\` state while the hiker types. Requirement REQ-001; see [[UC-001 Plan a trip]] and [[Trip planner design]].
`,
  'save-trip-draft': `---
schemaVersion: 1
id: save-trip-draft
event: submit
preventDefault: true
actions:
  - type: save-form
    key: trailhead-trip-draft
  - type: emit
    event: trip:draft-saved
---
# Save trip draft

Stores the trip request form in this browser under \`trailhead-trip-draft\` and notifies the application. Requirement REQ-001; see [[Trip planner design]].
`,
};

const components = {
  'trip-card': `---
schemaVersion: 1
id: trip-card
name: TripCard
props:
  title:
    type: string
    required: true
    default: Lakeside weekend
    description: Trip name shown as the card heading
  destination:
    type: string
    default: Lake Tahoe
    description: Primary destination
  nights:
    type: number
    default: 2
    description: Number of nights away
state:
  favorite:
    type: boolean
    default: false
root:
  component: card
  children:
    - tag: h3
      attrs:
        class: trip-card__title
      text: "{{title}}"
    - tag: p
      attrs:
        class: trip-card__meta
      text: "{{destination}} · {{nights}} nights"
    - tag: button
      attrs:
        type: button
        class: trip-card__favorite
        aria-pressed: "{{state.favorite}}"
      text: Favourite
      interactions: [toggle-favorite]
storybook:
  title: Trailhead/TripCard
  tags: [autodocs]
  argTypes:
    nights:
      control: number
  parameters:
    layout: centered
  stories:
    - name: Default
    - name: LongTrip
      args:
        title: Pacific Crest section
        destination: Sierra Nevada
        nights: 9
---
# Trip card

Summarises one planned trip from the [[trips-api]] data source and lets the hiker mark it as a favourite with [[toggle-favorite]]. Designed in [[Trip planner design]] for REQ-003.
`,
  'trip-planner': `---
schemaVersion: 1
id: trip-planner
name: TripPlanner
props:
  heading:
    type: string
    default: Plan your next trip
    description: Page heading
state:
  destination:
    type: string
    default: ""
  expanded:
    type: boolean
    default: false
root:
  component: page
  children:
    - tag: header
      attrs:
        class: trip-planner__header
      children:
        - tag: h1
          text: "{{heading}}"
        - tag: p
          attrs:
            class: trip-planner__summary
            aria-live: polite
          text: "Planning: {{state.destination}}"
    - tag: section
      attrs:
        class: trip-planner__trips
        aria-label: Upcoming trips
      children:
        - component: trip-card
          props:
            title: Lakeside weekend
            destination: Lake Tahoe
            nights: 2
        - component: trip-card
          props:
            title: Coastal traverse
            destination: Big Sur
            nights: 4
    - tag: form
      attrs:
        class: trip-planner__form
        aria-label: Request a trip
      interactions: [save-trip-draft]
      children:
        - tag: label
          attrs:
            for: trip-destination
          text: Destination
        - tag: input
          attrs:
            id: trip-destination
            name: destination
            type: text
            required: true
            value: "{{state.destination}}"
          interactions: [capture-destination]
        - tag: label
          attrs:
            for: trip-nights
          text: Nights
        - tag: input
          attrs:
            id: trip-nights
            name: nights
            type: number
            min: 1
        - tag: button
          attrs:
            type: submit
          text: Save draft
    - tag: button
      attrs:
        type: button
        class: trip-planner__tips
        aria-expanded: "{{state.expanded}}"
      text: Packing tips
      interactions: [toggle-expanded]
storybook:
  title: Trailhead/TripPlanner
  tags: [autodocs]
  parameters:
    layout: fullscreen
  stories:
    - name: Default
    - name: Weekend
      args:
        heading: Plan a weekend away
---
# Trip planner

The Trailhead planning page: upcoming [[trip-card]] entries, a trip request form saved with [[save-trip-draft]], live destination capture through [[capture-destination]] and a packing-tips toggle using the starter [[toggle-expanded]] interaction. Implements [[UC-001 Plan a trip]] as designed in [[Trip planner design]].
`,
};

/**
 * Starter libraries, Trailhead components and interactions, and generated UI
 * plus Storybook stories for every target, all inside the showcase project.
 * @param {import('./cli.mjs').ForgeCli} cli
 */
export async function buildDesignSystem(cli) {
  cli.begin('Design system');
  const libraryOptions = ['--library', libraries.components, '--interactions-library', libraries.interactions];
  cli.run(['components', 'init', ...libraryOptions]);
  cli.run(['interactions', 'init', '--library', libraries.interactions]);
  for (const [id, content] of Object.entries(interactions)) {
    const event = /^event: (\S+)$/m.exec(content)?.[1] ?? 'click';
    cli.run(['interactions', 'create', id, '--event', event, '--library', libraries.interactions]);
    cli.replace(`library/interactions/${id}.md`, content);
  }
  cli.run(['interactions', 'validate', '--library', libraries.interactions]);
  for (const [id, content] of Object.entries(components)) {
    cli.run(['components', 'create', id, '--tag', 'article', ...libraryOptions]);
    cli.replace(`library/components/${id}.md`, content);
  }
  cli.run(['components', 'validate', ...libraryOptions]);
  cli.run(['components', 'inspect', 'trip-planner', ...libraryOptions]);

  cli.begin('UI for every target');
  const generate = (/** @type {string} */ framework) => ['make', 'ui', 'trip-planner', '--framework', framework, '--project', project.id, ...libraryOptions, ...uiOptions(framework), '--stories'];
  cli.run([...generate('html'), '--dry-run']);
  for (const framework of uiTargets) cli.run(generate(framework));
  // Drift checks are read-only, so they run concurrently.
  await cli.runConcurrently(uiTargets.map(framework => [...generate(framework), '--check']));
}

/** @param {string} framework */
function uiOptions(framework) {
  return ['--out', `ui/${framework}/components`, '--stories-out', `ui/${framework}/stories`];
}
