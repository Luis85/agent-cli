/** Browser-only effects are invoked by generated listeners, never while rendering on a server. */
export function formActionHelper(prefix: string, typescript: boolean, classMembers: boolean): string {
  const member = classMembers ? 'this.' : '';
  return `async function ${prefix}FormAction(target${typescript ? ': EventTarget | null' : ''}, action${typescript ? ': string' : ''}, option${typescript ? ': unknown' : ''}) {
  try {
    const element = target${typescript ? ' as HTMLElement | null' : ''};
    const form = element?.closest('form') ?? (${typescript ? 'element as HTMLButtonElement | null' : 'element'})?.form;
    if (!form || form.tagName !== 'FORM') throw new globalThis.TypeError('Form interaction requires an associated form.');
    const view = form.ownerDocument.defaultView;
    if (!view) throw new globalThis.TypeError('Form interaction requires a browser window.');
    if (typeof option !== 'string' || !option.trim()) throw new globalThis.TypeError('Form interaction requires a nonempty string option.');
    if (!form.reportValidity()) throw new globalThis.TypeError('Form validation failed.');
    const fields = new view.FormData(form);
    if (action === 'upload-form') {
      if (option !== option.trim() || /[\\u0000-\\u001f\\\\]/.test(option) || option.startsWith('//') || (/^[a-z][a-z0-9+.-]*:/i.test(option) && !/^https?:\\/\\//i.test(option))) throw new globalThis.TypeError('Unsafe interaction upload URL.');
      const url = new view.URL(option, form.ownerDocument.baseURI);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new globalThis.TypeError('Unsafe interaction upload URL.');
      const response = await view.fetch(url.href, { method: 'POST', body: fields, credentials: 'same-origin' });
      if (!response.ok) throw new globalThis.Error('Upload failed with HTTP ' + response.status + '.');
      ${member}${prefix}Emit(target, 'forge:upload', { url: url.href, status: response.status, ok: true });
      return true;
    }
    const data${typescript ? ': Record<string, unknown>' : ''} = Object.create(null);
    for (const [name, field] of fields.entries()) {
      const value = typeof field === 'string' ? field : { name: field.name, size: field.size, type: field.type, lastModified: field.lastModified };
      if (!Object.hasOwn(data, name)) data[name] = value;
      else { const previous = data[name]; data[name] = Array.isArray(previous) ? [...previous, value] : [previous, value]; }
    }
    if (action === 'save-form') {
      view.localStorage.setItem(option, JSON.stringify(data));
      ${member}${prefix}Emit(target, 'forge:save', { key: option, data });
    } else {
      if (/[\\u0000-\\u001f/\\\\]/.test(option)) throw new globalThis.TypeError('Download filename must not contain path separators or control characters.');
      const blob = new view.Blob([JSON.stringify(data, null, 2) + '\\n'], { type: 'application/json' });
      const url = view.URL.createObjectURL(blob);
      const link = form.ownerDocument.createElement('a');
      link.href = url; link.download = option; link.hidden = true;
      try { form.ownerDocument.body.append(link); link.click(); }
      finally { link.remove(); view.setTimeout(() => view.URL.revokeObjectURL(url), 0); }
      ${member}${prefix}Emit(target, 'forge:download', { filename: option, data });
    }
    return true;
  } catch (error) {
    ${member}${prefix}Emit(target, 'forge:interaction-error', { action, message: error instanceof globalThis.Error ? error.message : String(error) });
    return false;
  }
}`;
}
