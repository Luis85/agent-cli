import UiChild_0 from "./page.js";
import UiChild_1 from "./trip-card.js";

const booleanAttributes = new Set(["allowfullscreen","async","autofocus","autoplay","checked","controls","default","defer","disabled","formnovalidate","hidden","inert","ismap","itemscope","loop","multiple","muted","nomodule","novalidate","open","playsinline","readonly","required","reversed","selected"]);
const updateProps = Symbol.for('forge.ui.updateProps');

/** Create a live component; mounting and removal remain owned by the caller. */
export default function createTripPlanner(input = {}, children = []) {
  const props = { ...{"heading":"Plan your next trip"}, ...input };
  if (props["heading"] === undefined) props["heading"] = "Plan your next trip";
  const _uiState = {"destination":"","expanded":false};
  const updates = [];
  const refresh = () => { for (const update of updates) update(); };
async function _uiFormAction(target, action, option) {
  try {
    const element = target;
    const form = element?.closest('form') ?? (element)?.form;
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
    const data = Object.create(null);
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
function _uiEmit(target, name, detail) {
  const element = target;
  const EventConstructor = element?.ownerDocument.defaultView?.CustomEvent ?? globalThis.CustomEvent;
  element?.dispatchEvent(new EventConstructor(name, { detail, bubbles: true, composed: true }));
}
function _uiInteraction_capture_destination(_uiEvent) {
  const _uiNext = { ..._uiState };
  const _uiValue0 = (_uiEvent.currentTarget)?.value;
  if (typeof _uiValue0 !== "string") throw new globalThis.TypeError("Interaction capture-destination requires event.currentTarget.value.");
  _uiNext["destination"] = _uiValue0;
  Object.assign(_uiState, _uiNext); refresh();
}
async function _uiInteraction_save_trip_draft(_uiEvent) {
  _uiEvent.preventDefault();
  const _uiTarget = _uiEvent.currentTarget;
  if (!await _uiFormAction(_uiTarget, "save-form", "trailhead-trip-draft")) return;
  _uiEmit(_uiTarget, "trip:draft-saved", {  });
}
function _uiInteraction_toggle_expanded(_uiEvent) {
  const _uiNext = { ..._uiState };
  _uiNext["expanded"] = !_uiNext["expanded"];
  Object.assign(_uiState, _uiNext); refresh();
}
  function slot(content) {
    const fragment = document.createDocumentFragment();
    for (const child of content) if (child != null) fragment.append(child);
    return fragment;
  }
  function component(factory, values, content) {
    const result = factory(values(), content);
    // Capture before a parent sharing this root attaches its own callback.
    const update = result[updateProps];
    if (update) updates.push(() => update(values()));
    return result;
  }
  function element(tag, attributes, text, content, listeners) {
    const result = document.createElement(tag);
    const previous = Object.create(null);
    const textNode = text ? document.createTextNode('') : null;
    if (textNode) result.append(textNode);
    const update = () => {
      const values = attributes();
      for (const [key, value] of Object.entries(values)) {
        const boolean = booleanAttributes.has(key.toLowerCase());
        const normalized = value == null || (boolean && value === false) ? null : boolean && value === true ? '' : String(value);
        if (Object.hasOwn(previous, key) && previous[key] === normalized) continue;
        if (normalized === null) result.removeAttribute(key); else result.setAttribute(key, normalized);
        if (key === 'value' && 'value' in result && result.value !== (normalized ?? '')) result.value = normalized ?? '';
        if (key === 'checked' && 'checked' in result) result.checked = normalized !== null;
        previous[key] = normalized;
      }
      if (textNode) {
        const value = String(text() ?? '');
        if (textNode.data !== value) textNode.data = value;
      }
    };
    result.append(...content);
    update(); updates.push(update);
    for (const [event, handlers] of Object.entries(listeners)) result.addEventListener(event, value => { for (const handler of handlers) handler(value); });
    return result;
  }
  const result = component(UiChild_0, () => ({}), [element("header", () => ({"class": "trip-planner__header"}), null, [element("h1", () => ({}), () => props["heading"], [], {}), element("p", () => ({"aria-live": "polite", "class": "trip-planner__summary"}), () => "Planning: " + ('' + (_uiState["destination"] ?? '')), [], {})], {}), element("section", () => ({"aria-label": "Upcoming trips", "class": "trip-planner__trips"}), null, [component(UiChild_1, () => ({"destination": "Lake Tahoe", "nights": 2, "title": "Lakeside weekend"}), []), component(UiChild_1, () => ({"destination": "Big Sur", "nights": 4, "title": "Coastal traverse"}), [])], {}), element("form", () => ({"aria-label": "Request a trip", "class": "trip-planner__form"}), null, [element("label", () => ({"for": "trip-destination"}), () => "Destination", [], {}), element("input", () => ({"id": "trip-destination", "name": "destination", "required": true, "type": "text", "value": _uiState["destination"]}), null, [], {"input": [_uiInteraction_capture_destination]}), element("label", () => ({"for": "trip-nights"}), () => "Nights", [], {}), element("input", () => ({"id": "trip-nights", "min": 1, "name": "nights", "type": "number"}), null, [], {}), element("button", () => ({"type": "submit"}), () => "Save draft", [], {})], {"submit": [_uiInteraction_save_trip_draft]}), element("button", () => ({"aria-expanded": _uiState["expanded"], "class": "trip-planner__tips", "type": "button"}), () => "Packing tips", [], {"click": [_uiInteraction_toggle_expanded]})]);
  Object.defineProperty(result, updateProps, { configurable: true, value: input => {
    for (const key of Object.keys(props)) delete props[key];
    Object.assign(props, {"heading":"Plan your next trip"}, input);
  if (props["heading"] === undefined) props["heading"] = "Plan your next trip";
    refresh();
  } });
  return result;
}
