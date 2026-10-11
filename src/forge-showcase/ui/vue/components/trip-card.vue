<script setup lang="ts">
import { reactive as _uiReactive } from 'vue';
import UiChild_0 from "./card.vue";
const props = defineProps({
  "destination": { type: String, required: false, default: "Lake Tahoe" },
  "nights": { type: Number, required: false, default: 2 },
  "title": { type: String, required: false, default: "Lakeside weekend" },
});
const _uiState = _uiReactive<{ "favorite": boolean }>({"favorite":false});
function _uiEmit(target: EventTarget | null, name: string, detail: Record<string, unknown>) {
  const element = target as Element | null;
  const EventConstructor = element?.ownerDocument.defaultView?.CustomEvent ?? globalThis.CustomEvent;
  element?.dispatchEvent(new EventConstructor(name, { detail, bubbles: true, composed: true }));
}
function _uiInteraction_toggle_favorite(_uiEvent: { currentTarget: EventTarget | null; target: EventTarget | null; key?: string; preventDefault(): void; stopPropagation(): void }) {
  const _uiNext = { ..._uiState };
  _uiNext["favorite"] = !_uiNext["favorite"];
  globalThis.Object.assign(_uiState, _uiNext);
  _uiEmit(_uiEvent.currentTarget, "trip:favorite-changed", { "favorite": _uiNext["favorite"] });
}

</script>

<template>
  <UiChild_0><h3 :class="&quot;trip-card__title&quot;">{{ props[&quot;title&quot;] }}</h3><p :class="&quot;trip-card__meta&quot;">{{ (&#39;&#39; + (props[&quot;destination&quot;] ?? &#39;&#39;)) + &quot; · &quot; + (&#39;&#39; + (props[&quot;nights&quot;] ?? &#39;&#39;)) + &quot; nights&quot; }}</p><button :aria-pressed="_uiState[&quot;favorite&quot;]" :class="&quot;trip-card__favorite&quot;" :type="&quot;button&quot;" @click="_uiInteraction_toggle_favorite($event)">{{ &quot;Favourite&quot; }}</button></UiChild_0>
</template>
