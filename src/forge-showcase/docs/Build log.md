---
type: log
tags: [trailhead, forge]
hub: "[[Trailhead]]"
---
# Build log

Every Forge CLI invocation the showcase script made to build this project, in order. Long JSON values and Markdown inputs are abbreviated; `< input` marks content passed on standard input, and `<revision>` the SHA-256 revision read before a guarded change. The script runs these commands in a temporary workspace with `--root` and `--json`, then copies `src/forge-showcase` into the repository. See [[Trailhead]] for the product hub.

## Project

```sh
node bin/app.js project list
node bin/app.js project create forge-showcase --dry-run
node bin/app.js project create forge-showcase
node bin/app.js project open forge-showcase
node bin/app.js project current
```

## Domain and application code

```sh
node bin/app.js project component forge-showcase Trip --kind domain
node bin/app.js project component forge-showcase PlanTrip --kind application
node bin/app.js make entity Itinerary --out src/domain/trips --dry-run
node bin/app.js make entity Itinerary --out src/domain/trips
node bin/app.js make value-object TripWindow --out src/domain/trips
node bin/app.js make event TripPlanned --out src/domain/trips
node bin/app.js make use-case ShareItinerary --out src/application/trips
```

## Forms

```sh
node bin/app.js make form TripRequest
```

## Project tests

```sh
node bin/app.js create tests/trips/trip-model.domain.unit.test.ts --stdin < input
node bin/app.js create tests/trips/share-itinerary.application.unit.test.ts --stdin < input
node bin/app.js create tests/data-sources/trips-api.integration.test.ts --stdin < input
node bin/app.js create tests/data-sources/trail-guides.integration.test.ts --stdin < input
node bin/app.js create tests/vault/knowledge-graph.integration.test.ts --stdin < input
```

## Design system

```sh
node bin/app.js components init --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions
node bin/app.js interactions init --library src/forge-showcase/library/interactions
node bin/app.js interactions create toggle-favorite --event click --library src/forge-showcase/library/interactions
node bin/app.js write library/interactions/toggle-favorite.md --stdin --if-match <revision> < input
node bin/app.js interactions create capture-destination --event input --library src/forge-showcase/library/interactions
node bin/app.js write library/interactions/capture-destination.md --stdin --if-match <revision> < input
node bin/app.js interactions create save-trip-draft --event submit --library src/forge-showcase/library/interactions
node bin/app.js write library/interactions/save-trip-draft.md --stdin --if-match <revision> < input
node bin/app.js interactions validate --library src/forge-showcase/library/interactions
node bin/app.js components create trip-card --tag article --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions
node bin/app.js write library/components/trip-card.md --stdin --if-match <revision> < input
node bin/app.js components create trip-planner --tag article --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions
node bin/app.js write library/components/trip-planner.md --stdin --if-match <revision> < input
node bin/app.js components validate --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions
node bin/app.js components inspect trip-planner --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions
```

## UI for every target

```sh
node bin/app.js make ui trip-planner --framework html --project forge-showcase --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions --out ui/html/components --stories-out ui/html/stories --stories --dry-run
node bin/app.js make ui trip-planner --framework html --project forge-showcase --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions --out ui/html/components --stories-out ui/html/stories --stories
node bin/app.js make ui trip-planner --framework htmx --project forge-showcase --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions --out ui/htmx/components --stories-out ui/htmx/stories --stories
node bin/app.js make ui trip-planner --framework vanilla --project forge-showcase --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions --out ui/vanilla/components --stories-out ui/vanilla/stories --stories
node bin/app.js make ui trip-planner --framework vue --project forge-showcase --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions --out ui/vue/components --stories-out ui/vue/stories --stories
node bin/app.js make ui trip-planner --framework svelte --project forge-showcase --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions --out ui/svelte/components --stories-out ui/svelte/stories --stories
node bin/app.js make ui trip-planner --framework react --project forge-showcase --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions --out ui/react/components --stories-out ui/react/stories --stories
node bin/app.js make ui trip-planner --framework angular --project forge-showcase --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions --out ui/angular/components --stories-out ui/angular/stories --stories
node bin/app.js make ui trip-planner --framework html --project forge-showcase --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions --out ui/html/components --stories-out ui/html/stories --stories --check
node bin/app.js make ui trip-planner --framework htmx --project forge-showcase --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions --out ui/htmx/components --stories-out ui/htmx/stories --stories --check
node bin/app.js make ui trip-planner --framework vanilla --project forge-showcase --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions --out ui/vanilla/components --stories-out ui/vanilla/stories --stories --check
node bin/app.js make ui trip-planner --framework vue --project forge-showcase --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions --out ui/vue/components --stories-out ui/vue/stories --stories --check
node bin/app.js make ui trip-planner --framework svelte --project forge-showcase --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions --out ui/svelte/components --stories-out ui/svelte/stories --stories --check
node bin/app.js make ui trip-planner --framework react --project forge-showcase --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions --out ui/react/components --stories-out ui/react/stories --stories --check
node bin/app.js make ui trip-planner --framework angular --project forge-showcase --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions --out ui/angular/components --stories-out ui/angular/stories --stories --check
```

