const PRODUCT_DEFINITIONS = {
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

export const ALLOWED_DOCUMENT_TYPES = [
  "site_plan",
  "utility_bill",
  "ownership_proof",
  "consumption_export",
  "technical_photo",
  "stakeholder_document",
  "signed_mandate",
  "other_supporting_document",
];

export const APPLICATION_STATUSES = {
  PAYMENT_RECEIVED: "payment_received",
  INTAKE_SUBMITTED: "intake_submitted",
  DOCUMENT_UPLOAD_REQUESTED: "document_upload_requested",
};

export function listPilotProducts() {
  return Object.values(PRODUCT_DEFINITIONS).map(({ envKey, ...publicProduct }) => publicProduct);
}

export function assertNoClientPricing(payload = {}) {
  const forbiddenKeys = [
    "priceId",
    "price_id",
    "amount",
    "amountPaid",
    "unitAmount",
    "currency",
    "lineItems",
    "line_items",
  ];

  const attemptedKeys = forbiddenKeys.filter((key) => Object.prototype.hasOwnProperty.call(payload, key));
  if (attemptedKeys.length > 0) {
    throw new Error(`Client-supplied pricing is forbidden: ${attemptedKeys.join(", ")}`);
  }
}

export function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function resolvePilotProduct(offerCode) {
  const normalizedCode = typeof offerCode === "string" ? offerCode.trim() : "";
  const definition = PRODUCT_DEFINITIONS[normalizedCode];

  if (!definition) {
    throw new Error(`Unknown offer code: ${offerCode || "<empty>"}`);
  }

  return {
    ...definition,
    priceId: getRequiredEnv(definition.envKey),
  };
}

export function validateDocumentType(documentType) {
  const normalizedType = typeof documentType === "string" ? documentType.trim() : "";
  if (!ALLOWED_DOCUMENT_TYPES.includes(normalizedType)) {
    throw new Error(`Unsupported document type: ${documentType || "<empty>"}`);
  }
  return normalizedType;
}

export function getApplicationIdFromSessionId(sessionId) {
  const normalized = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!normalized) {
    throw new Error("Stripe session ID is required.");
  }

  const safe = normalized.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return `etapp_${safe}`;
}
