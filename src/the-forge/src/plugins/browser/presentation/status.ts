import type { BrowserStatus } from '../application/runtime.ts';

/** `browser status` as published: the runtime's language-independent result plus recovery guidance in the response language. */
export type BrowserStatusView = BrowserStatus & { nextStep: string | null };

/** Builds `nextStep` from `reason` and `source` with the plugin's `messages`; available results need no guidance. */
export function browserStatusView(status: BrowserStatus, t: (key: string) => string): BrowserStatusView {
  if (status.reason === 'available') return { ...status, nextStep: null };
  const selection = t(`status.source.${status.source}`);
  const check = status.reason === 'not-executable' || status.reason === 'inaccessible' ? `${t(`status.reason.${status.reason}`)} ` : '';
  return { ...status, nextStep: check + selection };
}
