# Build an interactive form from Markdown

[Documentation](../index.md) · Tutorial

Build a working email/consent form from a component definition and three reusable
interaction definitions. The generated component updates local state and emits
a request event. Your application receives that event; this exercise does not
send an email or contact a server.

Start with the complete `bin` distribution, Node >=22.12, and a workspace where
`interaction-demo` is not already a project. The examples ship in
`bin/data/docs/examples/interactions`. Run the commands from the workspace root.

## Import the definitions

```sh
node bin/forge.js interactions import --from bin/data/docs/examples/interactions/definitions
node bin/forge.js components import --from bin/data/docs/examples/interactions/components
node bin/forge.js interactions validate
node bin/forge.js components validate
node bin/forge.js components inspect contact-request
node bin/forge.js interactions inspect prepare-request
```

Use a fresh library for this exercise: imports refuse duplicate IDs and existing
files. If these examples were already imported, inspect and validate them instead
of importing again.

The [component](../examples/interactions/components/contact-request.md)
declares three state fields: `email`, `consent` and `status`. Its text input
attaches [capture-email](../examples/interactions/definitions/capture-email.md),
which copies `event.currentTarget.value` into `email`. Its checkbox attaches
[capture-consent](../examples/interactions/definitions/capture-consent.md),
which copies the boolean `checked` value.

The form attaches
[prepare-request](../examples/interactions/definitions/prepare-request.md):
it prevents default navigation, sets `status` to `Request prepared`, then emits
`contact:requested` with the current email, consent and status. These actions run
in order. Binding the paragraph text to `{{state.status}}` updates the visible
status when submission runs.

## Generate and mount the browser component

```sh
node bin/forge.js project create interaction-demo
node bin/forge.js make ui contact-request --framework vanilla --project interaction-demo --dry-run
node bin/forge.js make ui contact-request --framework vanilla --project interaction-demo
```

Create `projects/interaction-demo/contact.html` with this content:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Contact request example</title>
  </head>
  <body>
    <h1>Contact request</h1>
    <main id="app"></main>
    <h2>Application event</h2>
    <pre id="result">No request prepared.</pre>
    <script type="module">
      import createContactRequest from './src/ui/contact-request.js';
      const app = document.querySelector('#app');
      app.addEventListener('contact:requested', event => {
        document.querySelector('#result').textContent = JSON.stringify(event.detail, null, 2);
      });
      app.append(createContactRequest());
    </script>
  </body>
</html>
```

Start the generated project's development server:

```sh
cd projects/interaction-demo
npm install
npm run dev
```

Open `/contact.html` on the local URL printed by Vite. Enter
`reader@example.com`, select the consent checkbox, then press **Prepare request**.
The status becomes `Request prepared`. The application event displays the email,
`consent: true`, and the updated status. Try submitting with an invalid email or
without consent: native form validation prevents the submission.

Mount the `.js` factory as shown. The generated `.html` fragment is the initial
snapshot and does not attach event handlers by itself. Use the application's
HTTP server, rather than opening module files directly through `file:` URLs.

## Generate another target and inspect stories

Return to the workspace root after stopping the server:

```sh
cd ../..
node bin/forge.js make ui contact-request --framework react --project interaction-demo --out src/react-ui --stories --stories-out stories/react --dry-run
```

The same definitions produce React state and handlers. Replace `react` with
`vue`, `svelte`, `angular`, `html` or `htmx` to inspect another supported target.
The dry run does not install those frameworks or Storybook. Supply their build
dependencies in the consuming project before compiling or mounting those outputs.
Storybook stories reference the same executable generated component.

Before production, replace the event-display listener with your application's
request handling, server validation, authorization, and pending/success/failure
UI. Keep generated files reproducible by editing definitions and using
[reviewed regeneration](../how-to/manage-interactions.md), then test the compiled
component with real browser events. The example's fixed input ID assumes one
rendered form; give multiple instances unique label/input IDs.
