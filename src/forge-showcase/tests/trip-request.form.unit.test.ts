import { expect, it } from 'vitest';
import { TripRequestForm } from "../src/presentation/forms/trip-request.form.js";
import { validateForm } from "../src/presentation/forms/form-model.js";

it('validates and normalizes form data', () => {
  expect(validateForm(TripRequestForm, { name: '  Example  ', email: '  engineer@example.com  ', description: '  A focused project.  ' })).toEqual({
    success: true, data: { name: 'Example', email: 'engineer@example.com', description: 'A focused project.' },
  });
});

it('reports invalid required fields without submitting data', () => {
  const result = validateForm(TripRequestForm, { name: '', email: 'invalid', description: '' });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.errors.map(error => error.field)).toEqual(['name', 'email']);
});
