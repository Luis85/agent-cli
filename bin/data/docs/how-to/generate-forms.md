# Generate and preview a form

[Documentation](../index.md) · How-to guide

Create a typed form in an existing Forge project and inspect its HTML preview. For the model and renderer API, see [form contracts](../reference/forms.md).


Run Forge commands from the workspace containing `bin/forge.js`:

```sh
node bin/forge.js project open knowledge-core
node bin/forge.js make form Contact --dry-run
node bin/forge.js make form Contact
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
