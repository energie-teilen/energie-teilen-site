import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { APPLICATION_STATUSES, getApplicationIdFromSessionId, getRequiredEnv } from "./pilot-products.js";

let documentClient;

function getTableName() {
  return getRequiredEnv("ET_PILOT_APPLICATIONS_TABLE");
}

function getDocumentClient() {
  if (!documentClient) {
    const client = new DynamoDBClient({ region: getRequiredEnv("AWS_REGION") });
    documentClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
  }

  return documentClient;
}

function applicationKey(applicationId) {
  return {
    pk: `APPLICATION#${applicationId}`,
    sk: "APPLICATION",
  };
}

function buildStatusEntry(status, source, note, timestamp = new Date().toISOString()) {
  return [{ status, source, note, at: timestamp }];
}

export async function getApplicationById(applicationId) {
  const command = new GetCommand({
    TableName: getTableName(),
    Key: applicationKey(applicationId),
  });

  const response = await getDocumentClient().send(command);
  return response.Item ?? null;
}

export async function getApplicationBySessionId(sessionId) {
  const applicationId = getApplicationIdFromSessionId(sessionId);
  return getApplicationById(applicationId);
}

export async function createPaidApplicationRecord(input) {
  const now = input.paidAt || new Date().toISOString();
  const item = {
    ...applicationKey(input.applicationId),
    entityType: "pilot_application",
    applicationId: input.applicationId,
    stripeSessionId: input.stripeSessionId,
    stripePaymentIntentId: input.stripePaymentIntentId || null,
    stripeCustomerId: input.stripeCustomerId || null,
    status: APPLICATION_STATUSES.PAYMENT_RECEIVED,
    stage: "paid",
    intakeStatus: "pending",
    documentStatus: "pending",
    offerCode: input.offerCode,
    offerLabel: input.offerLabel,
    priceId: input.priceId,
    projectType: input.projectType,
    email: input.email,
    emailNormalized: input.emailNormalized,
    name: input.name,
    phone: input.phone,
    location: input.location,
    organization: input.organization,
    amountPaid: input.amountPaid,
    currency: input.currency,
    checkoutMetadata: input.checkoutMetadata || {},
    legalAcceptances: input.legalAcceptances || {},
    intake: input.intake || null,
    documents: input.documents || [],
    customerEmailStatus: input.customerEmailStatus || "pending",
    internalEmailStatus: input.internalEmailStatus || "pending",
    createdAt: now,
    updatedAt: now,
    paidAt: now,
    intakeSubmittedAt: null,
    statusHistory: buildStatusEntry(APPLICATION_STATUSES.PAYMENT_RECEIVED, "stripe_webhook", "Stripe checkout session completed.", now),
  };

  try {
    await getDocumentClient().send(
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
        application: await getApplicationById(input.applicationId),
      };
    }

    throw error;
  }
}

export async function updateApplicationIntake({ applicationId, intake, legalAcceptances, source = "frontend_intake" }) {
  const now = new Date().toISOString();
  const response = await getDocumentClient().send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: applicationKey(applicationId),
      ConditionExpression: "attribute_exists(pk)",
      UpdateExpression:
        "SET #intake = :intake, legalAcceptances = :legalAcceptances, #status = :status, stage = :stage, intakeStatus = :intakeStatus, intakeSubmittedAt = :now, updatedAt = :now, statusHistory = list_append(if_not_exists(statusHistory, :emptyList), :statusHistory)",
      ExpressionAttributeNames: {
        "#intake": "intake",
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":intake": intake,
        ":legalAcceptances": legalAcceptances,
        ":status": APPLICATION_STATUSES.INTAKE_SUBMITTED,
        ":stage": "intake_submitted",
        ":intakeStatus": "submitted",
        ":now": now,
        ":emptyList": [],
        ":statusHistory": buildStatusEntry(APPLICATION_STATUSES.INTAKE_SUBMITTED, source, "Structured intake submitted.", now),
      },
      ReturnValues: "ALL_NEW",
    }),
  );

  return response.Attributes;
}

export async function registerDocumentUpload({ applicationId, documentRecord, source = "upload_url_request" }) {
  const now = new Date().toISOString();
  const response = await getDocumentClient().send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: applicationKey(applicationId),
      ConditionExpression: "attribute_exists(pk)",
      UpdateExpression:
        "SET documents = list_append(if_not_exists(documents, :emptyList), :documentList), documentStatus = :documentStatus, updatedAt = :now, statusHistory = list_append(if_not_exists(statusHistory, :emptyList), :statusHistory)",
      ExpressionAttributeValues: {
        ":emptyList": [],
        ":documentList": [documentRecord],
        ":documentStatus": "upload_requested",
        ":now": now,
        ":statusHistory": buildStatusEntry(APPLICATION_STATUSES.DOCUMENT_UPLOAD_REQUESTED, source, `Document upload prepared for ${documentRecord.documentType}.`, now),
      },
      ReturnValues: "ALL_NEW",
    }),
  );

  return response.Attributes;
}

export async function updateNotificationStatus(applicationId, notificationPatch) {
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

  const response = await getDocumentClient().send(
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

export async function scanPaidApplications() {
  let lastEvaluatedKey;
  const items = [];

  do {
    const response = await getDocumentClient().send(
      new ScanCommand({
        TableName: getTableName(),
        FilterExpression: "entityType = :entityType",
        ExpressionAttributeValues: {
          ":entityType": "pilot_application",
        },
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    items.push(...(response.Items || []));
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}
