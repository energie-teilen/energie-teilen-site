import Stripe from "stripe";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoDocumentClient, getTableName } from "./_lib/aws-clients.mjs";
import { sendCustomerConfirmationEmail, sendInternalNotificationEmail } from "./_lib/email.mjs";
import { logError, logInfo, logWarn } from "./_lib/logging.mjs";
import { getApplicationIdFromSessionId, resolvePilotProduct } from "./_lib/pilot-products.mjs";

let stripeClient;

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getStripeClient() {
  if (!stripeClient) {
    stripeClient = new Stripe(getRequiredEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2025-03-31.basil",
    });
  }

  return stripeClient;
}

function applicationKey(applicationId) {
  return {
    pk: `APPLICATION#${applicationId}`,
    sk: "APPLICATION",
  };
}

function parseBooleanMetadata(value) {
  return String(value || "false").toLowerCase() === "true";
}

function getStripeSignature(headers = {}) {
  return headers["stripe-signature"] || headers["Stripe-Signature"] || "";
}

function getRawBody(event) {
  const body = event?.body || "";
  if (event?.isBase64Encoded) {
    return Buffer.from(body, "base64");
  }
  return Buffer.from(body, "utf-8");
}

async function getApplication(applicationId) {
  const response = await getDynamoDocumentClient().send(
    new GetCommand({
      TableName: getTableName(),
      Key: applicationKey(applicationId),
    }),
  );

  return response.Item ?? null;
}

async function createPaidApplicationRecordFromSession(session) {
  const offerCode = session.metadata?.offer_code;
  const product = resolvePilotProduct(offerCode);
  const applicationId = getApplicationIdFromSessionId(session.id);
  const paidAt = new Date(((session.created || Math.floor(Date.now() / 1000)) * 1000)).toISOString();

  const item = {
    ...applicationKey(applicationId),
    entityType: "pilot_application",
    applicationId,
    stripeSessionId: session.id,
    stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null,
    stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id || null,
    status: "payment_received",
    stage: "paid",
    intakeStatus: "pending",
    documentStatus: "pending",
    offerCode: product.offerCode,
    offerLabel: session.metadata?.offer_label || product.offerLabel,
    priceId: product.priceId,
    projectType: session.metadata?.project_type || "unspecified",
    email: session.metadata?.email || session.customer_details?.email || "",
    emailNormalized: String(session.metadata?.email || session.customer_details?.email || "").trim().toLowerCase(),
    name: session.metadata?.name || session.customer_details?.name || "",
    phone: session.metadata?.phone || session.customer_details?.phone || "",
    location: session.metadata?.location || "",
    organization: session.metadata?.organization || "",
    amountPaid: Number(session.amount_total || 0),
    currency: String(session.currency || "eur").toLowerCase(),
    checkoutMetadata: session.metadata || {},
    legalAcceptances: {
      privacyPolicyAccepted: parseBooleanMetadata(session.metadata?.legal_privacy_accepted),
      pilotTermsAccepted: parseBooleanMetadata(session.metadata?.legal_terms_accepted),
      marketingConsent: parseBooleanMetadata(session.metadata?.legal_marketing_consent),
    },
    intake: null,
    documents: [],
    customerEmailStatus: "pending",
    internalEmailStatus: "pending",
    createdAt: paidAt,
    updatedAt: paidAt,
    paidAt,
    intakeSubmittedAt: null,
    statusHistory: [
      {
        status: "payment_received",
        source: "stripe_webhook",
        note: "Stripe checkout session completed.",
        at: paidAt,
      },
    ],
  };

  try {
    await getDynamoDocumentClient().send(
      new PutCommand({
        TableName: getTableName(),
        Item: item,
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );

    return { created: true, application: item };
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException || error?.name === "ConditionalCheckFailedException") {
      return {
        created: false,
        application: await getApplication(applicationId),
      };
    }

    throw error;
  }
}

async function updateNotificationStatus(applicationId, notificationPatch) {
  const now = new Date().toISOString();
  const names = {};
  const values = { ":updatedAt": now };
  const assignments = ["updatedAt = :updatedAt"];

  for (const [field, value] of Object.entries(notificationPatch)) {
    const nameKey = `#${field}`;
    const valueKey = `:${field}`;
    names[nameKey] = field;
    values[valueKey] = value;
    assignments.push(`${nameKey} = ${valueKey}`);
  }

  const response = await getDynamoDocumentClient().send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: applicationKey(applicationId),
      ConditionExpression: "attribute_exists(pk)",
      UpdateExpression: `SET ${assignments.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    }),
  );

  return response.Attributes;
}

async function ensureNotificationsDelivered(application) {
  let current = application;

  if (current.email && current.customerEmailStatus !== "sent") {
    await sendCustomerConfirmationEmail(current);
    current = await updateNotificationStatus(current.applicationId, {
      customerEmailStatus: "sent",
      customerEmailSentAt: new Date().toISOString(),
    });
  }

  if (current.internalEmailStatus !== "sent") {
    await sendInternalNotificationEmail(current);
    current = await updateNotificationStatus(current.applicationId, {
      internalEmailStatus: "sent",
      internalEmailSentAt: new Date().toISOString(),
    });
  }

  return current;
}

async function handleCheckoutSessionCompleted(session) {
  if (session.mode !== "payment") {
    logWarn("Skipping non-payment checkout session.", {
      stripeSessionId: session.id,
      mode: session.mode,
    });
    return { handled: false, reason: "non_payment_mode" };
  }

  if (session.payment_status !== "paid") {
    logWarn("Skipping checkout session that is not fully paid.", {
      stripeSessionId: session.id,
      paymentStatus: session.payment_status,
    });
    return { handled: false, reason: "payment_not_paid" };
  }

  const createdRecord = await createPaidApplicationRecordFromSession(session);
  const application = await ensureNotificationsDelivered(createdRecord.application);

  logInfo("Stripe checkout session processed.", {
    stripeSessionId: session.id,
    applicationId: application.applicationId,
    created: createdRecord.created,
  });

  return {
    handled: true,
    created: createdRecord.created,
    applicationId: application.applicationId,
  };
}

export async function handler(event) {
  try {
    getRequiredEnv("STRIPE_WEBHOOK_SECRET");
    getRequiredEnv("STRIPE_SECRET_KEY");
    getRequiredEnv("AWS_REGION");
    getRequiredEnv("ET_PILOT_APPLICATIONS_TABLE");
    getRequiredEnv("ET_FROM_EMAIL");
    getRequiredEnv("ET_INTERNAL_NOTIFICATION_EMAIL");

    const signature = getStripeSignature(event?.headers);
    if (!signature) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: false, error: "Missing Stripe signature header." }),
      };
    }

    const rawBody = getRawBody(event);
    let stripeEvent;

    try {
      stripeEvent = getStripeClient().webhooks.constructEvent(rawBody, signature, getRequiredEnv("STRIPE_WEBHOOK_SECRET"));
    } catch (error) {
      logWarn("Stripe webhook signature verification failed.", {
        error,
      });

      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: false, error: "Invalid Stripe webhook signature." }),
      };
    }

    switch (stripeEvent.type) {
      case "checkout.session.completed": {
        const result = await handleCheckoutSessionCompleted(stripeEvent.data.object);
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ok: true, type: stripeEvent.type, result }),
        };
      }
      default:
        logInfo("Ignoring unsupported Stripe event type.", {
          eventType: stripeEvent.type,
        });
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ok: true, ignored: true, type: stripeEvent.type }),
        };
    }
  } catch (error) {
    logError("Stripe webhook processing failed.", {
      error,
    });

    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  }
}

export default handler;
