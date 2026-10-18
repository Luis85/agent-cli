/** One envelope warning, as the response reports it. */
export interface ResponseWarning { code: string; message: string; details?: Record<string, unknown> }

/** The messages of a response's warnings, for assertions on the texts that plugin fixtures warn with. */
export const warningMessages = (body: { warnings: readonly ResponseWarning[] }): string[] => body.warnings.map(warning => warning.message);

