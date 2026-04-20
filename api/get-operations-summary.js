import { requireAdminRequest } from "./_lib/auth.js";
import { scanPaidApplications } from "./_lib/dynamo.js";
import { createRequestContext, logError, logInfo } from "./_lib/logging.js";
import { errorResponse, ok, requireMethod } from "./_lib/http.js";

function summarizeRevenue(applications) {
  return applications.reduce((accumulator, application) => {
    const currency = (application.currency || "eur").toLowerCase();
    accumulator[currency] = (accumulator[currency] || 0) + Number(application.amountPaid || 0);
    return accumulator;
  }, {});
}

function summarizeBy(fieldName, applications) {
  return applications.reduce((accumulator, application) => {
    const key = application[fieldName] || "unknown";
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["GET"])) {
    return;
  }

  if (!requireAdminRequest(req, res)) {
    return;
  }

  try {
    const applications = await scanPaidApplications();
    const sortedApplications = [...applications].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));

    logInfo("Operations summary generated.", {
      ...createRequestContext(req),
      applicationCount: applications.length,
    });

    return ok(res, {
      ok: true,
      generatedAt: new Date().toISOString(),
      totals: {
        applications: applications.length,
        revenueMinorByCurrency: summarizeRevenue(applications),
        statusDistribution: summarizeBy("status", applications),
        intakeStatusDistribution: summarizeBy("intakeStatus", applications),
        offerDistribution: summarizeBy("offerCode", applications),
      },
      recentApplications: sortedApplications.slice(0, 25).map((application) => ({
        applicationId: application.applicationId,
        createdAt: application.createdAt,
        updatedAt: application.updatedAt,
        paidAt: application.paidAt,
        offerCode: application.offerCode,
        offerLabel: application.offerLabel,
        status: application.status,
        intakeStatus: application.intakeStatus,
        documentStatus: application.documentStatus,
        amountPaid: application.amountPaid,
        currency: application.currency,
        email: application.email,
        name: application.name,
        organization: application.organization,
        location: application.location,
        projectType: application.projectType,
      })),
    });
  } catch (error) {
    logError("Failed to generate operations summary.", {
      ...createRequestContext(req),
      error,
    });

    return errorResponse(
      res,
      error instanceof Error && error.message.startsWith("Missing required environment variable:") ? 500 : 400,
      error instanceof Error && error.message.startsWith("Missing required environment variable:") ? "backend_misconfigured" : "operations_summary_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}
