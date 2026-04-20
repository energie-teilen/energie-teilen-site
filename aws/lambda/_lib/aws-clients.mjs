import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SESClient } from "@aws-sdk/client-ses";

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

let dynamoDocumentClient;
let sesClient;

export function getTableName() {
  return getRequiredEnv("ET_PILOT_APPLICATIONS_TABLE");
}

export function getDynamoDocumentClient() {
  if (!dynamoDocumentClient) {
    const dynamoClient = new DynamoDBClient({ region: getRequiredEnv("AWS_REGION") });
    dynamoDocumentClient = DynamoDBDocumentClient.from(dynamoClient, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
  }

  return dynamoDocumentClient;
}

export function getSesClient() {
  if (!sesClient) {
    sesClient = new SESClient({ region: getRequiredEnv("AWS_REGION") });
  }

  return sesClient;
}

export function getFromEmail() {
  return getRequiredEnv("ET_FROM_EMAIL");
}

export function getInternalNotificationEmail() {
  return getRequiredEnv("ET_INTERNAL_NOTIFICATION_EMAIL");
}
