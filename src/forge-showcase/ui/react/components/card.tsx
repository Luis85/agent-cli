import { createElement as _uiCreateElement, type ReactNode as _UiReactNode } from 'react';

export interface CardProps {
  children?: _UiReactNode;
}

function attribute(value: unknown): string | undefined {
  return value == null ? undefined : globalThis.String(value);
}

export default function Card(input: CardProps) {
  const props = { ...{}, ...input };

  return _uiCreateElement("article", {"className": attribute("card")}, props.children);
}
