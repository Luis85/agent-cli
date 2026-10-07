---
schemaVersion: 1
id: approval-page
name: ApprovalPage
props:
  title:
    type: string
    default: Conference workshop
  requester:
    type: string
    default: Morgan Lee
  amount:
    type: string
    default: €240.00
  purpose:
    type: string
    default: Attend a workshop needed for the customer research pilot.
  status:
    type: string
    default: Pending
root:
  tag: div
  attrs:
    class: approval-page
  children:
    - tag: header
      children:
        - tag: a
          attrs:
            href: /requests
          text: Team Purchase Approvals
        - tag: nav
          attrs:
            aria-label: Primary
          children:
            - tag: a
              attrs:
                href: /requests
              text: Requests
    - tag: main
      children:
        - tag: h1
          text: "{{title}}"
        - component: request-summary
          props:
            requester: "{{requester}}"
            amount: "{{amount}}"
            purpose: "{{purpose}}"
            status: "{{status}}"
          children:
            - tag: a
              attrs:
                href: /requests
              text: Back to requests
storybook:
  title: Purchase Approvals/Request Detail
  tags: [autodocs]
  parameters:
    layout: fullscreen
  stories:
    - name: Pending
    - name: Approved
      args:
        status: Approved
    - name: Rejected
      args:
        status: Rejected
    - name: LongTitle
      args:
        title: Accessible research planning workshop for the cross-functional customer experience team
---
Static request-detail composition for UI-02 and UI-05 with synthetic sample data.
Pending, Approved and Rejected stories demonstrate visible status copy only.
Native application code must supply authenticated routing, decision/audit details,
confirmation, forms, loading/error handling, styles and complete accessibility behavior.
