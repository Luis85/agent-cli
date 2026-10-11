const booleanAttributes = new Set(["allowfullscreen","async","autofocus","autoplay","checked","controls","default","defer","disabled","formnovalidate","hidden","inert","ismap","itemscope","loop","multiple","muted","nomodule","novalidate","open","playsinline","readonly","required","reversed","selected"]);
const updateProps = Symbol.for('forge.ui.updateProps');

/** Create a live component; mounting and removal remain owned by the caller. */
export default function createCard(input = {}, children = []) {
  const props = { ...{}, ...input };

  const _uiState = {};
  const updates = [];
  const refresh = () => { for (const update of updates) update(); };

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
  const result = element("article", () => ({"class": "card"}), null, [slot(children)], {});
  Object.defineProperty(result, updateProps, { configurable: true, value: input => {
    for (const key of Object.keys(props)) delete props[key];
    Object.assign(props, {}, input);

    refresh();
  } });
  return result;
}
