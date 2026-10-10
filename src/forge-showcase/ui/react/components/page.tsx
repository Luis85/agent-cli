import { createElement as _uiCreateElement, type ReactNode as _UiReactNode } from 'react';

export interface PageProps {
  children?: _UiReactNode;
}

function attribute(value: unknown): string | undefined {
  return value == null ? undefined : globalThis.String(value);
}

export default function Page(input: PageProps) {
  const props = { ...{}, ...input };

  return _uiCreateElement("div", {"className": attribute("page")}, props.children);
}
