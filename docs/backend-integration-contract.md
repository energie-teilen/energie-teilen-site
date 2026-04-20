# Backend Integration Contract

## Contract intent

This document defines the **frontend-to-backend contract** for the paid pilot platform. The current frontend can remain in React/Vite and attach forms or CTA flows to these routes without replatforming. The backend owns product mapping, payment configuration, application persistence, and document intake.

## Core rules

The frontend may choose presentation, field ordering, and success-state UX, but it must not choose prices, line items, or entitlements. Offer selection is limited to the canonical `offerCode` values and the backend maps those codes to Stripe Price IDs on the server.

| Rule | Contract |
| --- | --- |
| Product ownership | Frontend sends `offerCode`; backend resolves `priceId` |
| Price ownership | Frontend must never send price amounts or Stripe price IDs |
| Applicant access | Public routes require the paid applicant email unless admin auth is used |
| Admin access | Use `Authorization: Bearer <ADMIN_API_TOKEN>` |
| Document uploads | Frontend uploads directly to S3 using returned POST target fields |

## Route: `POST /api/pilot-checkout`

This route creates a Stripe Checkout session for one of the server-owned pilot products.

### Request body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `offerCode` | string | Yes | One of `et_eligibility`, `et_structuring`, `et_mandate` |
| `projectType` | string | Yes | Free-text project class used operationally |
| `email` | string | Yes | Primary applicant email |
| `name` | string | Yes | Contact name |
| `phone` | string | No | Contact phone |
| `location` | string | No | Project geography |
| `organization` | string | No | Applicant organization |
| `legalAcceptances.privacyPolicyAccepted` | boolean | No | Stored as checkout metadata |
| `legalAcceptances.pilotTermsAccepted` | boolean | No | Stored as checkout metadata |
| `legalAcceptances.marketingConsent` | boolean | No | Stored as checkout metadata |

### Success response

| Field | Type | Notes |
| --- | --- | --- |
| `ok` | boolean | Always `true` on success |
| `checkoutUrl` | string | Redirect the browser here |
| `sessionId` | string | Stripe Checkout Session ID |
| `offerCode` | string | Canonical internal offer code |
| `offerLabel` | string | Human-readable offer label |
| `projectType` | string | Echoed normalized project type |
| `currency` | string | Stripe session currency |
| `stage` | string | Currently `checkout_created` |

### Failure cases

| Condition | Status |
| --- | --- |
| Unknown offer code | `400` |
| Invalid email or missing required field | `400` |
| Client tries to send pricing keys | `400` |
| Missing backend env | `500` |

## Route: `POST /api/submit-pilot-intake`

This route attaches structured intake to an existing **paid application**.

### Request body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `applicationId` | string | Yes | Canonical application ID from backend |
| `email` | string | Yes for public access | Must match the paid application email |
| `propertyType` | string | Yes | Building, quarter, portfolio, and so on |
| `ownershipStructure` | string | Yes | Ownership and decision structure |
| `currentSupplyArrangement` | string | Yes | Current energy or supply arrangement summary |
| `assetProfile` | string[] or string | No | Normalized to string array |
| `stakeholderMap` | string[] or string | No | Normalized to string array |
| `goals` | string[] or string | No | Normalized to string array |
| `constraints` | string[] or string | No | Normalized to string array |
| `notes` | string | No | Optional free-text detail |
| `desiredTimeline` | string | No | Optional timeline preference |
| `legalAcceptances.privacyPolicyAccepted` | boolean | Yes | Must be true |
| `legalAcceptances.pilotTermsAccepted` | boolean | Yes | Must be true |
| `legalAcceptances.authorityConfirmed` | boolean | No | Optional |
| `legalAcceptances.dataAccuracyConfirmed` | boolean | No | Optional |

### Success response

| Field | Type | Notes |
| --- | --- | --- |
| `ok` | boolean | Always `true` on success |
| `application` | object | Safe public application summary |

## Route: `POST /api/request-upload-url`

This route returns an S3 presigned POST target for a **valid paid application**.

### Request body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `applicationId` | string | Yes | Existing paid application |
| `email` | string | Yes for public access | Must match the paid application email |
| `documentType` | string | Yes | Allowed types only |
| `fileName` | string | Yes | Original client-side file name |
| `contentType` | string | Yes | MIME type |
| `sizeBytes` | number | Yes | Maximum 25 MB |

### Allowed `documentType` values

| Value | Meaning |
| --- | --- |
| `site_plan` | Site or building plan |
| `utility_bill` | Utility or consumption bill |
| `ownership_proof` | Ownership or authority evidence |
| `consumption_export` | Exported consumption data |
| `technical_photo` | Technical or site photo |
| `stakeholder_document` | Stakeholder or governance document |
| `signed_mandate` | Signed mandate file |
| `other_supporting_document` | Other supporting evidence |

### Success response

| Field | Type | Notes |
| --- | --- | --- |
| `ok` | boolean | Always `true` on success |
| `applicationId` | string | Echoed application ID |
| `documentId` | string | Backend-generated document identifier |
| `documentType` | string | Echoed document type |
| `upload.url` | string | S3 endpoint URL |
| `upload.method` | string | Always `POST` |
| `upload.fields` | object | Form fields required by S3 |
| `upload.key` | string | S3 object key |
| `upload.expiresAt` | string | ISO timestamp |
| `upload.maxUploadSizeBytes` | number | Maximum accepted upload size |

## Route: `GET /api/get-application`

This route returns application status for either applicant success flows or admin tooling.

### Query parameters

| Parameter | Required | Notes |
| --- | --- | --- |
| `applicationId` | One of `applicationId` or `sessionId` is required | Direct lookup |
| `sessionId` | One of `applicationId` or `sessionId` is required | Useful immediately after Stripe redirect |
| `email` | Required for public access | Must match the paid application email |

### Success response

For applicant access, the response contains a safe subset of application fields, current statuses, document metadata, and status history. For admin access, the full record is returned.

## Route: `GET /api/get-operations-summary`

This route is **admin-only**.

### Headers

| Header | Required | Notes |
| --- | --- | --- |
| `Authorization` | Yes | `Bearer <ADMIN_API_TOKEN>` |

### Success response

| Field | Type | Notes |
| --- | --- | --- |
| `ok` | boolean | Always `true` on success |
| `generatedAt` | string | ISO timestamp |
| `totals.applications` | number | Count of paid applications |
| `totals.revenueMinorByCurrency` | object | Sum of paid amounts in minor units by currency |
| `totals.statusDistribution` | object | Count by application status |
| `totals.intakeStatusDistribution` | object | Count by intake status |
| `totals.offerDistribution` | object | Count by offer code |
| `recentApplications` | array | Recent paid applications with operational fields |

## Frontend implementation notes

The frontend should treat `sessionId` as the immediate post-checkout correlation handle. Once the webhook runs, the frontend can call `GET /api/get-application?sessionId=...&email=...` to retrieve the canonical application record and surface the next step. Document uploads must use a standard browser `FormData` POST directly to the returned S3 target.
