import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { z } from 'zod';
import type { FormDefinition } from '../../docs/templates/projects/form-model.js';
import { renderForm } from '../../docs/templates/projects/form-view.js';

const definition: FormDefinition<{ name: string; email: string; description: string }> = {
  id: 'contact', title: 'Contact <script>alert(1)</script>', description: 'Tell us about your project', submitLabel: 'Create',
  initialValues: { name: 'Initial', email: '', description: 'Draft' },
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true, help: 'Your project name' },
    { name: 'email', label: 'Email', type: 'email', required: true, placeholder: 'you@example.com' },
    { name: 'description', label: 'Description', type: 'textarea' },
  ],
  schema: z.object({
    name: z.string().trim().min(1, 'Name is required'),
    email: z.email('Enter a valid email'),
    description: z.string(),
  }),
};
const windows: JSDOM[] = [];
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close(); });

function mount(formDefinition = definition) {
  const dom = new JSDOM('<!doctype html><main></main>');
  windows.push(dom);
  const document = dom.window.document;
  const container = document.querySelector('main')!;
  const submit = vi.fn();
  const mounted = renderForm(formDefinition, container, submit);
  const control = (name: string) => mounted.form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;
  const send = () => mounted.form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  return { ...mounted, dom, document, container, submit, control, send };
}

describe('native form rendering', () => {
  it('rejects duplicate field names before changing the container or accepting input', () => {
    const first = mount();
    const before = first.container.innerHTML;
    const submit = vi.fn();
    const duplicate = {
      ...definition,
      fields: [...definition.fields, { name: 'name' as const, label: 'Another name', type: 'text' as const }],
    };
    expect(() => renderForm(duplicate, first.container, submit)).toThrow('Duplicate form field name: name');
    expect(first.container.innerHTML).toBe(before);
    expect(first.container.querySelectorAll('form')).toHaveLength(1);
    first.control('email').value = 'ada@example.com';
    first.send();
    expect(submit).not.toHaveBeenCalled();
    expect(first.submit).toHaveBeenCalledExactlyOnceWith({ name: 'Initial', email: 'ada@example.com', description: 'Draft' });
  });

  it('uses ownerDocument and accessible controls while treating all copy as text', () => {
    const { form, document, control } = mount();
    expect(form.ownerDocument).toBe(document);
    expect(form.querySelector('script')).toBeNull();
    expect(form.querySelector('h2')!.textContent).toBe(definition.title);
    expect(document.getElementById(form.getAttribute('aria-labelledby')!)!.textContent).toBe(definition.title);
    expect(control('name').labels![0]!.textContent).toBe('Name (required)');
    expect(control('name').required).toBe(true);
    expect(control('name').value).toBe('Initial');
    expect(document.getElementById(control('name').getAttribute('aria-describedby')!)!.textContent).toBe('Your project name');
    expect(control('email').type).toBe('email');
    expect(control('email').placeholder).toBe('you@example.com');
    expect(control('description').tagName).toBe('TEXTAREA');
  });

  it('associates errors, announces a summary, focuses first invalid, and submits only parsed data', () => {
    const { form, document, control, send, submit } = mount();
    control('name').value = '   ';
    control('email').value = 'broken';
    expect(send()).toBe(false);
    expect(submit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(control('name'));
    expect(control('name').getAttribute('aria-invalid')).toBe('true');
    const described = control('name').getAttribute('aria-describedby')!.split(' ');
    expect(described.map(id => document.getElementById(id)!.textContent)).toEqual(['Your project name', 'Name is required']);
    const summary = form.querySelector<HTMLElement>('[role="alert"]')!;
    expect(summary.hidden).toBe(false);
    expect(summary.querySelectorAll('li')).toHaveLength(2);
    expect(summary.querySelector('a')!.getAttribute('href')).toBe(`#${control('name').id}`);
    control('name').value = ' Ada ';
    control('email').value = 'ada@example.com';
    send();
    expect(submit).toHaveBeenCalledExactlyOnceWith({ name: 'Ada', email: 'ada@example.com', description: 'Draft' });
    expect(summary.hidden).toBe(true);
    expect(control('name').hasAttribute('aria-invalid')).toBe(false);
    expect(control('name').getAttribute('aria-describedby')!.split(' ')).toHaveLength(1);
    expect(control('email').hasAttribute('aria-describedby')).toBe(false);
  });

  it('reset restores initial values and removes validation state', () => {
    const { form, control, send, submit } = mount();
    control('name').value = '';
    control('description').value = 'Changed';
    send();
    form.reset();
    expect(control('name').value).toBe('Initial');
    expect(control('email').value).toBe('');
    expect(control('description').value).toBe('Draft');
    expect(form.querySelector('[aria-invalid]')).toBeNull();
    expect(form.querySelector<HTMLElement>('[role="alert"]')!.hidden).toBe(true);
    expect(submit).not.toHaveBeenCalled();
  });

  it('identifies fields in the summary when their schema messages are identical', () => {
    const generic = {
      ...definition,
      schema: z.object({ name: z.string().min(1, 'Required'), email: z.string().min(1, 'Required'), description: z.string() }),
    };
    const { form, control, send } = mount(generic);
    control('name').value = '';
    send();
    expect(Array.from(form.querySelectorAll('.forge-form-summary a'), link => link.textContent))
      .toEqual(['Name: Required', 'Email: Required']);
    expect(Array.from(form.querySelectorAll('.forge-form-error:not([hidden])'), error => error.textContent))
      .toEqual(['Required', 'Required']);
  });

  it('focuses the summary for form-wide schema issues', () => {
    const restricted = { ...definition, schema: definition.schema.refine(() => false, 'Service unavailable') };
    const { form, document, control, send, submit } = mount(restricted);
    control('email').value = 'ada@example.com';
    send();
    expect(form.querySelector('[role="alert"]')!.textContent).toContain('Service unavailable');
    expect(document.activeElement).toBe(form.querySelector('[role="alert"]'));
    expect(submit).not.toHaveBeenCalled();
  });

  it('isolates multiple mounts and removes listeners during repeatable cleanup', () => {
    const first = mount();
    const second = renderForm(definition, first.container, vi.fn());
    const ids = Array.from(first.container.querySelectorAll('[id]'), node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    first.control('email').value = 'ada@example.com';
    first.destroy();
    first.destroy();
    first.send();
    expect(first.submit).not.toHaveBeenCalled();
    expect(first.form.isConnected).toBe(false);
    expect(second.form.isConnected).toBe(true);
    second.destroy();
    expect(first.container.children).toHaveLength(0);
  });
});
