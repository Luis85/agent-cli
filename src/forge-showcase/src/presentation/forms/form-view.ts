import { validateForm, type FormDefinition } from './form-model.js';

let nextFormId = 0;

interface FieldControl {
  input: HTMLInputElement | HTMLTextAreaElement;
  label: string;
  error: HTMLElement;
  helpId?: string;
}

/** Mount an accessible native form without interpreting any definition text as HTML. */
export function renderForm<T extends Record<string, string>>(
  definition: FormDefinition<T>,
  container: HTMLElement,
  onSubmit: (data: T) => void,
): { form: HTMLFormElement; destroy(): void } {
  const fieldNames = new Set<string>();
  for (const field of definition.fields) {
    if (fieldNames.has(field.name)) throw new Error(`Duplicate form field name: ${field.name}`);
    fieldNames.add(field.name);
  }
  const document = container.ownerDocument;
  let prefix: string;
  do { prefix = `forge-form-${++nextFormId}`; } while (document.getElementById(prefix));
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const form = element('form');
  form.id = prefix;
  form.className = 'forge-form';
  form.dataset.formId = definition.id;
  // Use one schema-driven error path even when browser constraint validation differs.
  form.noValidate = true;
  const title = element('h2', definition.title);
  title.id = `${prefix}-title`;
  form.setAttribute('aria-labelledby', title.id);
  form.append(title);
  if (definition.description) {
    const description = element('p', definition.description);
    description.id = `${prefix}-description`;
    form.setAttribute('aria-describedby', description.id);
    form.append(description);
  }
  const summary = element('div');
  summary.className = 'forge-form-summary';
  summary.setAttribute('role', 'alert');
  summary.tabIndex = -1;
  summary.hidden = true;
  form.append(summary);
  const controls = new Map<string, FieldControl>();
  const defaults = { ...definition.initialValues };
  for (const [index, field] of definition.fields.entries()) {
    const group = element('div');
    group.className = 'forge-form-field';
    const input = field.type === 'textarea' ? element('textarea') : element('input');
    if (input.tagName === 'INPUT') (input as HTMLInputElement).type = field.type;
    input.name = field.name;
    input.id = `${prefix}-field-${index}`;
    input.required = field.required ?? false;
    input.value = defaults[field.name] ?? '';
    input.defaultValue = input.value;
    if (field.placeholder) input.placeholder = field.placeholder;
    const label = element('label', `${field.label}${field.required ? ' (required)' : ''}`);
    label.htmlFor = input.id;
    group.append(label, input);
    let helpId: string | undefined;
    if (field.help) {
      const help = element('p', field.help);
      help.className = 'forge-form-help';
      help.id = `${input.id}-help`;
      helpId = help.id;
      input.setAttribute('aria-describedby', helpId);
      group.append(help);
    }
    const error = element('p');
    error.id = `${input.id}-error`;
    error.className = 'forge-form-error';
    error.hidden = true;
    group.append(error);
    controls.set(field.name, { input, label: field.label, error, helpId });
    form.append(group);
  }
  const actions = element('div');
  actions.className = 'forge-form-actions';
  const submit = element('button', definition.submitLabel);
  submit.type = 'submit';
  const reset = element('button', 'Reset');
  reset.type = 'reset';
  actions.append(submit, reset);
  form.append(actions);

  const clearErrors = () => {
    summary.replaceChildren();
    summary.hidden = true;
    for (const { input, error, helpId } of controls.values()) {
      input.removeAttribute('aria-invalid');
      error.textContent = '';
      error.hidden = true;
      if (helpId) input.setAttribute('aria-describedby', helpId);
      else input.removeAttribute('aria-describedby');
    }
  };
  const handleSubmit = (event: Event) => {
    event.preventDefault();
    clearErrors();
    const values = Object.fromEntries(Array.from(controls, ([name, { input }]) => [name, input.value]));
    const result = validateForm(definition, values);
    if (result.success) {
      onSubmit(result.data);
      return;
    }
    summary.append(element('p', 'Please correct the following errors:'));
    const list = element('ul');
    for (const issue of result.errors) {
      const control = controls.get(issue.field);
      const item = element('li');
      if (control) {
        const link = element('a', `${control.label}: ${issue.message}`);
        link.href = `#${control.input.id}`;
        item.append(link);
        control.input.setAttribute('aria-invalid', 'true');
        control.error.textContent = [control.error.textContent, issue.message].filter(Boolean).join(' ');
        control.error.hidden = false;
        control.input.setAttribute('aria-describedby', [control.helpId, control.error.id].filter(Boolean).join(' '));
      } else item.textContent = issue.message;
      list.append(item);
    }
    summary.append(list);
    summary.hidden = false;
    const invalid = Array.from(controls.values()).find(({ input }) => input.getAttribute('aria-invalid') === 'true');
    (invalid?.input ?? summary).focus();
  };
  const handleReset = (event: Event) => {
    event.preventDefault();
    for (const [name, { input }] of controls) input.value = defaults[name] ?? '';
    clearErrors();
  };
  form.addEventListener('submit', handleSubmit);
  form.addEventListener('reset', handleReset);
  container.append(form);
  return {
    form,
    destroy() {
      form.removeEventListener('submit', handleSubmit);
      form.removeEventListener('reset', handleReset);
      form.remove();
    },
  };
}
