import { z } from 'zod';
import type { FormDefinition } from "./form-model.js";

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(100, 'Use 100 characters or fewer.'),
  email: z.string().trim().pipe(z.email('Enter a valid email address.')),
  description: z.string().trim().max(2000, 'Use 2,000 characters or fewer.').default(''),
}).strict();

export type TripRequestValues = z.infer<typeof schema>;

export const TripRequestForm: FormDefinition<TripRequestValues> = {
  id: 'trip-request',
  title: 'Trip Request',
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
