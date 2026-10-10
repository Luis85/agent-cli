import { Component, Input } from '@angular/core';
import { PageComponent as UiChild_0 } from "./page";
import { TripCardComponent as UiChild_1 } from "./trip-card";

@Component({
  selector: "ui-trip-planner",
  standalone: true,
  imports: [UiChild_0, UiChild_1],
  template: "\u003cui-page>\u003cheader [attr.class]=\"&quot;trip-planner__header&quot;\">\u003ch1>{{ heading }}\u003c/h1>\u003cp [attr.aria-live]=\"&quot;polite&quot;\" [attr.class]=\"&quot;trip-planner__summary&quot;\">{{ &quot;Planning: &quot; + (&#39;&#39; + (_uiState[&quot;destination&quot;] ?? &#39;&#39;)) }}\u003c/p>\u003c/header>\u003csection [attr.aria-label]=\"&quot;Upcoming trips&quot;\" [attr.class]=\"&quot;trip-planner__trips&quot;\">\u003cui-trip-card [destination]=\"&quot;Lake Tahoe&quot;\" [nights]=\"2\" [title]=\"&quot;Lakeside weekend&quot;\">\u003c/ui-trip-card>\u003cui-trip-card [destination]=\"&quot;Big Sur&quot;\" [nights]=\"4\" [title]=\"&quot;Coastal traverse&quot;\">\u003c/ui-trip-card>\u003c/section>\u003cform [attr.aria-label]=\"&quot;Request a trip&quot;\" [attr.class]=\"&quot;trip-planner__form&quot;\" (submit)=\"_uiInteraction_save_trip_draft($event)\">\u003clabel [attr.for]=\"&quot;trip-destination&quot;\">{{ &quot;Destination&quot; }}\u003c/label>\u003cinput [attr.id]=\"&quot;trip-destination&quot;\" [attr.name]=\"&quot;destination&quot;\" [attr.required]=\"$any(true) === true ? &#39;&#39; : ($any(true) === false ? null : (true))\" [attr.type]=\"&quot;text&quot;\" [value]=\"$any(_uiState[&quot;destination&quot;]) ?? &#39;&#39;\" (input)=\"_uiInteraction_capture_destination($event)\">\u003clabel [attr.for]=\"&quot;trip-nights&quot;\">{{ &quot;Nights&quot; }}\u003c/label>\u003cinput [attr.id]=\"&quot;trip-nights&quot;\" [attr.min]=\"1\" [attr.name]=\"&quot;nights&quot;\" [attr.type]=\"&quot;number&quot;\">\u003cbutton [attr.type]=\"&quot;submit&quot;\">{{ &quot;Save draft&quot; }}\u003c/button>\u003c/form>\u003cbutton [attr.aria-expanded]=\"_uiState[&quot;expanded&quot;]\" [attr.class]=\"&quot;trip-planner__tips&quot;\" [attr.type]=\"&quot;button&quot;\" (click)=\"_uiInteraction_toggle_expanded($event)\">{{ &quot;Packing tips&quot; }}\u003c/button>\u003c/ui-page>",
})
export class TripPlannerComponent {
  @Input({ transform: (value: string | undefined) => value === undefined ? "Plan your next trip" : value }) heading: string = "Plan your next trip";
  _uiState: { "destination": string; "expanded": boolean } = {"destination":"","expanded":false};
_uiFormAction = async (target: EventTarget | null, action: string, option: unknown) => {
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
      this._uiEmit(target, 'forge:upload', { url: url.href, status: response.status, ok: true });
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
      this._uiEmit(target, 'forge:save', { key: option, data });
    } else {
      if (/[\u0000-\u001f/\\]/.test(option)) throw new globalThis.TypeError('Download filename must not contain path separators or control characters.');
      const blob = new view.Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
      const url = view.URL.createObjectURL(blob);
      const link = form.ownerDocument.createElement('a');
      link.href = url; link.download = option; link.hidden = true;
      try { form.ownerDocument.body.append(link); link.click(); }
      finally { link.remove(); view.setTimeout(() => view.URL.revokeObjectURL(url), 0); }
      this._uiEmit(target, 'forge:download', { filename: option, data });
    }
    return true;
  } catch (error) {
    this._uiEmit(target, 'forge:interaction-error', { action, message: error instanceof globalThis.Error ? error.message : String(error) });
    return false;
  }
};
_uiEmit = (target: EventTarget | null, name: string, detail: Record<string, unknown>) => {
  const element = target as Element | null;
  const EventConstructor = element?.ownerDocument.defaultView?.CustomEvent ?? globalThis.CustomEvent;
  element?.dispatchEvent(new EventConstructor(name, { detail, bubbles: true, composed: true }));
};
_uiInteraction_capture_destination = (_uiEvent: { currentTarget: EventTarget | null; target: EventTarget | null; key?: string; preventDefault(): void; stopPropagation(): void }) => {
  const _uiNext = { ...this._uiState };
  const _uiValue0 = (_uiEvent.currentTarget as { value?: unknown } | null)?.value;
  if (typeof _uiValue0 !== "string") throw new globalThis.TypeError("Interaction capture-destination requires event.currentTarget.value.");
  _uiNext["destination"] = _uiValue0;
  this._uiState = { ..._uiNext };
};
_uiInteraction_save_trip_draft = async (_uiEvent: { currentTarget: EventTarget | null; target: EventTarget | null; key?: string; preventDefault(): void; stopPropagation(): void }) => {
  _uiEvent.preventDefault();
  const _uiTarget = _uiEvent.currentTarget;
  if (!await this._uiFormAction(_uiTarget, "save-form", "trailhead-trip-draft")) return;
  this._uiEmit(_uiTarget, "trip:draft-saved", {  });
};
_uiInteraction_toggle_expanded = (_uiEvent: { currentTarget: EventTarget | null; target: EventTarget | null; key?: string; preventDefault(): void; stopPropagation(): void }) => {
  const _uiNext = { ...this._uiState };
  _uiNext["expanded"] = !_uiNext["expanded"];
  this._uiState = { ..._uiNext };
};

}
