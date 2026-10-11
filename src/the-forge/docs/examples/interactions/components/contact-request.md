---
schemaVersion: 1
id: contact-request
name: ContactRequest
state:
  email:
    type: string
    default: ""
  consent:
    type: boolean
    default: false
  status:
    type: string
    default: Enter your contact details
root:
  tag: form
  interactions: [prepare-request]
  children:
    - tag: label
      attrs:
        for: contact-email
      text: Email address
    - tag: input
      attrs:
        id: contact-email
        name: email
        type: email
        required: true
        value: "{{state.email}}"
      interactions: [capture-email]
    - tag: label
      children:
        - tag: input
          attrs:
            name: consent
            type: checkbox
            required: true
            checked: "{{state.consent}}"
          interactions: [capture-consent]
        - tag: span
          text: I agree to be contacted about this request
    - tag: button
      attrs:
        type: submit
      text: Prepare request
    - tag: p
      attrs:
        role: status
        aria-live: polite
      text: "{{state.status}}"
storybook:
  title: Forms/ContactRequest
  tags: [autodocs]
---
A contact-request form with component-local state and reusable interaction
references. Native required/email constraints guide input. On valid submission,
the form updates its status and emits contact:requested. The consuming
application owns server validation, sending the request and success/failure UI.

The example uses a fixed input ID for a single rendered instance. Applications
rendering several instances should provide unique label/input IDs.
