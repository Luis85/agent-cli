/** Values supplied by a caller are data, never executable template expressions. */
export interface TemplateOptions {
  title: string;
  values?: Record<string, unknown>;
  /** ISO date or timestamp. Rendering uses UTC for reproducible agent workflows. */
  date?: string;
  dateFormat?: string;
  timeFormat?: string;
}

export interface TemplateInspection {
  /** Unique placeholder expressions, including built-in names and date formats. */
  variables: string[];
}

export interface DocumentTemplates {
  inspect(bytes: Uint8Array): TemplateInspection;
  render(bytes: Uint8Array, options: TemplateOptions): Uint8Array;
}
