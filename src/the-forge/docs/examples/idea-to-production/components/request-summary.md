---
schemaVersion: 1
id: request-summary
name: RequestSummary
props:
  requester:
    type: string
    default: Morgan Lee
  amount:
    type: string
    default: €240.00
    description: Locale-formatted display amount; domain code stores integer cents.
  purpose:
    type: string
    default: Attend a workshop needed for the customer research pilot.
  status:
    type: string
    default: Pending
root:
  tag: section
  attrs:
    aria-label: Request details
    class: request-summary
  children:
    - tag: h2
      text: Purchase details
    - tag: dl
      children:
        - tag: dt
          text: Requested by
        - tag: dd
          text: "{{requester}}"
        - tag: dt
          text: Amount
        - tag: dd
          text: "{{amount}}"
        - tag: dt
          text: Status
        - tag: dd
          text: "{{status}}"
    - tag: p
      text: "{{purpose}}"
    - slot: children
storybook:
  title: Purchase Approvals/Request Summary
  tags: [autodocs]
  parameters:
    layout: padded
  stories:
    - name: Pending
    - name: Approved
      args:
        status: Approved
    - name: LongPurpose
      args:
        purpose: Attend a full-day workshop to plan accessible customer research across several product teams and publish reusable research guidance afterwards.
---
Presentational summary for REQ-02 and UI-02/UI-05. All sample data is fictional.
The caller formats currency and supplies authorized data. Child content can supply
application-owned actions; this definition performs no authorization or state transition.
