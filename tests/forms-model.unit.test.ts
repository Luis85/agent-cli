import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validateForm, type FormDefinition } from '../src/infrastructure/scaffolds/form-model.js';

const definition: FormDefinition<{ name: string; email: string }> = {
  id: 'contact', title: 'Contact', submitLabel: 'Send',
  initialValues: { name: '', email: '' },
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
  ],
  schema: z.object({ name: z.string().trim().min(1, 'Name is required'), email: z.email('Enter an email') }),
};

describe('schema-backed form models', () => {
  it('returns parsed and transformed values rather than raw input', () => {
    expect(validateForm(definition, { name: ' Ada ', email: 'ada@example.com', extra: 'ignored' })).toEqual({
      success: true, data: { name: 'Ada', email: 'ada@example.com' },
    });
  });

  it('reports every schema issue with its field', () => {
    expect(validateForm(definition, { name: '  ', email: 'invalid' })).toEqual({
      success: false,
      errors: [{ field: 'name', message: 'Name is required' }, { field: 'email', message: 'Enter an email' }],
    });
  });

  it.each([null, undefined, 42, 'name'])('rejects untrusted non-object input %j', input => {
    expect(validateForm(definition, input)).toMatchObject({ success: false, errors: [{ field: '' }] });
  });

  it('preserves cross-field validation errors', () => {
    const restricted = { ...definition, schema: definition.schema.refine(() => false, 'Contact is unavailable') };
    expect(validateForm(restricted, { name: 'Ada', email: 'ada@example.com' })).toEqual({
      success: false, errors: [{ field: '', message: 'Contact is unavailable' }],
    });
  });
});
