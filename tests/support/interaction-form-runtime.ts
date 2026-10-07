import type { InteractionDefinition } from '../../src/domain/interaction.ts';
import type { UiDefinition } from '../../src/domain/ui.ts';

export const formInteractions: InteractionDefinition[] = [
  { schemaVersion: 1, id: 'save', event: 'submit', preventDefault: true, actions: [{ type: 'save-form', key: 'forge-form' }], description: 'Save form.', sourcePath: 'save.md' },
  { schemaVersion: 1, id: 'upload', event: 'submit', preventDefault: true, actions: [{ type: 'upload-form', url: '{{uploadUrl}}' }, { type: 'emit', event: 'upload-finished', detail: { completed: true } }], description: 'Upload form.', sourcePath: 'upload.md' },
  { schemaVersion: 1, id: 'download', event: 'click', preventDefault: true, actions: [{ type: 'download-form', filename: 'form-data.json' }], description: 'Download form.', sourcePath: 'download.md' },
];

export const formDefinition: UiDefinition = {
  schemaVersion: 1, id: 'form-actions', description: 'Portable form actions.', sourcePath: 'form-actions.md',
  props: { uploadUrl: { type: 'string', default: '/submit' } },
  root: { tag: 'section', children: [
    { tag: 'form', attrs: { 'data-form': 'save' }, interactions: ['save'], children: [
      { tag: 'input', attrs: { name: 'title', value: 'A draft' } },
      { tag: 'input', attrs: { name: 'tags', value: 'one' } },
      { tag: 'input', attrs: { name: 'tags', value: 'two' } },
      { tag: 'input', attrs: { name: 'omitted', value: 'disabled', disabled: true } },
      { tag: 'input', attrs: { type: 'checkbox', name: 'unchecked', value: 'no' } },
      { tag: 'input', attrs: { type: 'checkbox', name: 'checked', value: 'yes', checked: true } },
      { tag: 'input', attrs: { type: 'file', name: 'attachment' } },
      { tag: 'button', attrs: { type: 'button', 'data-download': true }, interactions: ['download'], children: [{ tag: 'span', text: 'Download' }] },
    ] },
    { tag: 'form', attrs: { 'data-form': 'upload' }, interactions: ['upload'], children: [
      { tag: 'input', attrs: { name: 'title', value: 'Upload this' } },
      { tag: 'input', attrs: { type: 'file', name: 'attachment' } },
    ] },
  ] },
};