## Data sources

```sh
node bin/app.js data-sources create trips-api --kind rest --library src/forge-showcase/library/data-sources
node bin/app.js write library/data-sources/trips-api.md --stdin --if-match <revision> < input
node bin/app.js data-sources create trail-guides --kind json --library src/forge-showcase/library/data-sources
node bin/app.js write library/data-sources/trail-guides.md --stdin --if-match <revision> < input
node bin/app.js data-sources validate --library src/forge-showcase/library/data-sources
node bin/app.js data-sources list --library src/forge-showcase/library/data-sources
node bin/app.js make data-source trips-api --library src/forge-showcase/library/data-sources --out src/infrastructure/data-sources --test-data-out test-data
node bin/app.js make data-source trips-api --library src/forge-showcase/library/data-sources --out src/infrastructure/data-sources --test-data-out test-data --check
node bin/app.js make data-source trail-guides --library src/forge-showcase/library/data-sources --out src/infrastructure/data-sources --test-data-out test-data
node bin/app.js make data-source trail-guides --library src/forge-showcase/library/data-sources --out src/infrastructure/data-sources --test-data-out test-data --check
```

## Workflow documents

```sh
node bin/app.js templates install workflow
node bin/app.js templates inspect workflow/prd.md
node bin/app.js make document 'Trailhead PRD' --template workflow/prd.md --values '{"owner":"Trailhead product team"}' --out docs/product --date 2026-10-10T09:00:00Z
node bin/app.js make document 'UC-001 Plan a trip' --template workflow/use-case.md --values '{"owner":"Trailhead product team"}' --out docs/use-cases --date 2026-10-10T09:00:00Z
node bin/app.js make document 'UC-002 Share an itinerary' --template workflow/use-case.md --values '{"owner":"Trailhead product team"}' --out docs/use-cases --date 2026-10-10T09:00:00Z
node bin/app.js make document 'UC-003 Browse trail guides' --template workflow/use-case.md --values '{"owner":"Trailhead product team"}' --out docs/use-cases --date 2026-10-10T09:00:00Z
node bin/app.js make document 'Trip planner design' --template workflow/design.md --values '{"owner":"Trailhead product team"}' --out docs/design --date 2026-10-10T09:00:00Z
node bin/app.js make document 'Trip planner build spec' --template workflow/build-spec.md --values '{"owner":"Trailhead product team"}' --out docs/delivery --date 2026-10-10T09:00:00Z
node bin/app.js make document 'Trip planner implementation plan' --template workflow/implementation-plan.md --values '{"owner":"Trailhead product team"}' --out docs/delivery --date 2026-10-10T09:00:00Z
node bin/app.js make document 'Trip planner test plan' --template workflow/test-plan.md --values '{"owner":"Trailhead product team"}' --out docs/delivery --date 2026-10-10T09:00:00Z
node bin/app.js make document 'Trailhead 1.0 release plan' --template workflow/release-plan.md --values '{"owner":"Trailhead product team"}' --out docs/delivery --date 2026-10-10T09:00:00Z
```

## Knowledge graph links

