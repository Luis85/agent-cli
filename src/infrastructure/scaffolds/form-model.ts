import type { z } from 'zod';

export interface FormField<T extends Record<string, string>> {
  name: Extract<keyof T, string>;
  label: string;
  type: 'text' | 'email' | 'textarea';
  required?: boolean;
  help?: string;
  placeholder?: string;
}

export interface FormDefinition<T extends Record<string, string>> {
  id: string;
  title: string;
  description?: string;
  submitLabel: string;
  fields: FormField<T>[];
  initialValues: T;
  schema: z.ZodType<T>;
}

export type FormValidation<T> =
  | { success: true; data: T }
  | { success: false; errors: { field: string; message: string }[] };

/** The schema is authoritative; HTML hints do not replace validation. */
export function validateForm<T extends Record<string, string>>(
  definition: FormDefinition<T>,
  input: unknown,
): FormValidation<T> {
  const result = definition.schema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    errors: result.error.issues.map(issue => ({
      field: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  };
}
