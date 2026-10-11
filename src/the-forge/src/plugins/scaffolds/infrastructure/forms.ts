/** A typed, editable definition shared by the maker and starter showcase. */
export function formDefinitionSource(name: string, runtimeImport: string): string {
  const title = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return `import { z } from 'zod';
import type { FormDefinition } from ${JSON.stringify(runtimeImport)};

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(100, 'Use 100 characters or fewer.'),
  email: z.string().trim().pipe(z.email('Enter a valid email address.')),
  description: z.string().trim().max(2000, 'Use 2,000 characters or fewer.').default(''),
}).strict();

export type ${name}Values = z.infer<typeof schema>;

export const ${name}Form: FormDefinition<${name}Values> = {
  id: '${name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}',
  title: '${title}',
  description: 'Describe the project and its primary contact.',
  submitLabel: 'Validate details',
  initialValues: { name: '', email: '', description: '' },
  schema,
  fields: [
    { name: 'name', label: 'Project name', type: 'text', required: true, help: 'A clear name, up to 100 characters.' },
    { name: 'email', label: 'Contact email', type: 'email', required: true, placeholder: 'engineer@example.com' },
    { name: 'description', label: 'Description', type: 'textarea', help: 'Optional. Explain the project in 2,000 characters or fewer.' },
  ],
};
`;
}

export function formDefinitionTestSource(name: string, definitionImport: string, runtimeImport: string): string {
  return `import { expect, it } from 'vitest';
import { ${name}Form } from ${JSON.stringify(definitionImport)};
import { validateForm } from ${JSON.stringify(runtimeImport)};

it('validates and normalizes form data', () => {
  expect(validateForm(${name}Form, { name: '  Example  ', email: '  engineer@example.com  ', description: '  A focused project.  ' })).toEqual({
    success: true, data: { name: 'Example', email: 'engineer@example.com', description: 'A focused project.' },
  });
});

it('reports invalid required fields without submitting data', () => {
  const result = validateForm(${name}Form, { name: '', email: 'invalid', description: '' });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.errors.map(error => error.field)).toEqual(['name', 'email']);
});
`;
}
