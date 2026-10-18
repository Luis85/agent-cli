import { createHmac } from 'node:crypto';

/**
 * The API token a launch link hands to one view: derived from the server token and the view id, it grants the
 * read-only endpoints only. The server token itself, which also controls the server lifecycle, stays with the CLI.
 */
export function viewToken(serverToken: string, viewId: string): string {
  return createHmac('sha256', serverToken).update(`forge-view:${viewId}`).digest('hex');
}