```sh
node bin/app.js properties 'docs/product/Trailhead PRD.md' --set '{"stage":1,"status":"approved","tags":["trailhe…' --if-match <revision>
node bin/app.js edit 'docs/product/Trailhead PRD.md' --find 'Status: draft; this document records intent' --replace 'Status: approved; this document records intent' --if-match <revision>
node bin/app.js edit 'docs/product/Trailhead PRD.md' --find '| REQ-001 | TBD | Given / When / Then: TBD | TB…' --replace '| REQ-001 | Plan a trip with a destination and …' --if-match <revision>
node bin/app.js edit 'docs/product/Trailhead PRD.md' --find '| Q-001 | TBD | TBD | Trailhead product team | …' --replace '| Q-001 | Do hikers need shared editing, or is …' --if-match <revision>
node bin/app.js edit 'docs/product/Trailhead PRD.md' --append --content ' ## Knowledge graph Trailhead helps small hikin…' --if-match <revision>
node bin/app.js properties 'docs/use-cases/UC-001 Plan a trip.md' --set '{"stage":2,"status":"accepted","tags":["trailhe…' --if-match <revision>
node bin/app.js edit 'docs/use-cases/UC-001 Plan a trip.md' --find 'Use case ID: UC-001. Status: draft.' --replace 'Use case ID: UC-001. Status: accepted.' --if-match <revision>
node bin/app.js edit 'docs/use-cases/UC-001 Plan a trip.md' --find '| 1 | TBD | TBD | REQ-001 |' --replace '| 1 | Hiker types a destination | The summary a…' --if-match <revision>
node bin/app.js edit 'docs/use-cases/UC-001 Plan a trip.md' --find '| UC-001-A | TBD | TBD | TBD | REQ-001 |' --replace '| UC-001-A | the planner is open | the hiker sa…' --if-match <revision>
node bin/app.js edit 'docs/use-cases/UC-001 Plan a trip.md' --append --content ' ## Knowledge graph Implements [[Trailhead PRD]…' --if-match <revision>
node bin/app.js properties 'docs/use-cases/UC-002 Share an itinerary.md' --set '{"stage":2,"status":"accepted","tags":["trailhe…' --if-match <revision>
node bin/app.js edit 'docs/use-cases/UC-002 Share an itinerary.md' --find 'Use case ID: UC-001. Status: draft.' --replace 'Use case ID: UC-002. Status: accepted.' --if-match <revision>
node bin/app.js edit 'docs/use-cases/UC-002 Share an itinerary.md' --find '| 1 | TBD | TBD | REQ-001 |' --replace '| 1 | Hiker shares a planned trip | ShareItiner…' --if-match <revision>
node bin/app.js edit 'docs/use-cases/UC-002 Share an itinerary.md' --find '| UC-001-A | TBD | TBD | TBD | REQ-001 |' --replace '| UC-002-A | an unknown itinerary | the hiker s…' --if-match <revision>
node bin/app.js edit 'docs/use-cases/UC-002 Share an itinerary.md' --append --content ' ## Knowledge graph Implements [[Trailhead PRD]…' --if-match <revision>
node bin/app.js properties 'docs/use-cases/UC-003 Browse trail guides.md' --set '{"stage":2,"status":"accepted","tags":["trailhe…' --if-match <revision>
node bin/app.js edit 'docs/use-cases/UC-003 Browse trail guides.md' --find 'Use case ID: UC-001. Status: draft.' --replace 'Use case ID: UC-003. Status: accepted.' --if-match <revision>
node bin/app.js edit 'docs/use-cases/UC-003 Browse trail guides.md' --find '| 1 | TBD | TBD | REQ-001 |' --replace '| 1 | Hiker opens trail guides offline | The bu…' --if-match <revision>
node bin/app.js edit 'docs/use-cases/UC-003 Browse trail guides.md' --find '| UC-001-A | TBD | TBD | TBD | REQ-001 |' --replace '| UC-003-A | no network | the hiker opens trail…' --if-match <revision>
node bin/app.js edit 'docs/use-cases/UC-003 Browse trail guides.md' --append --content ' ## Knowledge graph Implements [[Trailhead PRD]…' --if-match <revision>
node bin/app.js properties 'docs/design/Trip planner design.md' --set '{"stage":3,"status":"in-review","tags":["trailh…' --if-match <revision>
node bin/app.js edit 'docs/design/Trip planner design.md' --find 'Design decision ID: DSN-001. Status: draft.' --replace 'Design decision ID: DSN-001. Status: in review.' --if-match <revision>
node bin/app.js edit 'docs/design/Trip planner design.md' --find '| TBD | TBD | TBD | unverified |' --replace '| One planner page composed from [[trip-card]] …' --if-match <revision>
node bin/app.js edit 'docs/design/Trip planner design.md' --find 'Decision: pending.' --replace 'Decision: one planner page, pending usability r…' --if-match <revision>
node bin/app.js edit 'docs/design/Trip planner design.md' --append --content ' ## Knowledge graph Satisfies [[Trailhead PRD]]…' --if-match <revision>
node bin/app.js properties 'docs/delivery/Trip planner build spec.md' --set '{"stage":4,"status":"draft","tags":["trailhead"…' --if-match <revision>
node bin/app.js edit 'docs/delivery/Trip planner build spec.md' --find '| TBD | TBD | TBD | workspace or project | REQ-…' --replace '| UI components | `library/components/trip-plan…' --if-match <revision>
node bin/app.js edit 'docs/delivery/Trip planner build spec.md' --append --content ' ## Knowledge graph Specifies [[Trailhead PRD]]…' --if-match <revision>
node bin/app.js properties 'docs/delivery/Trip planner implementation plan.md' --set '{"stage":5,"status":"in-progress","tags":["trai…' --if-match <revision>
node bin/app.js edit 'docs/delivery/Trip planner implementation plan.md' --find 'Status: draft; all work below is planned' --replace 'Status: in progress; all work below is planned' --if-match <revision>
node bin/app.js edit 'docs/delivery/Trip planner implementation plan.md' --find '| IMP-001 | TBD | none or task ID | TBD | Trail…' --replace '| IMP-001 | Trip, Itinerary, TripWindow and Tri…' --if-match <revision>
node bin/app.js edit 'docs/delivery/Trip planner implementation plan.md' --append --content ' ## Knowledge graph Delivers [[Trip planner bui…' --if-match <revision>
node bin/app.js properties 'docs/delivery/Trip planner test plan.md' --set '{"stage":6,"status":"draft","tags":["trailhead"…' --if-match <revision>
node bin/app.js edit 'docs/delivery/Trip planner test plan.md' --find '| TEST-001 | TBD | TBD | unit / integration / e…' --replace '| TEST-001 | REQ-001 / UC-001 / IMP-001 | Trip …' --if-match <revision>
node bin/app.js edit 'docs/delivery/Trip planner test plan.md' --find '| TBD | TBD | TBD | TBD | TBD |' --replace '| Project gate | `src/forge-showcase` | `npm ci…' --if-match <revision>
node bin/app.js edit 'docs/delivery/Trip planner test plan.md' --append --content ' ## Knowledge graph Verifies [[Trailhead PRD]] …' --if-match <revision>
node bin/app.js properties 'docs/delivery/Trailhead 1.0 release plan.md' --set '{"stage":7,"status":"draft","tags":["trailhead"…' --if-match <revision>
node bin/app.js edit 'docs/delivery/Trailhead 1.0 release plan.md' --find '| REL-001 | TBD | TBD | TBD | TBD |' --replace '| REL-001 | Build the library and form preview …' --if-match <revision>
node bin/app.js edit 'docs/delivery/Trailhead 1.0 release plan.md' --append --content ' ## Knowledge graph Releases [[Trailhead PRD]] …' --if-match <revision>
node bin/app.js create docs/Trailhead.md --stdin < input
```

## Canvas map

```sh
node bin/app.js create 'docs/maps/Trailhead map.canvas'
node bin/app.js patch 'docs/maps/Trailhead map.canvas' --pointer /nodes --value '[{"id":"group-product","type":"group","label":"…' --if-match <revision>
node bin/app.js patch 'docs/maps/Trailhead map.canvas' --pointer /nodes/- --value '{"id":"code","type":"text","text":"## Code\n\n-…' --if-match <revision>
node bin/app.js patch 'docs/maps/Trailhead map.canvas' --pointer /edges --value '[{"id":"prd--uc-001","fromNode":"prd","fromSide…' --if-match <revision>
node bin/app.js patch 'docs/maps/Trailhead map.canvas' --pointer /edges/- --value '{"id":"trips-api--code","fromNode":"trips-api",…' --if-match <revision>
node bin/app.js validate 'docs/maps/Trailhead map.canvas'
```

## Bases

```sh
node bin/app.js create docs/bases/Documents.base --stdin < input
node bin/app.js validate docs/bases/Documents.base
node bin/app.js create docs/bases/Requirements.base --stdin < input
node bin/app.js validate docs/bases/Requirements.base
node bin/app.js create docs/bases/Library.base --stdin < input
node bin/app.js validate docs/bases/Library.base
node bin/app.js bases list
node bin/app.js bases inspect docs/bases/Documents.base
node bin/app.js bases inspect docs/bases/Requirements.base
node bin/app.js bases inspect docs/bases/Library.base
node bin/app.js bases query docs/bases/Documents.base --view 'By stage'
node bin/app.js bases query docs/bases/Documents.base --view 'Needs review'
node bin/app.js bases query docs/bases/Documents.base --view 'Linked to PRD'
node bin/app.js bases query docs/bases/Requirements.base --view REQ-001
node bin/app.js bases query docs/bases/Requirements.base --view REQ-002
node bin/app.js bases query docs/bases/Requirements.base --view REQ-003
node bin/app.js bases query docs/bases/Requirements.base --view REQ-004
node bin/app.js bases query docs/bases/Requirements.base --view REQ-005
node bin/app.js bases query docs/bases/Library.base --view 'Trailhead definitions'
node bin/app.js bases query docs/bases/Library.base --view 'Data sources'
```

## Project CI workflow

```sh
node bin/app.js create src/infrastructure/workflows/check/check.yml --stdin < input
node bin/app.js workflows list
```

## Agents and skills

```sh
node bin/app.js claude agents create trailhead-reviewer --metadata '{"name":"trailhead-reviewer","description":"Rev…' --prompt 'You review the Trailhead showcase for traceabil…'
node bin/app.js claude agents list
node bin/app.js skills install
```

## Project toolchain

```sh
node bin/app.js project inspect forge-showcase
node bin/app.js write src/index.ts --stdin --if-match <revision> < input
node bin/app.js write configs/quality/fallow.json --stdin --if-match <revision> < input
```
