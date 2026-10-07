import type { Generator } from '../application/plugins.ts';
import { ensure } from '../domain/errors.ts';
import { vaultPath } from '../domain/file.ts';
import { encodeText } from './documents.ts';

function names(name: string, directory: string) {
  ensure(/^[A-Z][A-Za-z0-9]*$/.test(name), 'INVALID_NAME', 'Use a PascalCase TypeScript name, for example WorkItem.');
  vaultPath(directory);
  return { name, directory, file: name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase() };
}
export const generators: Generator[] = [
  { id: 'entity', description: 'Domain entity with identity and invariant enforcement.', generate(input, dir) {
    const { name, directory, file } = names(input, dir);
    return [{ path: `${directory}/${file}.ts`, bytes: encodeText(`export class ${name} {\n  private constructor(readonly id: string) {}\n\n  static create(id: string): ${name} {\n    if (!id.trim()) throw new Error('${name} requires an identity');\n    return new ${name}(id);\n  }\n}\n`) }];
  } },
  { id: 'value-object', description: 'Immutable value object with equality and validation.', generate(input, dir) {
    const { name, directory, file } = names(input, dir);
    return [{ path: `${directory}/${file}.ts`, bytes: encodeText(`export class ${name} {\n  private constructor(readonly value: string) { Object.freeze(this); }\n\n  static from(value: string): ${name} {\n    if (!value.trim()) throw new Error('${name} cannot be empty');\n    return new ${name}(value);\n  }\n\n  equals(other: ${name}): boolean { return this.value === other.value; }\n}\n`) }];
  } },
  { id: 'use-case', description: 'Application use case with an injected repository port.', generate(input, dir) {
    const { name, directory, file } = names(input, dir);
    return [{ path: `${directory}/${file}.ts`, bytes: encodeText(`export interface ${name}Input { readonly id: string }\nexport interface ${name}Repository { exists(id: string): Promise<boolean> }\n\nexport class ${name} {\n  constructor(private readonly repository: ${name}Repository) {}\n\n  async execute(input: ${name}Input): Promise<{ exists: boolean }> {\n    if (!input.id.trim()) throw new Error('Identity is required');\n    return { exists: await this.repository.exists(input.id) };\n  }\n}\n`) }];
  } },
  { id: 'event', description: 'Typed event payload and runtime descriptor.', generate(input, dir) {
    const { name, directory, file } = names(input, dir);
    return [{ path: `${directory}/${file}.ts`, bytes: encodeText(`export interface ${name} { readonly id: string }\nexport const ${name}Event = {\n  id: 'app.${file}',\n  validate(value: unknown): value is ${name} {\n    return value !== null && typeof value === 'object' && 'id' in value && typeof value.id === 'string';\n  },\n};\n`) }];
  } },
  { id: 'plugin', description: 'Immediately runnable ESM plugin with a namespaced command.', generate(input, dir) {
    const { directory, file } = names(input, dir);
    return [{ path: `${directory}/${file}.mjs`, bytes: encodeText(`export default {\n  manifest: { id: '${file}', version: '1.0.0', apiVersion: 1 },\n  commands: [{\n    id: '${file}.hello', description: 'Describe this plugin', usage: '${file}.hello',\n    run() { return { plugin: '${file}', ready: true }; },\n  }],\n};\n`) }];
  } },
];
