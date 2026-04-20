# Pilot Workflow

## Workflow objective

This workflow is designed for a **paid pilot preparation business**. It qualifies demand, captures a paid commitment, creates a durable operating record, and gives the team a disciplined way to move applicants from payment into structured intake and document collection.

## End-to-end lifecycle

| Phase | Trigger | System state | Operational meaning |
| --- | --- | --- | --- |
| Checkout initiated | Frontend posts to `api/pilot-checkout` | Stripe Checkout session created | Applicant is moving into a paid pilot offer |
| Payment received | Stripe emits `checkout.session.completed` and Lambda verifies the signature | Canonical paid application created | The opportunity is now a durable operating record |
| Intake pending | Record exists but no structured intake yet | `intakeStatus = pending` | Operations can see the record, but qualification details are still incomplete |
| Intake submitted | Applicant posts to `api/submit-pilot-intake` | `status = intake_submitted` | Core project facts and legal confirmations are now attached |
| Document upload prepared | Applicant requests a presigned upload target | `documentStatus = upload_requested` | The record is ready to receive supporting evidence |
| Operations review | Admin checks summary and application details | Internal review and follow-up | The team can now progress the pilot under a documented posture |

## Practical operating sequence

The checkout route starts the flow but does not create the canonical application. The canonical record is created only when the verified Stripe webhook confirms a paid session. This distinction matters because it prevents false positives from abandoned sessions and keeps the data model aligned with real paid activity.

After payment, the applicant can be routed to a success state that uses the returned `sessionId` plus the contact email to retrieve the canonical record. From there, the frontend can show the intake form and document-upload prompts in sequence.

## Status model

| Field | Values used in this backend | Meaning |
| --- | --- | --- |
| `status` | `payment_received`, `intake_submitted`, `document_upload_requested` | Current application state |
| `stage` | `paid`, `intake_submitted` | High-level workflow position |
| `intakeStatus` | `pending`, `submitted` | Whether structured intake is complete |
| `documentStatus` | `pending`, `upload_requested` | Whether document intake has started |

## Email behavior

The webhook sends two operational emails: one to the applicant confirming the paid pilot intake, and one to the internal operations address announcing a new paid application. Email delivery is guarded with record-level notification flags so webhook retries do not create duplicate notices.

## Operational handoff

| Actor | Next step after system event |
| --- | --- |
| Applicant | Complete structured intake and upload supporting documents |
| Operations | Review recent applications, verify intake quality, and schedule follow-up |
| Founder or admin | Use the operations summary route for a current snapshot of paid pilot activity |

## Failure posture

If Stripe retries the webhook, the system must not create duplicate applications. If an applicant submits intake for an unknown application, the route must reject it. If a document upload is requested for a non-matching email, the route must reject it. These failures are intentional guardrails, not edge-case bugs.
