/** Portable scalar models shared by REST and local-JSON adapters. */
export type DataSourceValue = string | number | boolean | null;
export type DataSourceRecord = Record<string, DataSourceValue>;
export interface DataSourceField {
  type: 'string' | 'number' | 'boolean';
  optional?: boolean;
  nullable?: boolean;
  enum?: DataSourceValue[];
  example?: DataSourceValue;
}
export interface DataSourceModel { name: string; idField: string; fields: Record<string, DataSourceField> }
export type DataSourceOperationName = 'list' | 'get' | 'create' | 'update' | 'delete';
export interface DataSourceOperation {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  responsePath?: string;
}
export interface DataSourceDefinition {
  schemaVersion: 1;
  id: string;
  kind: 'rest' | 'json';
  model: DataSourceModel;
  rest?: { baseUrl: string; operations: Partial<Record<DataSourceOperationName, DataSourceOperation>> };
  /** Relative local JSON path passed to the application-supplied loader. */
  json?: { path: string };
  testData?: { count?: number; records?: DataSourceRecord[] };
  description: string;
  sourcePath: string;
}
