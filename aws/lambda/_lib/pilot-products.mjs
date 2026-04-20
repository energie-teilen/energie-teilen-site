const PRODUCTS = {
  et_eligibility: {
    offerCode: "et_eligibility",
    offerLabel: "Pilot Eligibility Check",
    envKey: "ENERGIE_TEILEN_ELIGIBILITY_PRICE_ID",
  },
  et_structuring: {
    offerCode: "et_structuring",
    offerLabel: "Pilot Structuring Package",
    envKey: "ENERGIE_TEILEN_STRUCTURING_PRICE_ID",
  },
  et_mandate: {
    offerCode: "et_mandate",
    offerLabel: "Full Pilot Preparation Mandate",
    envKey: "ENERGIE_TEILEN_MANDATE_PRICE_ID",
  },
};

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function resolvePilotProduct(offerCode) {
  const normalized = typeof offerCode === "string" ? offerCode.trim() : "";
  const product = PRODUCTS[normalized];
  if (!product) {
    throw new Error(`Unknown offer code: ${offerCode || "<empty>"}`);
  }

  return {
    ...product,
    priceId: getRequiredEnv(product.envKey),
  };
}

export function getApplicationIdFromSessionId(sessionId) {
  const normalized = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!normalized) {
    throw new Error("Stripe session ID is required.");
  }

  return `etapp_${normalized.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`;
}
