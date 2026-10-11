import UiChild_0 from "./card.js";

/** @typedef {readonly (Node | string | null | undefined)[]} DomChildren */
/** @typedef {{ "destination"?: string; "nights"?: number; "title"?: string }} Props */
const booleanAttributes = new Set(["allowfullscreen","async","autofocus","autoplay","checked","controls","default","defer","disabled","formnovalidate","hidden","inert","ismap","itemscope","loop","multiple","muted","nomodule","novalidate","open","playsinline","readonly","required","reversed","selected"]);
const updateProps = Symbol.for('forge.ui.updateProps');

/**
 * Create a live component; mounting and removal remain owned by the caller.
 * @param {Props} [input] @param {DomChildren} [_children] @returns {HTMLElement | DocumentFragment}
 */
export default function createTripCard(input = {}, _children = []) {
  /** @type {Props} */
  const props = { "destination": "Lake Tahoe", "nights": 2, "title": "Lakeside weekend", ...input };
  if (props["destination"] === undefined) props["destination"] = "Lake Tahoe";
  if (props["nights"] === undefined) props["nights"] = 2;
  if (props["title"] === undefined) props["title"] = "Lakeside weekend";
  /** @type {{ "favorite": boolean }} */
  const _uiState = {"favorite":false};
  /** @type {Array<() => void>} */
  const updates = [];
  const refresh = () => { for (const update of updates) update(); };
/** @param {EventTarget | null} target @param {string} name @param {Record<string, unknown>} detail */
function _uiEmit(target, name, detail) {
  const element = /** @type {Element | null} */ (target);
  const EventConstructor = element?.ownerDocument.defaultView?.CustomEvent ?? globalThis.CustomEvent;
  element?.dispatchEvent(new EventConstructor(name, { detail, bubbles: true, composed: true }));
}
/** @param {{ currentTarget: EventTarget | null; target: EventTarget | null; key?: string; preventDefault(): void; stopPropagation(): void }} _uiEvent */
function _uiInteraction_toggle_favorite(_uiEvent) {
  const _uiNext = { ..._uiState };
  _uiNext["favorite"] = !_uiNext["favorite"];
  Object.assign(_uiState, _uiNext); refresh();
  _uiEmit(_uiEvent.currentTarget, "trip:favorite-changed", { "favorite": _uiNext["favorite"] });
}
  /**
   * @template P
   * @param {(input: P, children: DomChildren) => HTMLElement | DocumentFragment} factory @param {() => P} values @param {DomChildren} content
   */
  function component(factory, values, content) {
    const result = factory(values(), content);
    // Capture before a parent sharing this root attaches its own callback.
    /** @type {((values: P) => void) | undefined} */
    const update = Reflect.get(result, updateProps);
    if (update) updates.push(() => update(values()));
    return result;
  }
  /**
   * @param {string} tag @param {() => Record<string, unknown>} attributes @param {(() => unknown) | null} text
   * @param {readonly Node[]} content @param {Record<string, Array<(event: Event) => unknown>>} listeners
   */
  function element(tag, attributes, text, content, listeners) {
    const result = document.createElement(tag);
    /** @type {Record<string, string | null>} */
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
        const value = String(text?.() ?? '');
        if (textNode.data !== value) textNode.data = value;
      }
    };
    result.append(...content);
    update(); updates.push(update);
    for (const [event, handlers] of Object.entries(listeners)) result.addEventListener(event, value => { for (const handler of handlers) handler(value); });
    return result;
  }
  const result = component(UiChild_0, () => ({}), [element("h3", () => ({"class": "trip-card__title"}), () => props["title"], [], {}), element("p", () => ({"class": "trip-card__meta"}), () => ('' + (props["destination"] ?? '')) + " · " + ('' + (props["nights"] ?? '')) + " nights", [], {}), element("button", () => ({"aria-pressed": _uiState["favorite"], "class": "trip-card__favorite", "type": "button"}), () => "Favourite", [], {"click": [_uiInteraction_toggle_favorite]})]);
  Object.defineProperty(result, updateProps, { configurable: true, value: (/** @type {Props} */ next) => {
    for (const key of Object.keys(props)) Reflect.deleteProperty(props, key);
    Object.assign(props, {"destination":"Lake Tahoe","nights":2,"title":"Lakeside weekend"}, next);
  if (props["destination"] === undefined) props["destination"] = "Lake Tahoe";
  if (props["nights"] === undefined) props["nights"] = 2;
  if (props["title"] === undefined) props["title"] = "Lakeside weekend";
    refresh();
  } });
  return result;
}
