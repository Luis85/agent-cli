import prd from '../../../../docs/templates/workflow/prd.md?raw';
import useCase from '../../../../docs/templates/workflow/use-case.md?raw';
import buildSpec from '../../../../docs/templates/workflow/build-spec.md?raw';
import design from '../../../../docs/templates/workflow/design.md?raw';
import implementationPlan from '../../../../docs/templates/workflow/implementation-plan.md?raw';
import testPlan from '../../../../docs/templates/workflow/test-plan.md?raw';
import releasePlan from '../../../../docs/templates/workflow/release-plan.md?raw';
import type { TemplateArtifact } from '../../../application/workspace/setup.ts';

const entityTemplate = `---
type: entity
title: '{{title}}'
created: '{{date:YYYY-MM-DD}}'
---
# {{title}}

Created: {{date:YYYY-MM-DD}}

## Purpose

Describe the entity's responsibility and identity.

## Invariants

- Define the rules that must always hold.

## Acceptance criteria

- Describe observable behavior and verification.
`;

/** The planning workflow pack that `templates install workflow` installs, authored in docs/templates/workflow. */
export const workflowTemplates: readonly TemplateArtifact[] = [
  { path: 'workflow/prd.md', content: prd },
  { path: 'workflow/use-case.md', content: useCase },
  { path: 'workflow/build-spec.md', content: buildSpec },
  { path: 'workflow/design.md', content: design },
  { path: 'workflow/implementation-plan.md', content: implementationPlan },
  { path: 'workflow/test-plan.md', content: testPlan },
  { path: 'workflow/release-plan.md', content: releasePlan },
];

/** Everything `setup` installs into bin/templates: the starter entity template, then the workflow pack. */
export const setupTemplates: readonly TemplateArtifact[] = [{ path: 'entity.md', content: entityTemplate }, ...workflowTemplates];
