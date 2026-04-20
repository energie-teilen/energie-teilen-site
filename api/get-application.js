import { isAdminRequest } from "./_lib/auth.js";
import { getApplicationById, getApplicationBySessionId } from "./_lib/dynamo.js";
import { createRequestContext, logError, logInfo } from "./_lib/logging.js";
import { errorResponse, getQueryParam, normalizeEmail, ok, requireMethod } from "./_lib/http.js";

function buildPublicApplicationView(application) {
  return {
    applicationId: application.applicationId,
    stripeSessionId: application.stripeSessionId,
    status: application.status,
    stage: application.stage,
    intakeStatus: application.intakeStatus,
    documentStatus: application.documentStatus,
    offerCode: application.offerCode,
    offerLabel: application.offerLabel,
    projectType: application.projectType,
    email: application.email,
    name: application.name,
    phone: application.phone,
    location: application.location,
    organization: application.organization,
    amountPaid: application.amountPaid,
    currency: application.currency,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    paidAt: application.paidAt,
    intakeSubmittedAt: application.intakeSubmittedAt,
    documents: Array.isArray(application.documents)
      ? application.documents.map((document) => ({
          documentId: document.documentId,
          documentType: document.documentType,
          fileName: document.fileName,
          status: document.status,
          requestedAt: document.requestedAt,
        }))
      : [],
    statusHistory: application.statusHistory || [],
  };
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["GET"])) {
    return;
  }

  try {
    const adminRequest = isAdminRequest(req);
    const applicationId = getQueryParam(req, "applicationId");
    const sessionId = getQueryParam(req, "sessionId");

    if (!applicationId && !sessionId) {
      return errorResponse(res, 400, "missing_identifier", "Provide either applicationId or sessionId.");
    }

    const application = applicationId ? await getApplicationById(applicationId) : await getApplicationBySessionId(sessionId);

    if (!application) {
      return errorResponse(res, 404, "application_not_found", "No application matches the supplied identifier.");
    }

    if (!adminRequest) {
      const email = normalizeEmail(getQueryParam(req, "email"));
      if (application.emailNormalized !== email) {
        return errorResponse(res, 403, "forbidden", "The supplied email does not match the application.");
      }
    }

    logInfo("Application retrieved.", {
      ...createRequestContext(req),
      applicationId: application.applicationId,
      accessMode: adminRequest ? "admin" : "applicant",
    });

    return ok(res, {
      ok: true,
      application: adminRequest ? application : buildPublicApplicationView(application),
    });
  } catch (error) {
    logError("Failed to retrieve application.", {
      ...createRequestContext(req),
      error,
    });

    return errorResponse(
      res,
      error instanceof Error && error.message.startsWith("Missing required environment variable:") ? 500 : 400,
      error instanceof Error && error.message.startsWith("Missing required environment variable:") ? "backend_misconfigured" : "invalid_application_request",
      error instanceof Error ? error.message : String(error),
    );
  }
}
