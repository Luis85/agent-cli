<script lang="ts">
  import UiChild_0 from "./page.svelte";
  import UiChild_1 from "./trip-card.svelte";
  let _uiProp0: string = "Plan your next trip";
  export { _uiProp0 as heading };
  $: _uiProps = {"heading": _uiProp0};
  let _uiState: { "destination": string; "expanded": boolean } = {"destination":"","expanded":false};
async function _uiFormAction(target: EventTarget | null, action: string, option: unknown) {
  try {
    const element = target as HTMLElement | null;
    const form = element?.closest('form') ?? (element as HTMLButtonElement | null)?.form;
    if (!form || form.tagName !== 'FORM') throw new globalThis.TypeError('Form interaction requires an associated form.');
    const view = form.ownerDocument.defaultView;
    if (!view) throw new globalThis.TypeError('Form interaction requires a browser window.');
    if (typeof option !== 'string' || !option.trim()) throw new globalThis.TypeError('Form interaction requires a nonempty string option.');
    if (!form.reportValidity()) throw new globalThis.TypeError('Form validation failed.');
    const fields = new view.FormData(form);
    if (action === 'upload-form') {
      if (option !== option.trim() || /[\u0000-\u001f\\]/.test(option) || option.startsWith('//') || (/^[a-z][a-z0-9+.-]*:/i.test(option) && !/^https?:\/\//i.test(option))) throw new globalThis.TypeError('Unsafe interaction upload URL.');
      const url = new view.URL(option, form.ownerDocument.baseURI);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new globalThis.TypeError('Unsafe interaction upload URL.');
      const response = await view.fetch(url.href, { method: 'POST', body: fields, credentials: 'same-origin' });
      if (!response.ok) throw new globalThis.Error('Upload failed with HTTP ' + response.status + '.');
      _uiEmit(target, 'forge:upload', { url: url.href, status: response.status, ok: true });
      return true;
    }
    const data: Record<string, unknown> = Object.create(null);
    for (const [name, field] of fields.entries()) {
      const value = typeof field === 'string' ? field : { name: field.name, size: field.size, type: field.type, lastModified: field.lastModified };
      if (!Object.hasOwn(data, name)) data[name] = value;
      else { const previous = data[name]; data[name] = Array.isArray(previous) ? [...previous, value] : [previous, value]; }
    }
    if (action === 'save-form') {
      view.localStorage.setItem(option, JSON.stringify(data));
      _uiEmit(target, 'forge:save', { key: option, data });
    } else {
      if (/[\u0000-\u001f/\\]/.test(option)) throw new globalThis.TypeError('Download filename must not contain path separators or control characters.');
      const blob = new view.Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
      const url = view.URL.createObjectURL(blob);
      const link = form.ownerDocument.createElement('a');
      link.href = url; link.download = option; link.hidden = true;
      try { form.ownerDocument.body.append(link); link.click(); }
      finally { link.remove(); view.setTimeout(() => view.URL.revokeObjectURL(url), 0); }
      _uiEmit(target, 'forge:download', { filename: option, data });
    }
    return true;
  } catch (error) {
    _uiEmit(target, 'forge:interaction-error', { action, message: error instanceof globalThis.Error ? error.message : String(error) });
    return false;
  }
}
function _uiEmit(target: EventTarget | null, name: string, detail: Record<string, unknown>) {
  const element = target as Element | null;
  const EventConstructor = element?.ownerDocument.defaultView?.CustomEvent ?? globalThis.CustomEvent;
  element?.dispatchEvent(new EventConstructor(name, { detail, bubbles: true, composed: true }));
}
function _uiInteraction_capture_destination(_uiEvent: { currentTarget: EventTarget | null; target: EventTarget | null; key?: string; preventDefault(): void; stopPropagation(): void }) {
  const _uiNext = { ..._uiState };
  const _uiValue0 = (_uiEvent.currentTarget as { value?: unknown } | null)?.value;
  if (typeof _uiValue0 !== "string") throw new globalThis.TypeError("Interaction capture-destination requires event.currentTarget.value.");
  _uiNext["destination"] = _uiValue0;
  _uiState = { ..._uiNext };
}
async function _uiInteraction_save_trip_draft(_uiEvent: { currentTarget: EventTarget | null; target: EventTarget | null; key?: string; preventDefault(): void; stopPropagation(): void }) {
  _uiEvent.preventDefault();
  const _uiTarget = _uiEvent.currentTarget;
  if (!await _uiFormAction(_uiTarget, "save-form", "trailhead-trip-draft")) return;
  _uiEmit(_uiTarget, "trip:draft-saved", {  });
}
function _uiInteraction_toggle_expanded(_uiEvent: { currentTarget: EventTarget | null; target: EventTarget | null; key?: string; preventDefault(): void; stopPropagation(): void }) {
  const _uiNext = { ..._uiState };
  _uiNext["expanded"] = !_uiNext["expanded"];
  _uiState = { ..._uiNext };
}

</script>

<UiChild_0><header class={"trip-planner__header"}><h1>{(_uiProps["heading"] ?? '')}</h1><p aria-live={"polite"} class={"trip-planner__summary"}>{"Planning: " + ('' + (_uiState["destination"] ?? ''))}</p></header><section aria-label={"Upcoming trips"} class={"trip-planner__trips"}><UiChild_1 destination={"Lake Tahoe"} nights={2} title={"Lakeside weekend"}></UiChild_1><UiChild_1 destination={"Big Sur"} nights={4} title={"Coastal traverse"}></UiChild_1></section><form aria-label={"Request a trip"} class={"trip-planner__form"} on:submit={(event) => { _uiInteraction_save_trip_draft(event); }}><label for={"trip-destination"}>{"Destination"}</label><input id={"trip-destination"} name={"destination"} required={true} type={"text"} value={_uiState["destination"]} on:input={(event) => { _uiInteraction_capture_destination(event); }}><label for={"trip-nights"}>{"Nights"}</label><input id={"trip-nights"} min={1} name={"nights"} type={"number"}><button type={"submit"}>{"Save draft"}</button></form><button aria-expanded={_uiState["expanded"]} class={"trip-planner__tips"} type={"button"} on:click={(event) => { _uiInteraction_toggle_expanded(event); }}>{"Packing tips"}</button></UiChild_0>
