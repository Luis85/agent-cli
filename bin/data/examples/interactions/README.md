# Executable interaction examples

The [contact-request component](components/contact-request.md) uses three shared
Markdown interaction definitions:

- [Capture email](definitions/capture-email.md): copy a text input value into state.
- [Capture consent](definitions/capture-consent.md): copy a checkbox value into state.
- [Prepare request](definitions/prepare-request.md): update status and emit a native custom event.

Follow [Build an interactive form](../../docs/tutorials/interactive-form.md) to
import these files and generate an executable component. The [interaction
reference](../../docs/reference/interactions.md) defines the event/action schema.

These examples prepare a request locally. They do not submit data to a server,
store consent, or claim that a request has been accepted. Supply application
handlers and server validation before using the workflow in production.
