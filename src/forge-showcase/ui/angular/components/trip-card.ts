import { Component, Input } from '@angular/core';
import { CardComponent as UiChild_0 } from "./card";

@Component({
  selector: "ui-trip-card",
  standalone: true,
  imports: [UiChild_0],
  template: "\u003cui-card>\u003ch3 [attr.class]=\"&quot;trip-card__title&quot;\">{{ title }}\u003c/h3>\u003cp [attr.class]=\"&quot;trip-card__meta&quot;\">{{ (&#39;&#39; + (destination ?? &#39;&#39;)) + &quot; · &quot; + (&#39;&#39; + (nights ?? &#39;&#39;)) + &quot; nights&quot; }}\u003c/p>\u003cbutton [attr.aria-pressed]=\"_uiState[&quot;favorite&quot;]\" [attr.class]=\"&quot;trip-card__favorite&quot;\" [attr.type]=\"&quot;button&quot;\" (click)=\"_uiInteraction_toggle_favorite($event)\">{{ &quot;Favourite&quot; }}\u003c/button>\u003c/ui-card>",
})
export class TripCardComponent {
  @Input({ transform: (value: string | undefined) => value === undefined ? "Lake Tahoe" : value }) destination: string = "Lake Tahoe";
  @Input({ transform: (value: number | undefined) => value === undefined ? 2 : value }) nights: number = 2;
  @Input({ transform: (value: string | undefined) => value === undefined ? "Lakeside weekend" : value }) title: string = "Lakeside weekend";
  _uiState: { "favorite": boolean } = {"favorite":false};
_uiEmit = (target: EventTarget | null, name: string, detail: Record<string, unknown>) => {
  const element = target as Element | null;
  const EventConstructor = element?.ownerDocument.defaultView?.CustomEvent ?? globalThis.CustomEvent;
  element?.dispatchEvent(new EventConstructor(name, { detail, bubbles: true, composed: true }));
};
_uiInteraction_toggle_favorite = (_uiEvent: { currentTarget: EventTarget | null; target: EventTarget | null; key?: string; preventDefault(): void; stopPropagation(): void }) => {
  const _uiNext = { ...this._uiState };
  _uiNext["favorite"] = !_uiNext["favorite"];
  this._uiState = { ..._uiNext };
  this._uiEmit(_uiEvent.currentTarget, "trip:favorite-changed", { "favorite": _uiNext["favorite"] });
};

}
