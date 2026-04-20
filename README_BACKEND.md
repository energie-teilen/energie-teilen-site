# Energie Teilen Backend

## Purpose

This backend turns **Energie Teilen** into an operational **paid pilot platform**. It does not model a live electricity marketplace and it does not implement settlement or payout logic. Its job is narrower and more practical: accept qualified pilot purchases, persist canonical application records, collect structured intake, prepare document uploads, notify operations, and expose an authenticated reporting surface.

## Architecture overview

The repository keeps the existing **React/Vite frontend** and lightweight server wrapper intact. The backend is added as a **Vercel-style API layer** for frontend-facing requests and an **AWS Lambda** webhook processor for Stripe events. Stripe requires the raw request body during webhook signature verification, which is why the payment event handler lives in Lambda instead of a body-parsing frontend route.[1] S3 presigned POST uploads allow browsers to upload documents directly to a controlled bucket without exposing AWS credentials.[2] SES requires verified sender identities before email can be sent from an address or domain.[3]

| Surface | Responsibility | Runtime |
| --- | --- | --- |
| `api/pilot-checkout.js` | Creates safe Stripe Checkout sessions from server-owned offer codes | Vercel API route |
| `api/submit-pilot-intake.js` | Persists structured post-payment intake and legal acceptances | Vercel API route |
| `api/request-upload-url.js` | Issues presigned upload targets for valid paid applications | Vercel API route |
| `api/get-application.js` | Returns a safe application view for applicants or admins | Vercel API route |
| `api/get-operations-summary.js` | Returns authenticated operations reporting | Vercel API route |
| `aws/lambda/stripe-webhook.mjs` | Verifies Stripe signatures, writes canonical paid records, and triggers email | AWS Lambda |

## Canonical paid pilot model

The backend is intentionally built around three **server-owned offer codes**. The frontend may submit an `offerCode`, but it never owns price lookup. Price IDs are resolved only from environment variables on the server.

| Offer code | Label | Purpose |
| --- | --- | --- |
| `et_eligibility` | Pilot Eligibility Check | First paid qualification layer |
| `et_structuring` | Pilot Structuring Package | Deeper project structuring and preparation |
| `et_mandate` | Full Pilot Preparation Mandate | Highest-touch paid preparation engagement |

## File layout

| Path | Role |
| --- | --- |
| `api/_lib/` | Shared HTTP, auth, product, Stripe, DynamoDB, S3, and logging helpers |
| `api/*.js` | Frontend-facing backend routes |
| `aws/lambda/_lib/` | Shared Lambda helpers for AWS clients, SES email, logging, and product definitions |
| `aws/lambda/stripe-webhook.mjs` | Verified Stripe event intake and idempotent paid application creation |
| `aws/docs/*.md` | AWS resource, schema, and deployment notes |
| `docs/*.md` | Integration contract, deployment contract, and workflow notes |
| `.env.example` | Required configuration contract |

## Environment contract

The backend fails loudly if required configuration is missing. Copy `.env.example` to a local environment file and provide values for every key before deployment.

| Variable | Purpose |
| --- | --- |
| `APP_BASE_URL` | Public base URL used for Checkout success and cancel redirects |
| `STRIPE_SECRET_KEY` | Server-side Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook endpoint secret for signature verification |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Frontend Stripe publishable key |
| `ENERGIE_TEILEN_ELIGIBILITY_PRICE_ID` | Stripe Price ID for `et_eligibility` |
| `ENERGIE_TEILEN_STRUCTURING_PRICE_ID` | Stripe Price ID for `et_structuring` |
| `ENERGIE_TEILEN_MANDATE_PRICE_ID` | Stripe Price ID for `et_mandate` |
| `AWS_REGION` | AWS region for DynamoDB, S3, and SES |
| `AWS_ACCESS_KEY_ID` | AWS access key with least-privilege backend access |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key with least-privilege backend access |
| `ET_PILOT_APPLICATIONS_TABLE` | DynamoDB table for paid application records |
| `ET_DOCUMENTS_BUCKET` | S3 bucket for intake documents |
| `ET_FROM_EMAIL` | SES-verified sender identity |
| `ET_INTERNAL_NOTIFICATION_EMAIL` | Internal operations notification recipient |
| `ET_UPLOAD_URL_TTL_SECONDS` | Presigned upload target TTL in seconds |
| `ADMIN_API_TOKEN` | Bearer token for admin-only summary and record access |

## Runtime flow

The commercial workflow begins with **server-owned checkout creation**. Once Stripe reports a completed paid session, the Lambda writes the canonical application record and sends customer and internal notification emails. The applicant can then submit structured intake and request presigned document uploads. Operations retrieves summary views through an admin-protected route.

| Step | Event | System outcome |
| --- | --- | --- |
| 1 | Frontend posts `offerCode` and contact data to `api/pilot-checkout.js` | Backend creates a Checkout session from env-owned price mapping |
| 2 | Stripe sends `checkout.session.completed` | Lambda verifies signature and creates the paid application |
| 3 | Applicant submits intake | Backend persists intake, legal acceptances, and status history |
| 4 | Applicant requests upload target | Backend verifies access and returns S3 presigned POST fields |
| 5 | Operations reviews summary | Admin route returns totals, distributions, and recent applications |

## Local validation

Install dependencies and validate both the existing frontend and the new backend files from the repository root.

```bash
pnpm install
pnpm build
pnpm check
node --check api/_lib/auth.js
node --check api/_lib/dynamo.js
node --check api/_lib/http.js
node --check api/_lib/logging.js
node --check api/_lib/pilot-products.js
node --check api/_lib/s3.js
node --check api/_lib/stripe.js
node --check api/pilot-checkout.js
node --check api/submit-pilot-intake.js
node --check api/request-upload-url.js
node --check api/get-application.js
node --check api/get-operations-summary.js
node --check aws/lambda/stripe-webhook.mjs
```

## References

[1]: https://docs.stripe.com/webhooks/signature "Stripe: Resolve webhook signature verification errors"
[2]: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-presigned-post/ "AWS SDK for JavaScript v3: s3-presigned-post"
[3]: https://docs.aws.amazon.com/ses/latest/dg/verify-addresses-and-domains.html "AWS SES: Verified identities"
