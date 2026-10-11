/** @typedef {readonly (Node | string | null | undefined)[]} DomChildren */
/** @typedef {{  }} Props */
const booleanAttributes = new Set(["allowfullscreen","async","autofocus","autoplay","checked","controls","default","defer","disabled","formnovalidate","hidden","inert","ismap","itemscope","loop","multiple","muted","nomodule","novalidate","open","playsinline","readonly","required","reversed","selected"]);
const updateProps = Symbol.for('forge.ui.updateProps');

/**
 * Create a live component; mounting and removal remain owned by the caller.
 * @param {Props} [input] @param {DomChildren} [children] @returns {HTMLElement | DocumentFragment}
 */
export default function createPage(input = {}, children = []) {
  /** @type {Props} */
  const props = { ...input };
  /** @type {Array<() => void>} */
  const updates = [];
  const refresh = () => { for (const update of updates) update(); };
  /** @param {DomChildren} children */
  function slot(children) {
    const fragment = document.createDocumentFragment();
    for (const child of children) if (child != null) fragment.append(child);
    return fragment;
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
  const result = element("div", () => ({"class": "page"}), null, [slot(children)], {});
  Object.defineProperty(result, updateProps, { configurable: true, value: (/** @type {Props} */ next) => {
    for (const key of Object.keys(props)) Reflect.deleteProperty(props, key);
    Object.assign(props, {}, next);
    refresh();
  } });
  return result;
}
