import { stringify } from 'yaml';

/**
 * Obsidian's `stringifyYaml` as observed in plugin-written notes: block mappings and lists with two-space list
 * indentation, plain scalars where YAML allows them, double quotes otherwise (`"[[Note]]"`, `""`), and long
 * double-quoted strings folded at 80 columns. These are the `yaml` package's defaults.
 */
export function stringifyYaml(value: Record<string, unknown>): string {
  return stringify(value);
}
