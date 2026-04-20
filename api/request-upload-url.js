import { randomUUID } from "node:crypto";
import { isAdminRequest } from "./_lib/auth.js";
import { getApplicationById, registerDocumentUpload } from "./_lib/dynamo.js";
import { createRequestContext, logError, logInfo } from "./_lib/logging.js";
import { validateDocumentType } from "./_lib/pilot-products.js";
import { createDocumentUploadTarget } from "./_lib/s3.js";
import {
  asTrimmedString,
  errorResponse,
  normalizeEmail,
  ok,
  readJsonBody,
  requireMethod,
  requireNonEmptyString,
} from "./_lib/http.js";

function normalizeContentType(contentType) {
  const normalized = asTrimmedString(contentType, { maxLength: 120 }).toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(normalized)) {
    throw new Error("A valid contentType is required.");
  }
  return normalized;
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) {
    return;
  }

  try {
    const body = await readJsonBody(req);
    const adminRequest = isAdminRequest(req);
    const applicationId = requireNonEmptyString(body.applicationId, "applicationId", { maxLength: 120 });
    const callerEmail = adminRequest ? "" : normalizeEmail(body.email);
    const documentType = validateDocumentType(body.documentType);
    const fileName = requireNonEmptyString(body.fileName, "fileName", { maxLength: 180 });
    const contentType = normalizeContentType(body.contentType);
    const sizeBytes = Number(body.sizeBytes);

    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > 25 * 1024 * 1024) {
      return errorResponse(res, 400, "invalid_file_size", "sizeBytes must be a positive number up to 25 MB.");
    }

    const application = await getApplicationById(applicationId);
    if (!application) {
      return errorResponse(res, 404, "application_not_found", "No paid application exists for the supplied applicationId.");
    }

    if (!adminRequest && application.emailNormalized !== callerEmail) {
      return errorResponse(res, 403, "forbidden", "The supplied email does not match the paid application.");
    }

    const uploadTarget = await createDocumentUploadTarget({
      applicationId,
      documentType,
      fileName,
      contentType,
      maxUploadSizeBytes: 25 * 1024 * 1024,
    });

    const documentRecord = {
      documentId: `doc_${randomUUID()}`,
      documentType,
      fileName,
      contentType,
      sizeBytes,
      bucket: uploadTarget.bucket,
      s3Key: uploadTarget.key,
      status: "upload_requested",
      requestedAt: new Date().toISOString(),
      requestedBy: adminRequest ? "admin" : "applicant",
    };

    await registerDocumentUpload({
      applicationId,
      documentRecord,
      source: adminRequest ? "admin_upload_request" : "frontend_upload_request",
    });

    logInfo("Document upload target issued.", {
      ...createRequestContext(req),
      applicationId,
      documentType,
      requestedBy: adminRequest ? "admin" : callerEmail,
    });

    return ok(res, {
      ok: true,
      applicationId,
      documentId: documentRecord.documentId,
      documentType,
      upload: {
        url: uploadTarget.url,
        method: "POST",
        fields: uploadTarget.fields,
        key: uploadTarget.key,
        expiresAt: uploadTarget.expiresAt,
        maxUploadSizeBytes: uploadTarget.maxUploadSizeBytes,
      },
    });
  } catch (error) {
    logError("Failed to issue document upload target.", {
      ...createRequestContext(req),
      error,
    });

    return errorResponse(
      res,
      error instanceof Error && error.message.startsWith("Missing required environment variable:") ? 500 : 400,
      error instanceof Error && error.message.startsWith("Missing required environment variable:") ? "backend_misconfigured" : "invalid_upload_request",
      error instanceof Error ? error.message : String(error),
    );
  }
}
