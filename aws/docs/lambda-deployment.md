# Lambda Deployment

## Purpose

`aws/lambda/stripe-webhook.mjs` is the verified event intake point for Stripe. It exists separately from the frontend-facing API routes because Stripe signature verification requires the **raw request body** during `constructEvent` validation.[1]

## Deployment package contents

| Path | Include in package |
| --- | --- |
| `aws/lambda/stripe-webhook.mjs` | Yes |
| `aws/lambda/_lib/aws-clients.mjs` | Yes |
| `aws/lambda/_lib/email.mjs` | Yes |
| `aws/lambda/_lib/logging.mjs` | Yes |
| `aws/lambda/_lib/pilot-products.mjs` | Yes |
| Root `node_modules/` dependencies used by the Lambda | Yes |

## Required environment variables

| Variable | Required |
| --- | --- |
| `STRIPE_SECRET_KEY` | Yes |
| `STRIPE_WEBHOOK_SECRET` | Yes |
| `ENERGIE_TEILEN_ELIGIBILITY_PRICE_ID` | Yes |
| `ENERGIE_TEILEN_STRUCTURING_PRICE_ID` | Yes |
| `ENERGIE_TEILEN_MANDATE_PRICE_ID` | Yes |
| `AWS_REGION` | Yes |
| `ET_PILOT_APPLICATIONS_TABLE` | Yes |
| `ET_FROM_EMAIL` | Yes |
| `ET_INTERNAL_NOTIFICATION_EMAIL` | Yes |

## Handler settings

| Setting | Value |
| --- | --- |
| Runtime | Node.js 20.x or newer |
| Handler | `stripe-webhook.handler` |
| Timeout | 15 seconds is a reasonable starting point |
| Memory | 256 MB is sufficient for this workload |
| Retry behavior | Leave webhook retries to Stripe; return non-200 only on real failures |

## Deployment sequence

| Step | Action |
| --- | --- |
| 1 | Install production dependencies in the repository root |
| 2 | Package `aws/lambda/` together with the required `node_modules` tree |
| 3 | Create or update the Lambda function |
| 4 | Set the environment variables listed above |
| 5 | Attach an execution role with DynamoDB write and SES send permissions |
| 6 | Expose the function through Function URL or API Gateway |
| 7 | Register the resulting HTTPS URL as the Stripe webhook endpoint |

## Verification checklist

| Check | Expected result |
| --- | --- |
| Missing signature header | Returns HTTP 400 |
| Invalid signature | Returns HTTP 400 |
| Valid `checkout.session.completed` event | Returns HTTP 200 and writes exactly one canonical application |
| Replayed event | Returns HTTP 200 without creating a duplicate application |
| Email failure after record creation | Stripe retry can complete pending email flags without duplicating the record |

## References

[1]: https://docs.stripe.com/webhooks/signature "Stripe: Resolve webhook signature verification errors"
