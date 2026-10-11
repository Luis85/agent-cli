---
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
