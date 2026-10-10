---
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
