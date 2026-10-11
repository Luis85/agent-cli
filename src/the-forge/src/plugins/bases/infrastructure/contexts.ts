import {
  createFileContext, createLinkResolutionMap, normalizeFrontmatterProperties,
  type ContextFileInput, type EvaluationContext, type Expression, type FileValueInput, type PropertyValueType,
} from 'obsidian-bases-expression';

/** Inputs that are identical for every row of one query. */
export interface SharedRowInput {
  thisFile: ContextFileInput;
  formulas: Record<string, Expression>;
  propertyTypes: Record<string, PropertyValueType>;
  objects: Record<string, unknown>;
  now: Date;
}
export interface RowContext { file: ContextFileInput; context: EvaluationContext }

type ResolutionTable = Record<string, string | null>;

/**
 * Produces, for each indexed file in order, the context that the pinned evaluator's
 * `createEvaluationContext({ note, file, files, thisFile, formulas, propertyTypes, now, linkResolutions, objects })`
 * builds, without rebuilding every file context and the whole link-resolution map for every row.
 *
 * That function lists the current file first and the other files in index order, builds the resolution map
 * from that list so that later files overwrite shared keys, and overlays the row's own link resolutions.
 * Here the file contexts, the list and the map are built once. Each row swaps two list entries and patches
 * only the keys its file writes or its links override, and restores them afterwards. A yielded context is
 * therefore valid only until the iteration advances.
 */
export class BaseRowContexts {
  private readonly contexts: FileValueInput[];
  private readonly table: ResolutionTable;
  private readonly writtenKeys: string[][];
  // Map key -> the last writer before the map's final writer, which wins when the final writer is listed first.
  private readonly shadowed = new Map<string, string>();
  private readonly thisFile: FileValueInput;
  private readonly dateTypes: string[];

  constructor(private readonly files: readonly ContextFileInput[], private readonly shared: SharedRowInput) {
    this.contexts = files.map(createFileContext);
    this.table = createLinkResolutionMap(this.contexts);
    const writers = new Map<string, string>();
    this.writtenKeys = this.contexts.map(file => {
      const keys = Object.keys(createLinkResolutionMap([file]));
      for (const key of keys) {
        const previous = writers.get(key);
        if (previous !== undefined) this.shadowed.set(key, previous);
        writers.set(key, file.path);
      }
      return keys;
    });
    this.thisFile = createFileContext({ ...shared.thisFile, path: shared.thisFile.path ?? '' });
    this.dateTypes = Object.keys(shared.propertyTypes).filter(name => shared.propertyTypes[name] === 'date');
  }

  *rows(): Generator<RowContext> {
    const ordered = [...this.contexts];
    const original = new Map<string, PropertyDescriptor | undefined>();
    const define = (key: string, value: string | null) => {
      if (!original.has(key)) original.set(key, Object.getOwnPropertyDescriptor(this.table, key));
      Object.defineProperty(this.table, key, { value, writable: true, enumerable: true, configurable: true });
    };
    for (const [index, file] of this.files.entries()) {
      const current = this.contexts[index]!;
      if (index > 0) { ordered[index] = this.contexts[index - 1]!; ordered[0] = current; }
      for (const key of this.writtenKeys[index]!) {
        const previous = this.shadowed.get(key);
        if (previous !== undefined && this.table[key] === current.path) define(key, previous);
      }
      const linkResolutions: ResolutionTable = Object.fromEntries((file.links ?? []).map(link => [link.path, link.resolvedPath ?? null]));
      for (const [key, value] of Object.entries(linkResolutions)) define(key, value);
      try {
        yield { file, context: this.context(file, current, ordered, linkResolutions) };
      } finally {
        for (const [key, descriptor] of original) {
          if (descriptor) Object.defineProperty(this.table, key, descriptor);
          else Reflect.deleteProperty(this.table, key);
        }
        original.clear();
      }
    }
  }

  private context(file: ContextFileInput, current: FileValueInput, files: FileValueInput[], linkResolutions: ResolutionTable): EvaluationContext {
    const propertyTypes = this.propertyTypes(file);
    const note = normalizeFrontmatterProperties(file.properties ?? {}, { linkResolutions, propertyTypes });
    const { formulas, objects, now } = this.shared;
    return { note, file: current, files, linkResolutions: this.table, objects, thisFile: this.thisFile, formulas, propertyTypes, now };
  }

  // Date types apply only where the row has a value, so empty dates evaluate as null rather than invalid dates.
  private propertyTypes(file: ContextFileInput): Record<string, PropertyValueType> {
    const empty = (name: string) => {
      const value = file.properties?.[name];
      return value === undefined || value === null || value === '';
    };
    if (!this.dateTypes.some(empty)) return this.shared.propertyTypes;
    return Object.fromEntries(Object.entries(this.shared.propertyTypes).filter(([name, type]) => type !== 'date' || !empty(name)));
  }
}
