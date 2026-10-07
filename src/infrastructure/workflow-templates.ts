import prd from '../../templates/workflow/prd.md?raw';
import useCase from '../../templates/workflow/use-case.md?raw';
import buildSpec from '../../templates/workflow/build-spec.md?raw';
import design from '../../templates/workflow/design.md?raw';
import implementationPlan from '../../templates/workflow/implementation-plan.md?raw';
import testPlan from '../../templates/workflow/test-plan.md?raw';
import releasePlan from '../../templates/workflow/release-plan.md?raw';
import type { TemplateArtifact } from '../application/templates.ts';

export const workflowTemplates: readonly TemplateArtifact[] = [
  { path: 'workflow/prd.md', content: prd },
  { path: 'workflow/use-case.md', content: useCase },
  { path: 'workflow/build-spec.md', content: buildSpec },
  { path: 'workflow/design.md', content: design },
  { path: 'workflow/implementation-plan.md', content: implementationPlan },
  { path: 'workflow/test-plan.md', content: testPlan },
  { path: 'workflow/release-plan.md', content: releasePlan },
];
