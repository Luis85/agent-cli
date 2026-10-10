import { createElement as _uiCreateElement, type ReactNode as _UiReactNode, useState as _uiUseState, useRef as _uiUseRef } from 'react';
import UiChild_0 from "./page";
import UiChild_1 from "./trip-card";
export interface TripPlannerProps {
  "heading"?: string;
  children?: _UiReactNode;
}

const _uiControlValues = new globalThis.WeakMap<HTMLElement, Record<string, unknown>>();
function attribute(value: unknown): string | undefined {
  return value == null ? undefined : globalThis.String(value);
}

export default function TripPlanner(input: TripPlannerProps) {
  const props = { ...{"heading":"Plan your next trip"}, ...input };
  if (props["heading"] === undefined) props["heading"] = "Plan your next trip";
  const [_uiState, _uiSetState] = _uiUseState<{ "destination": string; "expanded": boolean }>(() => ({"destination":"","expanded":false}));
  const _uiStateRef = _uiUseRef(_uiState);

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
  const _uiNext = { ..._uiStateRef.current };
  const _uiValue0 = (_uiEvent.currentTarget as { value?: unknown } | null)?.value;
  if (typeof _uiValue0 !== "string") throw new globalThis.TypeError("Interaction capture-destination requires event.currentTarget.value.");
  _uiNext["destination"] = _uiValue0;
  _uiStateRef.current = { ..._uiNext }; _uiSetState(_uiStateRef.current);
}
async function _uiInteraction_save_trip_draft(_uiEvent: { currentTarget: EventTarget | null; target: EventTarget | null; key?: string; preventDefault(): void; stopPropagation(): void }) {
  _uiEvent.preventDefault();
  const _uiTarget = _uiEvent.currentTarget;
  if (!await _uiFormAction(_uiTarget, "save-form", "trailhead-trip-draft")) return;
  _uiEmit(_uiTarget, "trip:draft-saved", {  });
}
function _uiInteraction_toggle_expanded(_uiEvent: { currentTarget: EventTarget | null; target: EventTarget | null; key?: string; preventDefault(): void; stopPropagation(): void }) {
  const _uiNext = { ..._uiStateRef.current };
  _uiNext["expanded"] = !_uiNext["expanded"];
  _uiStateRef.current = { ..._uiNext }; _uiSetState(_uiStateRef.current);
}

  return _uiCreateElement(UiChild_0, {}, _uiCreateElement("header", {"className": attribute("trip-planner__header")}, _uiCreateElement("h1", {}, globalThis.String((props["heading"] ?? ''))), _uiCreateElement("p", {"aria-live": attribute("polite"), "className": attribute("trip-planner__summary")}, globalThis.String("Planning: " + ('' + (_uiState["destination"] ?? ''))))), _uiCreateElement("section", {"aria-label": attribute("Upcoming trips"), "className": attribute("trip-planner__trips")}, _uiCreateElement(UiChild_1, {"destination": "Lake Tahoe", "nights": 2, "title": "Lakeside weekend"}), _uiCreateElement(UiChild_1, {"destination": "Big Sur", "nights": 4, "title": "Coastal traverse"})), _uiCreateElement("form", {"aria-label": attribute("Request a trip"), "className": attribute("trip-planner__form"), ref: (() => { let cleanup: (() => void) | undefined; return (element: HTMLElement | null): void => { cleanup?.(); cleanup = undefined; if (!element) return;  const _uiListener0 = (event: Event) => { _uiInteraction_save_trip_draft(event); }; element.addEventListener("submit", _uiListener0); cleanup = () => { element.removeEventListener("submit", _uiListener0); }; }; })()}, _uiCreateElement("label", {"htmlFor": attribute("trip-destination")}, globalThis.String("Destination")), _uiCreateElement("input", {"id": attribute("trip-destination"), "name": attribute("destination"), "required": true, "type": attribute("text"), defaultValue: globalThis.String((_uiState["destination"] ?? '')), ref: (() => { let cleanup: (() => void) | undefined; return (element: HTMLElement | null): void => { cleanup?.(); cleanup = undefined; if (!element) return; const previous = _uiControlValues.get(element) ?? {}; if (!globalThis.Object.hasOwn(previous, "value") || previous["value"] !== globalThis.String((_uiState["destination"] ?? ''))) (element as HTMLInputElement).value = globalThis.String((_uiState["destination"] ?? '')); previous["value"] = globalThis.String((_uiState["destination"] ?? '')); _uiControlValues.set(element, previous); const _uiListener0 = (event: Event) => { _uiInteraction_capture_destination(event); }; element.addEventListener("input", _uiListener0); cleanup = () => { element.removeEventListener("input", _uiListener0); }; }; })()}), _uiCreateElement("label", {"htmlFor": attribute("trip-nights")}, globalThis.String("Nights")), _uiCreateElement("input", {"id": attribute("trip-nights"), "min": attribute(1), "name": attribute("nights"), "type": attribute("number")}), _uiCreateElement("button", {"type": attribute("submit")}, globalThis.String("Save draft"))), _uiCreateElement("button", {"aria-expanded": attribute(_uiState["expanded"]), "className": attribute("trip-planner__tips"), "type": attribute("button"), ref: (() => { let cleanup: (() => void) | undefined; return (element: HTMLElement | null): void => { cleanup?.(); cleanup = undefined; if (!element) return;  const _uiListener0 = (event: Event) => { _uiInteraction_toggle_expanded(event); }; element.addEventListener("click", _uiListener0); cleanup = () => { element.removeEventListener("click", _uiListener0); }; }; })()}, globalThis.String("Packing tips")));
}
