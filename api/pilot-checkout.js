import { createRequestContext, logError, logInfo } from "./_lib/logging.js";
import {
  asTrimmedString,
  errorResponse,
  normalizeBoolean,
  normalizeEmail,
  normalizePhone,
  ok,
  readJsonBody,
  requireMethod,
  requireNonEmptyString,
} from "./_lib/http.js";
import { assertNoClientPricing, resolvePilotProduct } from "./_lib/pilot-products.js";
import { createPilotCheckoutSession } from "./_lib/stripe.js";

function getStatusCode(message) {
  if (message.startsWith("Missing required environment variable:")) {
    return 500;
  }

  if (message.startsWith("Unknown offer code:")) {
    return 400;
  }

  return 400;
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) {
    return;
  }

  try {
    const body = await readJsonBody(req);
    assertNoClientPricing(body);

    const offerCode = requireNonEmptyString(body.offerCode, "offerCode", { maxLength: 64 });
    const projectType = requireNonEmptyString(body.projectType, "projectType", { maxLength: 120 });
    const contact = {
      email: normalizeEmail(body.email),
      name: requireNonEmptyString(body.name, "name", { maxLength: 120 }),
      phone: normalizePhone(body.phone),
      location: asTrimmedString(body.location, { maxLength: 180 }),
      organization: asTrimmedString(body.organization, { maxLength: 180 }),
    };

    const legalAcceptances = {
      privacyPolicyAccepted: normalizeBoolean(body?.legalAcceptances?.privacyPolicyAccepted),
      pilotTermsAccepted: normalizeBoolean(body?.legalAcceptances?.pilotTermsAccepted),
      marketingConsent: normalizeBoolean(body?.legalAcceptances?.marketingConsent),
    };

    const product = resolvePilotProduct(offerCode);
    const session = await createPilotCheckoutSession({
      product,
      contact,
      projectType,
      stage: "checkout_created",
      legalAcceptances,
    });

    logInfo("Pilot checkout session created.", {
      ...createRequestContext(req),
      offerCode: product.offerCode,
      projectType,
      stripeSessionId: session.id,
      email: contact.email,
    });

    return ok(res, {
      ok: true,
      checkoutUrl: session.url,
      sessionId: session.id,
      offerCode: product.offerCode,
      offerLabel: product.offerLabel,
      projectType,
      currency: session.currency,
      stage: "checkout_created",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    logError("Failed to create pilot checkout session.", {
      ...createRequestContext(req),
      error,
    });

    return errorResponse(
      res,
      getStatusCode(message),
      message.startsWith("Missing required environment variable:") ? "backend_misconfigured" : "invalid_checkout_request",
      message,
    );
  }
}
