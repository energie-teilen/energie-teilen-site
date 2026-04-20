# AWS Resources

## Resource inventory

The backend needs a compact AWS footprint. It uses **DynamoDB** for canonical application records, **S3** for direct document uploads, **SES** for transactional email, and **Lambda** for verified Stripe webhook handling.

| Resource | Suggested name pattern | Purpose |
| --- | --- | --- |
| DynamoDB table | `energie-teilen-pilot-applications` | Stores canonical paid application records |
| S3 bucket | `energie-teilen-pilot-documents-<env>` | Stores uploaded applicant documents |
| SES verified identity | `pilot.energie-teilen.de` or a verified sender mailbox | Sends applicant and internal notification emails |
| Lambda function | `energie-teilen-stripe-webhook` | Processes verified Stripe webhook events |
| CloudWatch log group | `/aws/lambda/energie-teilen-stripe-webhook` | Stores webhook execution logs |

## S3 notes

S3 presigned POST uploads let an application receive time-limited form fields that a browser can post directly to S3 without backend credentials.[1] That is why the backend route returns `url`, `fields`, and the object key rather than proxying the file through the application server.

| Setting | Recommendation |
| --- | --- |
| Bucket versioning | Enable it for operational safety |
| Public access | Keep blocked |
| Server-side encryption | Enable SSE-S3 or SSE-KMS |
| Lifecycle policy | Add archival or cleanup rules after the retention period is defined |
| CORS | Allow the frontend origin to `POST` to the bucket |

## DynamoDB notes

The current backend uses a single table and stores one primary item per application. Partition-key design matters for long-term load distribution, which is why the record uses a deterministic application ID derived from the Stripe session instead of mutable user input.[2]

| Setting | Recommendation |
| --- | --- |
| Billing mode | On-demand for early operational simplicity |
| PITR | Enable point-in-time recovery |
| Encryption | Keep AWS-managed encryption enabled |
| TTL | Optional later for ephemeral audit or staging records, not required for application records |

## SES notes

Amazon SES requires the sender identity to be verified before mail can be sent from that address or domain.[3] In early accounts, the SES sandbox may also restrict sending to verified recipients until production access is granted.[4]

| Setting | Recommendation |
| --- | --- |
| Sender identity | Verify the exact address or domain used by `ET_FROM_EMAIL` |
| Region alignment | Keep SES in the same region as the Lambda where practical |
| Reputation monitoring | Enable bounce and complaint visibility if volume grows |

## IAM outline

| Principal | Minimum scope |
| --- | --- |
| Vercel backend credentials | DynamoDB read and update, S3 presign-related access to the documents bucket |
| Lambda execution role | DynamoDB read and write, SES `SendEmail`, CloudWatch logging |

## References

[1]: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-presigned-post/ "AWS SDK for JavaScript v3: s3-presigned-post"
[2]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html "AWS DynamoDB: Best practices for partition key design"
[3]: https://docs.aws.amazon.com/ses/latest/dg/verify-addresses-and-domains.html "AWS SES: Verified identities"
[4]: https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html "AWS SES: Request production access"
