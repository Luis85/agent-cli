import type { UiDefinition, UiNode, UiProp, UiValue } from '../domain/ui.ts';

const slot: UiNode = { slot: 'children' };
const container = (id: string, tag = id, attrs?: Record<string, UiValue>): UiDefinition => ({ schemaVersion: 1, id, sourcePath: `${id}.md`, description: `# ${id}\n\nSemantic ${tag} boilerplate. Supply child content and application behavior in your project.\n`, props: {}, root: { tag, ...(attrs ? { attrs } : {}), children: [slot] } });
const element = (id: string, tag: string, props: Record<string, UiProp>, attrs: Record<string, UiValue>, text?: string): UiDefinition => ({ ...container(id, tag), props, root: { tag, attrs, ...(text !== undefined ? { text } : {}) } });
const string = (value: string): UiProp => ({ type: 'string', default: value });

/** Native elements and composition primitives; interactive behavior is project-owned. */
export const standardUiCatalog: readonly UiDefinition[] = [
  ...['header', 'footer', 'main', 'section', 'article', 'aside', 'form', 'fieldset', 'legend', 'label', 'select', 'option', 'figure', 'figcaption', 'dialog', 'details', 'summary', 'table', 'caption', 'pre', 'code', 'strong', 'em', 'small', 'blockquote', 'address', 'video', 'audio'].map(tag => container(tag)),
  container('page', 'div', { class: 'page' }), container('layout', 'div', { class: 'layout' }),
  container('container', 'div', { class: 'container' }), container('stack', 'div', { class: 'stack' }),
  container('grid', 'div', { class: 'grid' }), container('card', 'article', { class: 'card' }),
  container('breadcrumbs', 'nav', { 'aria-label': 'Breadcrumb' }), container('pagination', 'nav', { 'aria-label': 'Pagination' }),
  container('alert', 'div', { role: 'alert' }), container('status', 'div', { role: 'status' }),
  container('badge', 'span', { class: 'badge' }), container('modal', 'dialog', { 'aria-label': 'Dialog' }),
  container('accordion', 'details'), container('toolbar', 'div', { role: 'toolbar', 'aria-label': 'Actions' }),
  container('search', 'form', { role: 'search', 'aria-label': 'Site search' }),
  element('avatar', 'img', { src: string('avatar.png'), alt: string('Profile picture') }, { src: '{{src}}', alt: '{{alt}}', class: 'avatar' }),
  container('nav-bar', 'nav', { 'aria-label': 'Main navigation' }), container('list', 'ul'),
  container('ordered-list', 'ol'), container('list-item', 'li'), container('table-head', 'thead'),
  container('table-body', 'tbody'), container('table-foot', 'tfoot'), container('table-row', 'tr'),
  container('table-cell', 'td'), container('table-header', 'th', { scope: 'col' }),
  container('description-list', 'dl'), container('description-term', 'dt'), container('description-details', 'dd'),
  element('heading', 'h2', { text: string('Heading') }, {}, '{{text}}'),
  element('paragraph', 'p', { text: string('Paragraph') }, {}, '{{text}}'),
  element('button', 'button', { label: string('Button'), disabled: { type: 'boolean', default: false } }, { type: 'button', disabled: '{{disabled}}' }, '{{label}}'),
  element('link', 'a', { href: string('#'), label: string('Link') }, { href: '{{href}}' }, '{{label}}'),
  element('input', 'input', { name: string('field'), value: string('') }, { type: 'text', name: '{{name}}', value: '{{value}}' }),
  element('textarea', 'textarea', { name: string('message') }, { name: '{{name}}' }),
  element('checkbox', 'input', { name: string('choice'), checked: { type: 'boolean', default: false } }, { type: 'checkbox', name: '{{name}}', checked: '{{checked}}' }),
  element('radio', 'input', { name: string('choice'), value: string('option'), checked: { type: 'boolean', default: false } }, { type: 'radio', name: '{{name}}', value: '{{value}}', checked: '{{checked}}' }),
  element('image', 'img', { src: string('image.png'), alt: string('') }, { src: '{{src}}', alt: '{{alt}}' }),
  element('progress', 'progress', { value: { type: 'number', default: 0 }, max: { type: 'number', default: 100 } }, { value: '{{value}}', max: '{{max}}', 'aria-label': 'Progress' }),
  element('meter', 'meter', { value: { type: 'number', default: 0 }, max: { type: 'number', default: 100 } }, { value: '{{value}}', max: '{{max}}', 'aria-label': 'Measurement' }),
  element('separator', 'hr', {}, {}), element('line-break', 'br', {}, {}),
  element('output', 'output', { text: string('Result') }, {}, '{{text}}'),
  element('time', 'time', { datetime: string('2026-01-01'), label: string('Date') }, { datetime: '{{datetime}}' }, '{{label}}'),
].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
