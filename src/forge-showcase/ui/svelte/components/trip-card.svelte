<script lang="ts">
  import UiChild_0 from "./card.svelte";
  let _uiProp0: string = "Lake Tahoe";
  export { _uiProp0 as destination };
  let _uiProp1: number = 2;
  export { _uiProp1 as nights };
  let _uiProp2: string = "Lakeside weekend";
  export { _uiProp2 as title };
  $: _uiProps = {"destination": _uiProp0, "nights": _uiProp1, "title": _uiProp2};
  let _uiState: { "favorite": boolean } = {"favorite":false};
function _uiEmit(target: EventTarget | null, name: string, detail: Record<string, unknown>) {
  const element = target as Element | null;
  const EventConstructor = element?.ownerDocument.defaultView?.CustomEvent ?? globalThis.CustomEvent;
  element?.dispatchEvent(new EventConstructor(name, { detail, bubbles: true, composed: true }));
}
function _uiInteraction_toggle_favorite(_uiEvent: { currentTarget: EventTarget | null; target: EventTarget | null; key?: string; preventDefault(): void; stopPropagation(): void }) {
  const _uiNext = { ..._uiState };
  _uiNext["favorite"] = !_uiNext["favorite"];
  _uiState = { ..._uiNext };
  _uiEmit(_uiEvent.currentTarget, "trip:favorite-changed", { "favorite": _uiNext["favorite"] });
}

</script>

<UiChild_0><h3 class={"trip-card__title"}>{(_uiProps["title"] ?? '')}</h3><p class={"trip-card__meta"}>{('' + (_uiProps["destination"] ?? '')) + " · " + ('' + (_uiProps["nights"] ?? '')) + " nights"}</p><button aria-pressed={_uiState["favorite"]} class={"trip-card__favorite"} type={"button"} on:click={(event) => { _uiInteraction_toggle_favorite(event); }}>{"Favourite"}</button></UiChild_0>
