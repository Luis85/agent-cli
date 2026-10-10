import { createElement as _uiCreateElement, type ReactNode as _UiReactNode, useState as _uiUseState, useRef as _uiUseRef } from 'react';
import UiChild_0 from "./card";
export interface TripCardProps {
  "destination"?: string;
  "nights"?: number;
  "title"?: string;
  children?: _UiReactNode;
}

function attribute(value: unknown): string | undefined {
  return value == null ? undefined : globalThis.String(value);
}

export default function TripCard(input: TripCardProps) {
  const props = { ...{"destination":"Lake Tahoe","nights":2,"title":"Lakeside weekend"}, ...input };
  if (props["destination"] === undefined) props["destination"] = "Lake Tahoe";
  if (props["nights"] === undefined) props["nights"] = 2;
  if (props["title"] === undefined) props["title"] = "Lakeside weekend";
  const [_uiState, _uiSetState] = _uiUseState<{ "favorite": boolean }>(() => ({"favorite":false}));
  const _uiStateRef = _uiUseRef(_uiState);

function _uiEmit(target: EventTarget | null, name: string, detail: Record<string, unknown>) {
  const element = target as Element | null;
  const EventConstructor = element?.ownerDocument.defaultView?.CustomEvent ?? globalThis.CustomEvent;
  element?.dispatchEvent(new EventConstructor(name, { detail, bubbles: true, composed: true }));
}
function _uiInteraction_toggle_favorite(_uiEvent: { currentTarget: EventTarget | null; target: EventTarget | null; key?: string; preventDefault(): void; stopPropagation(): void }) {
  const _uiNext = { ..._uiStateRef.current };
  _uiNext["favorite"] = !_uiNext["favorite"];
  _uiStateRef.current = { ..._uiNext }; _uiSetState(_uiStateRef.current);
  _uiEmit(_uiEvent.currentTarget, "trip:favorite-changed", { "favorite": _uiNext["favorite"] });
}

  return _uiCreateElement(UiChild_0, {}, _uiCreateElement("h3", {"className": attribute("trip-card__title")}, globalThis.String((props["title"] ?? ''))), _uiCreateElement("p", {"className": attribute("trip-card__meta")}, globalThis.String(('' + (props["destination"] ?? '')) + " · " + ('' + (props["nights"] ?? '')) + " nights")), _uiCreateElement("button", {"aria-pressed": attribute(_uiState["favorite"]), "className": attribute("trip-card__favorite"), "type": attribute("button"), ref: (() => { let cleanup: (() => void) | undefined; return (element: HTMLElement | null): void => { cleanup?.(); cleanup = undefined; if (!element) return;  const _uiListener0 = (event: Event) => { _uiInteraction_toggle_favorite(event); }; element.addEventListener("click", _uiListener0); cleanup = () => { element.removeEventListener("click", _uiListener0); }; }; })()}, globalThis.String("Favourite")));
}
