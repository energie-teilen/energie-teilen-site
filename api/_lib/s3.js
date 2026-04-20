import { randomUUID } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getRequiredEnv } from "./pilot-products.js";

const DEFAULT_MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;
let s3Client;

function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({ region: getRequiredEnv("AWS_REGION") });
  }

  return s3Client;
}

function sanitizeFileName(fileName) {
  return String(fileName || "document")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function getUploadTtlSeconds() {
  const rawValue = process.env.ET_UPLOAD_URL_TTL_SECONDS || "900";
  const ttl = Number(rawValue);
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 3600) {
    throw new Error("ET_UPLOAD_URL_TTL_SECONDS must be a positive number up to 3600.");
  }
  return ttl;
}

export function buildDocumentObjectKey({ applicationId, documentType, fileName }) {
  const safeFileName = sanitizeFileName(fileName) || "document";
  return `pilot-applications/${applicationId}/${documentType}/${Date.now()}-${randomUUID()}-${safeFileName}`;
}

export async function createDocumentUploadTarget({
  applicationId,
  documentType,
  fileName,
  contentType,
  maxUploadSizeBytes = DEFAULT_MAX_UPLOAD_SIZE_BYTES,
}) {
  const bucket = getRequiredEnv("ET_DOCUMENTS_BUCKET");
  const expiresIn = getUploadTtlSeconds();
  const key = buildDocumentObjectKey({ applicationId, documentType, fileName });

  const presigned = await createPresignedPost(getS3Client(), {
    Bucket: bucket,
    Key: key,
    Expires: expiresIn,
    Fields: {
      "Content-Type": contentType,
    },
    Conditions: [
      ["content-length-range", 1, maxUploadSizeBytes],
      { "Content-Type": contentType },
    ],
  });

  return {
    bucket,
    key,
    url: presigned.url,
    fields: presigned.fields,
    expiresIn,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    maxUploadSizeBytes,
  };
}
