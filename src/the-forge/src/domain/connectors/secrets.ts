/**
 * Removes every occurrence of each secret from text, including the encoded forms a transport could echo: the Basic
 * credential `base64(":" + secret)` and the URL-encoded secret. Secrets shorter than four characters are ignored.
 */
export function redact(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets.filter(value => value.length >= 4)) {
    const forms = [secret, encodeURIComponent(secret)];
    try { forms.push(btoa(`:${secret}`)); } catch { /* Not Latin-1, so it cannot appear Base64-encoded in a Basic header. */ }
    for (const form of forms) result = result.split(form).join('[redacted]');
  }
  return result;
}