/** The same acceptance scenario runs in each generated framework's real runtime. */
export const formRuntimeScenario = String.raw`
async function exerciseForms(root, browser, flush) {
  const save = root.querySelector('[data-form="save"]');
  const upload = root.querySelector('[data-form="upload"]');
  assert.ok(save); assert.ok(upload);
  const NativeFormData = browser.FormData;
  const file = new browser.File(['actual file bytes'], 'report.txt', { type: 'text/plain', lastModified: 123 });
  browser.FormData = class extends NativeFormData {
    constructor(...args) { super(...args); this.set('attachment', file); }
  };
  const readText = blob => new Promise((resolve, reject) => {
    const reader = new browser.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(blob);
  });
  const eventAfter = async (name, action) => {
    let timeout;
    const result = new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Missing ' + name)), 2000);
      root.addEventListener(name, event => resolve({ detail: event.detail, bubbles: event.bubbles, composed: event.composed }), { once: true });
    });
    try { await flush(action); return await result; } finally { clearTimeout(timeout); }
  };
  const submit = form => {
    const event = new browser.Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
  };
  const saved = await eventAfter('forge:save', () => submit(save));
  const expected = { title: 'A draft', tags: ['one', 'two'], checked: 'yes', attachment: { name: 'report.txt', size: 17, type: 'text/plain', lastModified: 123 } };
  assert.deepEqual(JSON.parse(browser.localStorage.getItem('forge-form')), expected);
  assert.deepEqual(JSON.parse(JSON.stringify(saved.detail)), { key: 'forge-form', data: expected });
  assert.equal(saved.bubbles, true); assert.equal(saved.composed, true);
  const title = save.querySelector('[name="title"]');
  title.required = true; title.value = '';
  const validationError = await eventAfter('forge:interaction-error', () => submit(save));
  assert.equal(validationError.detail.action, 'save-form');
  assert.match(validationError.detail.message, /validation/i);
  assert.deepEqual(JSON.parse(browser.localStorage.getItem('forge-form')), expected);
  title.value = 'A draft';
  const nativeSet = browser.Storage.prototype.setItem;
  browser.Storage.prototype.setItem = () => { throw new Error('Storage unavailable'); };
  const storageError = await eventAfter('forge:interaction-error', () => submit(save));
  browser.Storage.prototype.setItem = nativeSet;
  assert.deepEqual(JSON.parse(JSON.stringify(storageError.detail)), { action: 'save-form', message: 'Storage unavailable' });
  let uploaded;
  const uploadEvents = [];
  root.addEventListener('forge:upload', () => uploadEvents.push('uploaded'));
  root.addEventListener('upload-finished', () => uploadEvents.push('finished'));
  browser.fetch = async (url, options) => { uploaded = { url, options }; return { ok: true, status: 201 }; };
  const sent = await eventAfter('forge:upload', () => submit(upload));
  assert.equal(uploaded.url, 'https://example.test/submit');
  assert.equal(uploaded.options.method, 'POST');
  assert.equal(uploaded.options.headers?.['Content-Type'], undefined);
  assert.ok(uploaded.options.body instanceof NativeFormData);
  assert.equal(uploaded.options.body.get('title'), 'Upload this');
  assert.equal(await readText(uploaded.options.body.get('attachment')), 'actual file bytes');
  assert.deepEqual(JSON.parse(JSON.stringify(sent.detail)), { url: 'https://example.test/submit', status: 201, ok: true });
  assert.deepEqual(uploadEvents, ['uploaded', 'finished']);
  browser.fetch = async () => ({ ok: false, status: 422 });
  const serverError = await eventAfter('forge:interaction-error', () => submit(upload));
  assert.equal(serverError.detail.action, 'upload-form'); assert.match(serverError.detail.message, /422/);
  browser.fetch = async () => { throw new Error('Network unavailable'); };
  const networkError = await eventAfter('forge:interaction-error', () => submit(upload));
  assert.deepEqual(JSON.parse(JSON.stringify(networkError.detail)), { action: 'upload-form', message: 'Network unavailable' });
  assert.deepEqual(uploadEvents, ['uploaded', 'finished']);
  let blob, clicked;
  const revoked = [];
  browser.URL.createObjectURL = value => { blob = value; return 'blob:forge-download'; };
  browser.URL.revokeObjectURL = url => revoked.push(url);
  const nativeClick = browser.HTMLAnchorElement.prototype.click;
  browser.HTMLAnchorElement.prototype.click = function () { clicked = { download: this.download, href: this.href }; };
  const downloaded = await eventAfter('forge:download', () => root.querySelector('[data-download] span').dispatchEvent(new browser.MouseEvent('click', { bubbles: true, cancelable: true })));
  browser.HTMLAnchorElement.prototype.click = nativeClick;
  assert.deepEqual(clicked, { download: 'form-data.json', href: 'blob:forge-download' });
  assert.equal(blob.type, 'application/json');
  assert.deepEqual(JSON.parse(await readText(blob)), expected);
  assert.deepEqual(JSON.parse(JSON.stringify(downloaded.detail)), { filename: 'form-data.json', data: expected });
  assert.equal(root.querySelector('a[download]'), null);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(revoked, ['blob:forge-download']);
  browser.URL.createObjectURL = () => { throw new Error('Download unavailable'); };
  const downloadError = await eventAfter('forge:interaction-error', () => root.querySelector('[data-download]').click());
  assert.deepEqual(JSON.parse(JSON.stringify(downloadError.detail)), { action: 'download-form', message: 'Download unavailable' });
  browser.FormData = NativeFormData;
}
`;
