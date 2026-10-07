import { posix } from 'node:path';
import { formDefinitionSource, formDefinitionTestSource } from './form-definition.ts';
import type { Generator } from '../../application/plugins/registry.ts';
import { ensure } from '../../domain/shared/errors.ts';
import { vaultPath } from '../../domain/documents/file.ts';
import { encodeText } from '../documents/codec.ts';

function names(name: string, directory: string) {
  ensure(/^[A-Z][A-Za-z0-9]*$/.test(name), 'INVALID_NAME', 'Use a PascalCase TypeScript name, for example WorkItem.');
  vaultPath(directory);
  return { name, directory, file: name.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase() };
}
export const generators: Generator[] = [
  { id: 'form', description: 'Typed form definition with Zod validation and HTML preview in a Forge project.', generate(input, dir) {
    const { name, directory, file } = names(input, dir);
    const relative = posix.relative(directory, 'src/presentation/forms/form-model.js');
    const runtimeImport = relative.startsWith('.') ? relative : `./${relative}`;
    const definition = `${directory}/${file}.form.ts`;
    const testImport = posix.relative('tests', definition).replace(/\.ts$/, '.js');
    return [
      { path: definition, bytes: encodeText(formDefinitionSource(name, runtimeImport)) },
      { path: `tests/${file}.form.unit.test.ts`, bytes: encodeText(formDefinitionTestSource(name, testImport.startsWith('.') ? testImport : `./${testImport}`, '../src/presentation/forms/form-model.js')) },
    ];
  } },
  { id: 'entity', description: 'Domain entity with identity and invariant enforcement.', generate(input, dir) {
    const { name, directory, file } = names(input, dir);
    return [{ path: `${directory}/${file}.ts`, bytes: encodeText(`export class ${name} {\n  private constructor(readonly id: string) {}\n\n  static create(id: string): ${name} {\n    if (!id.trim()) throw new globalThis.Error('${name} requires an identity');\n    return new ${name}(id);\n  }\n}\n`) }];
  } },
  { id: 'value-object', description: 'Immutable value object with equality and validation.', generate(input, dir) {
    const { name, directory, file } = names(input, dir);
    return [{ path: `${directory}/${file}.ts`, bytes: encodeText(`export class ${name} {\n  private constructor(readonly value: string) { globalThis.Object.freeze(this); }\n\n  static from(value: string): ${name} {\n    if (!value.trim()) throw new globalThis.Error('${name} cannot be empty');\n    return new ${name}(value);\n  }\n\n  equals(other: ${name}): boolean { return this.value === other.value; }\n}\n`) }];
  } },
  { id: 'use-case', description: 'Application use case with an injected repository port.', generate(input, dir) {
    const { name, directory, file } = names(input, dir);
    return [{ path: `${directory}/${file}.ts`, bytes: encodeText(`export interface ${name}Input { readonly id: string }\nexport interface ${name}Repository { exists(id: string): globalThis.Promise<boolean> }\n\nexport class ${name} {\n  constructor(private readonly repository: ${name}Repository) {}\n\n  async execute(input: ${name}Input): globalThis.Promise<{ exists: boolean }> {\n    if (!input.id.trim()) throw new globalThis.Error('Identity is required');\n    return { exists: await this.repository.exists(input.id) };\n  }\n}\n`) }];
  } },
  { id: 'event', description: 'Typed event payload and runtime descriptor.', generate(input, dir) {
    const { name, directory, file } = names(input, dir);
    return [{ path: `${directory}/${file}.ts`, bytes: encodeText(`export interface ${name} { readonly id: string }\nexport const ${name}Event = {\n  id: 'app.${file}',\n  validate(value: unknown): value is ${name} {\n    return value !== null && typeof value === 'object' && 'id' in value && typeof value.id === 'string';\n  },\n};\n`) }];
  } },
  { id: 'plugin', description: 'Installable plugin folder with a manifest, namespaced command and lifecycle hooks.', generate(input, dir) {
    const { name, directory, file } = names(input, dir);
    const manifest = {
      id: file, name, version: '0.1.0', minAppVersion: '0.1.0',
      description: `${name} development tools.`, author: 'Your team',
    };
    return [
      { path: `${directory}/${file}/manifest.json`, bytes: encodeText(JSON.stringify(manifest, null, 2) + '\n') },
      { path: `${directory}/${file}/main.mjs`, bytes: encodeText(`let ready = false;\n\nexport default {\n  commands: [{\n    id: '${file}.hello', description: 'Describe this plugin', usage: '${file}.hello',\n    run() { return { plugin: '${file}', ready }; },\n  }],\n\n  onload() { ready = true; },\n  onunload() { ready = false; },\n};\n`) },
    ];
  } },
];
