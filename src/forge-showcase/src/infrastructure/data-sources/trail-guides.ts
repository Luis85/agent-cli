// Generated deterministically from trail-guides.md. No runtime dependencies.
export interface TrailGuide {
  "difficulty": "easy" | "moderate" | "hard";
  "distanceKm": number;
  "dogFriendly": boolean;
  "id": string;
  "name": string;
  "region": "sierra" | "cascades" | "coast" | "desert";
}
export type TrailGuideId = TrailGuide["id"];
export class TrailGuideDataSourceError extends globalThis.Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = "TrailGuideDataSourceError"; }
}
const fields: { [key: string]: { type: string; optional?: boolean; nullable?: boolean; enum?: readonly unknown[] } } = {
  "difficulty": {
    "enum": [
      "easy",
      "moderate",
      "hard"
    ],
    "type": "string"
  },
  "distanceKm": {
    "type": "number"
  },
  "dogFriendly": {
    "type": "boolean"
  },
  "id": {
    "type": "string"
  },
  "name": {
    "type": "string"
  },
  "region": {
    "enum": [
      "sierra",
      "cascades",
      "coast",
      "desert"
    ],
    "type": "string"
  }
};
function validateField(key: string, value: unknown): void {
  const field = fields[key];
  if (!field) throw new TrailGuideDataSourceError('Unknown field: ' + key);
  if (value === undefined && field.optional) return;
  if (value === null ? !field.nullable : typeof value !== field.type || (typeof value === 'number' && !globalThis.Number.isFinite(value))) {
    throw new TrailGuideDataSourceError('Invalid field: ' + key);
  }
  if (field.enum && !field.enum.includes(value)) throw new TrailGuideDataSourceError('Invalid enum field: ' + key);
}
function validateRecord(value: unknown, partial: boolean, strict = partial): void {
  if (value === null || typeof value !== 'object' || globalThis.Array.isArray(value)) throw new TrailGuideDataSourceError('Expected an object');
  const record = value as { [key: string]: unknown };
  if (strict) for (const key of globalThis.Object.keys(record)) if (!globalThis.Object.hasOwn(fields, key)) throw new TrailGuideDataSourceError('Unknown field: ' + key);
  for (const key of globalThis.Object.keys(fields)) {
    if (!partial || globalThis.Object.hasOwn(record, key)) validateField(key, globalThis.Object.hasOwn(record, key) ? record[key] : undefined);
  }
  if (!partial || globalThis.Object.hasOwn(record, "id")) validateTrailGuideId(record["id"] as TrailGuideId);
}
export function validateTrailGuide(value: unknown): TrailGuide { validateRecord(value, false); return value as TrailGuide; }
export function validateTrailGuideId(id: TrailGuideId): void {
  validateField("id", id);
  if (typeof id === 'string' && ['', '.', '..'].includes(id)) throw new TrailGuideDataSourceError('ID cannot be empty or a dot path segment');
}
export function validateTrailGuideList(value: unknown): TrailGuide[] {
  if (!globalThis.Array.isArray(value)) throw new TrailGuideDataSourceError('Expected an array of records');
  const records = value.map(item => validateTrailGuide(item));
  const ids = new globalThis.Set(records.map(record => record["id"]));
  if (ids.size !== records.length) throw new TrailGuideDataSourceError('Duplicate record IDs');
  return records;
}
export interface TrailGuideDataSourceOptions {
  /** Read and parse the configured local JSON file using your runtime's filesystem or asset loader. */
  loadJson(path: string): globalThis.Promise<unknown>;
  path?: string;
}
export function createTrailGuideDataSource(options: TrailGuideDataSourceOptions) {
  const path = options.path ?? "test-data/trail-guides.fixtures.json";
  return {
    async list(): globalThis.Promise<TrailGuide[]> { return validateTrailGuideList(await options.loadJson(path)); },
    async get(id: TrailGuideId): globalThis.Promise<TrailGuide> {
      validateTrailGuideId(id);
      const record = validateTrailGuideList(await options.loadJson(path)).find(item => item["id"] === id);
      if (!record) throw new TrailGuideDataSourceError('Record not found: ' + id, 404);
      return record;
    },
  };
}
