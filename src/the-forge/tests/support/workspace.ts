import { dirname, resolve } from 'node:path';
import metadata from '../../package.json';

/** The workspace bin directory that `npm run build` fills, from package.json config.distribution. */
export const distribution = resolve(metadata.config.distribution);
/** The workspace containing the distribution, sibling managed projects and generated GitHub workflows. */
export const workspaceRoot = dirname(distribution);
