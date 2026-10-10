import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';

/**
 * An independent JSON Schema 2020-12 validator in strict mode, so unknown keywords and formats fail to compile.
 * Positional arguments are deliberately open-ended tuples (optional trailing arguments), which strictTuples flags.
 */
export const strictAjv = () => new Ajv2020({ strict: true, strictTuples: false, allErrors: true });

interface CommandContract {
  id: string;
  inputSchema: object;
  outputSchema?: object;
  annotations: { defaultAction?: string; actions?: Record<string, { outputSchema?: object }> };
}
export interface SchemaDocument { envelope: object; commands: CommandContract[] }

/** Every JSON Schema document the `schema` output publishes, labelled by where it appears. */
export function publishedSchemas(document: SchemaDocument): Array<[string, object]> {
  return [
    ['envelope', document.envelope],
    ...document.commands.flatMap(command => [
      [`${command.id} input`, command.inputSchema] as [string, object],
      ...(command.outputSchema ? [[`${command.id} output`, command.outputSchema] as [string, object]] : []),
      ...Object.entries(command.annotations.actions ?? {}).flatMap(([id, action]) => action.outputSchema ? [[`${command.id} ${id} output`, action.outputSchema] as [string, object]] : []),
    ]),
  ];
}

/** The output schema that applies to `command args…`: the selected action's own, else the command's. */
function outputSchemaFor(document: SchemaDocument, args: readonly string[]): object | undefined {
  const command = document.commands.find(entry => entry.id === args[0]);
  if (!command) throw new Error(`schema does not describe ${args[0]}`);
  const actions = command.annotations.actions ?? {};
  const action = args[1] !== undefined && Object.hasOwn(actions, args[1]) ? args[1] : command.annotations.defaultAction;
  return (action === undefined ? undefined : actions[action]?.outputSchema) ?? command.outputSchema;
}

/** Validates responses against the published envelope and output schemas with one cached Ajv instance. */
export function responseValidator(document: SchemaDocument) {
  const ajv = strictAjv();
  const compiled = new Map<object, ValidateFunction>();
  const compile = (schema: object) => {
    let validate = compiled.get(schema);
    if (!validate) { validate = ajv.compile(schema); compiled.set(schema, validate); }
    return validate;
  };
  const issues = (schema: object, value: unknown) => {
    const validate = compile(schema);
    return validate(value) ? [] : (validate.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message ?? ''}`);
  };
  return {
    envelope: (body: unknown) => issues(document.envelope, body),
    /** Issues of `data` against the command's output schema; throws when the command declares none. */
    output(args: readonly string[], data: unknown) {
      const schema = outputSchemaFor(document, args);
      if (!schema) throw new Error(`${args.slice(0, 2).join(' ')} declares no output schema`);
      return issues(schema, data);
    },
  };
}
