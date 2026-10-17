import type { JsonSchema } from '../../../domain/schema/json-schema.ts';

const text: JsonSchema = { type: 'string' };
const integer: JsonSchema = { type: 'integer', minimum: 1 };
const changes: JsonSchema = { type: 'array', items: { type: 'object' } };
const sandbox: JsonSchema = { enum: ['enabled', 'disabled-root', 'disabled-option'],
  description: 'Chromium sandbox of this run: enabled, disabled-root (running as root on Linux) or disabled-option (--no-browser-sandbox).' };
const viewport: JsonSchema = { type: 'object', additionalProperties: false, required: ['width', 'height'], properties: { width: integer, height: integer } };
export const browserStatusSchema: JsonSchema = {
  type: 'object', additionalProperties: false, required: ['available', 'executablePath', 'source', 'version', 'verification', 'reason', 'sandbox', 'nextStep'],
  properties: {
    available: { type: 'boolean', description: 'The selected path is a regular file accessible for execution (existence only on Windows); browser launch is unverified.' },
    executablePath: { oneOf: [text, { type: 'null' }] }, source: { enum: ['explicit', 'environment', 'managed'] },
    version: { ...text, description: 'Packaged Playwright runtime version, not the Chromium executable version.' },
    verification: { const: 'executable-only', description: 'Filesystem checks only; no browser launch, compatibility or operating-system dependency check.' },
    reason: { enum: ['available', 'missing', 'not-file', 'not-executable', 'inaccessible'] },
    sandbox: { enum: ['enabled', 'disabled-root'], description: 'Chromium sandbox a launch without --no-browser-sandbox uses: disabled-root when running as root on Linux.' },
    nextStep: { oneOf: [text, { type: 'null' }], description: 'Recovery guidance when unavailable; null when the filesystem check passed.' },
  },
};
export const installSchema: JsonSchema = { oneOf: [
  { type: 'object', additionalProperties: false, required: ['dryRun', 'executed', 'plan'], properties: {
    dryRun: { const: true }, executed: { const: false }, plan: { type: 'object', additionalProperties: false, required: ['browser', 'operation'], properties: { browser: { const: 'chromium' }, operation: { const: 'install' } } },
  } },
  { type: 'object', additionalProperties: false, required: ['dryRun', 'executed', 'status'], properties: {
    dryRun: { const: false }, executed: { const: true }, status: browserStatusSchema,
  } },
] };
export const screenshotSchema: JsonSchema = { oneOf: [
  { type: 'object', additionalProperties: false, required: ['dryRun', 'captured', 'plan', 'changes'], properties: {
    dryRun: { const: true }, captured: { const: false }, changes: { type: 'array', maxItems: 0 },
    plan: { type: 'object', additionalProperties: false, required: ['requestedUrl', 'out', 'viewport', 'fullPage', 'timeoutMs'], properties: {
      requestedUrl: { ...text, description: 'Requested URL without its query, fragment or credentials.' }, out: text, viewport,
      fullPage: { type: 'boolean' }, waitForSelector: text, timeoutMs: integer,
    } },
  } },
  { type: 'object', additionalProperties: false,
    required: ['dryRun', 'captured', 'path', 'revision', 'bytes', 'width', 'height', 'requestedUrl', 'finalUrl', 'capturedAt', 'markdown', 'sandbox', 'changes'],
    properties: { dryRun: { const: false }, captured: { const: true }, path: text, revision: text, bytes: integer, width: integer, height: integer,
      requestedUrl: text, finalUrl: { ...text, description: 'Final page URL without its query, fragment or credentials.' }, sandbox, capturedAt: { ...text, description: 'Capture timestamp in UTC ISO 8601 form.' }, markdown: text, changes },
  },
] };

const tutorialProperties: Record<string, JsonSchema> = {
  source: text, sourceRevision: text, plan: { type: 'object', description: 'Normalized version 1 tutorial flow with explicit steps and browser actions.' },
  output: { oneOf: [text, { type: 'null' }] }, revision: { oneOf: [text, { type: 'null' }] },
  files: { type: 'array', items: text },
};
export const tutorialValidationSchema: JsonSchema = { type: 'object', additionalProperties: false,
  required: ['source', 'sourceRevision', 'plan', 'output', 'revision', 'files'], properties: tutorialProperties };
export const tutorialSchema: JsonSchema = { type: 'object', additionalProperties: false,
  required: ['source', 'sourceRevision', 'plan', 'output', 'revision', 'files', 'dryRun', 'executed', 'changes', 'browserVersion', 'sandbox'],
  properties: { ...tutorialProperties, dryRun: { type: 'boolean' }, executed: { type: 'boolean' }, changes, browserVersion: { oneOf: [text, { type: 'null' }] },
    sandbox: { oneOf: [sandbox, { type: 'null' }] } },
};
