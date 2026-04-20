# Backend Deployment Contract

## Deployment posture

The backend is intentionally split across **two deployment surfaces**. The frontend-facing HTTP routes live in the repository as **root-level Vercel API routes**, while the Stripe webhook runs as a dedicated **AWS Lambda** function. This split keeps the checkout and application APIs close to the existing frontend, while preserving the raw-body requirements Stripe expects for signature verification.[1]

## Required surfaces

| Surface | Deployment target | Why it exists |
| --- | --- | --- |
| Frontend + `api/*.js` | Vercel project connected to this repository | Keeps the current React/Vite property intact and exposes frontend-facing backend routes |
| `aws/lambda/stripe-webhook.mjs` | AWS Lambda behind an HTTPS endpoint | Verifies Stripe webhook signatures from the raw request body and writes paid application records |
| DynamoDB table | AWS | Stores durable paid application records and workflow state |
| S3 bucket | AWS | Stores uploaded intake documents through presigned POST requests |
| SES identity | AWS | Sends confirmation and internal operations emails from a verified address or domain[2] |

## Environment variables

The same contract applies to Vercel and the Lambda environment. Keep values synchronized.

| Variable | Vercel | Lambda | Notes |
| --- | --- | --- | --- |
| `APP_BASE_URL` | Yes | Optional | Used in checkout redirect URLs |
| `STRIPE_SECRET_KEY` | Yes | Yes | Required on both surfaces |
| `STRIPE_WEBHOOK_SECRET` | Optional | Yes | Required on the webhook function |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Yes | No | Exposed to the frontend build |
| `ENERGIE_TEILEN_ELIGIBILITY_PRICE_ID` | Yes | Yes | Server-owned Stripe product mapping |
| `ENERGIE_TEILEN_STRUCTURING_PRICE_ID` | Yes | Yes | Server-owned Stripe product mapping |
| `ENERGIE_TEILEN_MANDATE_PRICE_ID` | Yes | Yes | Server-owned Stripe product mapping |
| `AWS_REGION` | Yes | Yes | Shared AWS region |
| `AWS_ACCESS_KEY_ID` | Yes | Optional | Needed if Vercel uses static credentials |
| `AWS_SECRET_ACCESS_KEY` | Yes | Optional | Needed if Vercel uses static credentials |
| `ET_PILOT_APPLICATIONS_TABLE` | Yes | Yes | Shared DynamoDB table name |
| `ET_DOCUMENTS_BUCKET` | Yes | No | Needed on the upload route |
| `ET_FROM_EMAIL` | No | Yes | SES verified sender |
| `ET_INTERNAL_NOTIFICATION_EMAIL` | No | Yes | SES internal notification recipient |
| `ET_UPLOAD_URL_TTL_SECONDS` | Yes | No | Upload target expiry |
| `ADMIN_API_TOKEN` | Yes | No | Admin-only operations summary authentication |

## Vercel deployment steps

Start by connecting the repository to a Vercel project and keeping the **existing Vite build** unchanged. The current `pnpm build` command already builds the frontend and the lightweight server bundle, so no framework migration is required.

| Step | Action |
| --- | --- |
| 1 | Import the GitHub repository into Vercel |
| 2 | Set the framework preset to **Other** if Vercel does not auto-detect the current layout |
| 3 | Set the install command to `pnpm install` |
| 4 | Set the build command to `pnpm build` |
| 5 | Add all required environment variables from `.env.example` |
| 6 | Redeploy after every backend environment change |

## AWS deployment steps

Provision the DynamoDB table, S3 bucket, SES identity, and Lambda function before connecting Stripe. S3 presigned POST uploads allow browsers to upload files directly without backend credentials, which is why the bucket itself must exist before the frontend document flow is activated.[3]

| Step | Action |
| --- | --- |
| 1 | Create the DynamoDB table from `aws/docs/dynamodb-schema.md` |
| 2 | Create the S3 bucket from `aws/docs/aws-resources.md` |
| 3 | Verify the sender identity used in `ET_FROM_EMAIL` within SES |
| 4 | Package and deploy `aws/lambda/stripe-webhook.mjs` and `aws/lambda/_lib/` |
| 5 | Configure the Lambda environment variables |
| 6 | Expose the Lambda through Function URL, API Gateway, or another HTTPS endpoint |
| 7 | Register that public HTTPS endpoint in Stripe as the webhook destination |

## Stripe configuration

Stripe Checkout prices remain **server-owned**. The frontend sends only `offerCode`; the server maps it to env-controlled price IDs. Stripe metadata is used to carry operational fields such as contact information and project type into the webhook-created canonical record.[4]

| Stripe object | Required configuration |
| --- | --- |
| Prices | Create one price for each pilot offer and store only the resulting price IDs in env |
| Checkout Session | Created by `api/pilot-checkout.js` in `payment` mode |
| Webhook endpoint | Point to the Lambda HTTPS endpoint |
| Events | Subscribe at minimum to `checkout.session.completed` |

## Secrets and IAM posture

Use **least privilege** on all AWS credentials. The Vercel side needs DynamoDB read and update access plus S3 presigned POST generation permissions. The Lambda side needs DynamoDB read and write permissions plus SES send permissions. Do not share an unrestricted administrator credential with either surface.

| Surface | Minimum AWS capability |
| --- | --- |
| Vercel API routes | DynamoDB `GetItem`, `UpdateItem`, `Scan`; S3 presign-related access to the documents bucket |
| Lambda webhook | DynamoDB `GetItem`, `PutItem`, `UpdateItem`; SES `SendEmail` |

## Cutover checklist

Before turning the backend on for live pilot traffic, walk through the end-to-end flow with test credentials.

| Check | Expected outcome |
| --- | --- |
| Checkout session creation | Returns a valid Stripe Checkout URL and session ID |
| Stripe test payment | Produces a `checkout.session.completed` event |
| Lambda webhook | Verifies the signature and creates one canonical paid record |
| Intake submission | Updates the existing application instead of creating a second record |
| Upload target request | Returns an S3 POST target only for the paid application |
| Operations summary | Returns totals and recent applications only when admin auth is present |

## References

[1]: https://docs.stripe.com/webhooks/signature "Stripe: Resolve webhook signature verification errors"
[2]: https://docs.aws.amazon.com/ses/latest/dg/verify-addresses-and-domains.html "AWS SES: Verified identities"
[3]: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-presigned-post/ "AWS SDK for JavaScript v3: s3-presigned-post"
[4]: https://docs.stripe.com/metadata "Stripe: Metadata"
