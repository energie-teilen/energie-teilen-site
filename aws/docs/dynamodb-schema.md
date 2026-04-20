# DynamoDB Schema

## Table design

The backend uses a **single-table pattern** with one primary canonical item per paid application. The application ID is deterministic from the Stripe session ID, which gives the webhook a stable idempotency anchor.

| Attribute | Value |
| --- | --- |
| Table name | `ET_PILOT_APPLICATIONS_TABLE` |
| Partition key | `pk` |
| Sort key | `sk` |
| Primary item key pattern | `pk = APPLICATION#<applicationId>`, `sk = APPLICATION` |
| Entity discriminator | `entityType = pilot_application` |

## Canonical application item

| Field | Type | Meaning |
| --- | --- | --- |
| `applicationId` | string | Canonical application identifier |
| `stripeSessionId` | string | Checkout correlation identifier |
| `stripePaymentIntentId` | string or null | Stripe payment intent correlation |
| `stripeCustomerId` | string or null | Stripe customer correlation |
| `status` | string | Current operational status |
| `stage` | string | Current workflow stage |
| `intakeStatus` | string | Structured intake state |
| `documentStatus` | string | Document workflow state |
| `offerCode` | string | Purchased offer code |
| `offerLabel` | string | Human-readable offer label |
| `priceId` | string | Stripe price ID resolved from env |
| `projectType` | string | Declared project class |
| `email` | string | Primary contact email |
| `emailNormalized` | string | Lowercased match field for public access checks |
| `name` | string | Contact name |
| `phone` | string | Contact phone |
| `location` | string | Project geography |
| `organization` | string | Applicant organization |
| `amountPaid` | number | Paid amount in minor units |
| `currency` | string | Currency code |
| `checkoutMetadata` | map | Operational metadata copied from Stripe Checkout |
| `legalAcceptances` | map | Legal flags from checkout and intake |
| `intake` | map or null | Structured project intake |
| `documents` | list | Document metadata and requested upload keys |
| `customerEmailStatus` | string | Customer notification delivery state |
| `internalEmailStatus` | string | Internal notification delivery state |
| `createdAt` | string | ISO timestamp |
| `updatedAt` | string | ISO timestamp |
| `paidAt` | string | ISO timestamp |
| `intakeSubmittedAt` | string or null | ISO timestamp |
| `statusHistory` | list | Append-only status transitions |

## Example key structure

| Field | Example |
| --- | --- |
| `pk` | `APPLICATION#etapp_cs_test_a1b2c3` |
| `sk` | `APPLICATION` |
| `applicationId` | `etapp_cs_test_a1b2c3` |

## Intake sub-document

The `intake` map is intentionally structured so the frontend can submit a disciplined set of operational fields without inventing marketplace or settlement logic.

| Intake field | Type |
| --- | --- |
| `propertyType` | string |
| `ownershipStructure` | string |
| `currentSupplyArrangement` | string |
| `assetProfile` | string[] |
| `stakeholderMap` | string[] |
| `goals` | string[] |
| `constraints` | string[] |
| `notes` | string |
| `desiredTimeline` | string |
| `submittedBy` | string |

## Document metadata sub-document

| Field | Type |
| --- | --- |
| `documentId` | string |
| `documentType` | string |
| `fileName` | string |
| `contentType` | string |
| `sizeBytes` | number |
| `bucket` | string |
| `s3Key` | string |
| `status` | string |
| `requestedAt` | string |
| `requestedBy` | string |

## Operational rationale

This schema is optimized for **write certainty and operational clarity** rather than theoretical marketplace complexity. The webhook creates a single canonical item, and later API routes update that same item as intake and document work progress. For this paid pilot use case, that keeps retrieval simple and idempotency strong.
