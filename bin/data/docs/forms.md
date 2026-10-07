# Typed forms and HTML preview

Managed projects include a framework-independent form model, Zod validation and a native HTML renderer. A single TypeScript definition supplies field names, labels, input types, initial values and the validation schema. The starter's `src/presentation/forms/project-details.form.ts` exports `ProjectDetailsForm` and `ProjectDetailsValues` and demonstrates the complete path from definition to rendered HTML and validated submission.

## Generate and preview

Run Forge commands from the workspace containing `bin/app.js`:

```sh
node bin/app.js project open knowledge-core
node bin/app.js make form Contact --dry-run
node bin/app.js make form Contact
```

`make form` requires an open Forge project with the form runtime. It creates:

- `src/presentation/forms/contact.form.ts`, exporting `ContactForm` and `ContactValues`.
- `tests/contact.form.unit.test.ts`, covering valid normalization and invalid input.

Names use PascalCase. Files are created together through the normal guarded write plan; existing destinations are not overwritten. `--out` changes the definition directory relative to the selected project; the test stays under `tests`.

Start the project preview from the project directory:

```sh
cd projects/knowledge-core
npm install # first installation; commit the lockfile, then use npm ci
npm run dev
```

Open the local URL printed by Vite. The showcase renders real HTML from the selected definition. Its selector discovers `*.form.ts` files under `src/presentation/forms`, including subdirectories, so a newly generated default form appears alongside the starter. A custom `--out` outside that tree requires an explicit import and mounting it in your application. `npm run build` produces the library, declarations and the preview in `demo-dist`. Run `npm run preview` to serve that built showcase locally. `npm run check` also runs all quality gates and tests.

The generated name/email/description fields and their messages are editable examples. Replace them with the required fields, rules and acceptance tests for your domain before shipping.

## Definition and validation

The shared types and validator live in `src/presentation/forms/form-model.ts`. The starter exports the model, validator, renderer and sample definition through its public library entry point; generated forms remain internal until you intentionally export them. `FormDefinition<T>` contains `id`, `title`, optional `description`, `submitLabel`, `initialValues`, `fields` and a Zod `schema`. Supported field types are `text`, `email` and `textarea`; fields can provide `required`, `help` and `placeholder`. This baseline uses flat, string-valued field data.

Validation works independently of the DOM:

```ts
import { ContactForm } from './forms/contact.form.js';
import { validateForm } from './forms/form-model.js';

const result = validateForm(ContactForm, {
  name: '  Ada  ',
  email: 'ada@example.com',
  description: '',
});

if (result.success) {
  console.log(result.data); // typed, normalized values
} else {
  console.log(result.errors); // { field: string, message: string }[]
}
```

The schema is authoritative. In the example it trims inputs, requires name and email, limits lengths and rejects unknown keys. Field labels and HTML `required` hints do not replace those rules. Keep schema keys, fields and initial values consistent; the TypeScript gate checks the definition and its tests.

## Render the same definition

The renderer lives in `src/presentation/forms/form-view.ts`:

```ts
import { ContactForm } from './forms/contact.form.js';
import { renderForm } from './forms/form-view.js';

const container = document.querySelector<HTMLElement>('#app');
if (!container) throw new Error('Missing form container');

const mounted = renderForm(ContactForm, container, values => {
  console.log('Validated submission', values);
});

// When the host view is removed or replaced:
// mounted.destroy();
```

`renderForm(definition, container, onSubmit)` returns `{ form, destroy }`. It creates native labels and controls, displays linked validation errors, focuses invalid input, and restores initial values on reset. Definition text is inserted as text. Successful validation passes typed data to the synchronous callback; the renderer performs no network request or persistence. Connect application use cases through that callback and call `destroy()` when replacing the mounted view.

Keep form models and browser rendering in presentation. Domain invariants still belong in domain code and application use cases depend on injected ports. Cover schema behavior with unit tests, DOM interactions with integration tests, and the complete showcase path with end-to-end checks. Finish with the selected project's `npm run check`; see the [development feedback loop](development.md#agent-feedback-loop).
