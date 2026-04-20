import { isAdminRequest } from "./_lib/auth.js";
import { getApplicationById, updateApplicationIntake } from "./_lib/dynamo.js";
import { createRequestContext, logError, logInfo } from "./_lib/logging.js";
import {
  asTrimmedString,
  errorResponse,
  normalizeBoolean,
  normalizeEmail,
  ok,
  readJsonBody,
  requireMethod,
  requireNonEmptyString,
} from "./_lib/http.js";

function normalizeStringList(value, maxItems = 12, maxLength = 180) {
  if (Array.isArray(value)) {
    return value.map((entry) => asTrimmedString(entry, { maxLength })).filter(Boolean).slice(0, maxItems);
  }

  const single = asTrimmedString(value, { maxLength });
  return single ? [single] : [];
}

function buildPublicApplicationView(application) {
  return {
    applicationId: application.applicationId,
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
    intakeSubmittedAt: application.intakeSubmittedAt,
    updatedAt: application.updatedAt,
  };
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) {
    return;
  }

  try {
    const body = await readJsonBody(req);
    const applicationId = requireNonEmptyString(body.applicationId, "applicationId", { maxLength: 120 });
    const adminRequest = isAdminRequest(req);
    const callerEmail = adminRequest ? "" : normalizeEmail(body.email);
    const application = await getApplicationById(applicationId);

    if (!application) {
      return errorResponse(res, 404, "application_not_found", "No paid application exists for the supplied applicationId.");
    }

    if (!adminRequest && application.emailNormalized !== callerEmail) {
      return errorResponse(res, 403, "forbidden", "The supplied email does not match the paid application.");
    }

    const legalAcceptances = {
      privacyPolicyAccepted: normalizeBoolean(body?.legalAcceptances?.privacyPolicyAccepted),
      pilotTermsAccepted: normalizeBoolean(body?.legalAcceptances?.pilotTermsAccepted),
      authorityConfirmed: normalizeBoolean(body?.legalAcceptances?.authorityConfirmed),
      dataAccuracyConfirmed: normalizeBoolean(body?.legalAcceptances?.dataAccuracyConfirmed),
    };

    if (!legalAcceptances.privacyPolicyAccepted || !legalAcceptances.pilotTermsAccepted) {
      return errorResponse(res, 400, "missing_legal_acceptance", "Privacy policy acceptance and pilot terms acceptance are required.");
    }

    const intake = {
      propertyType: requireNonEmptyString(body.propertyType, "propertyType", { maxLength: 120 }),
      ownershipStructure: requireNonEmptyString(body.ownershipStructure, "ownershipStructure", { maxLength: 180 }),
      currentSupplyArrangement: requireNonEmptyString(body.currentSupplyArrangement, "currentSupplyArrangement", { maxLength: 240 }),
      assetProfile: normalizeStringList(body.assetProfile),
      stakeholderMap: normalizeStringList(body.stakeholderMap),
      goals: normalizeStringList(body.goals),
      constraints: normalizeStringList(body.constraints),
      notes: asTrimmedString(body.notes, { maxLength: 5000 }),
      desiredTimeline: asTrimmedString(body.desiredTimeline, { maxLength: 180 }),
      submittedBy: adminRequest ? "admin" : "applicant",
    };

    const updatedApplication = await updateApplicationIntake({
      applicationId,
      intake,
      legalAcceptances,
      source: adminRequest ? "admin_intake" : "frontend_intake",
    });

    logInfo("Pilot intake submitted.", {
      ...createRequestContext(req),
      applicationId,
      submittedBy: adminRequest ? "admin" : callerEmail,
    });

    return ok(res, {
      ok: true,
      application: buildPublicApplicationView(updatedApplication),
    });
  } catch (error) {
    logError("Failed to submit pilot intake.", {
      ...createRequestContext(req),
      error,
    });

    return errorResponse(
      res,
      error instanceof Error && error.message.startsWith("Missing required environment variable:") ? 500 : 400,
      error instanceof Error && error.message.startsWith("Missing required environment variable:") ? "backend_misconfigured" : "invalid_intake_request",
      error instanceof Error ? error.message : String(error),
    );
  }
}
