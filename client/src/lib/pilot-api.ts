export type PilotOfferCode = "et_eligibility" | "et_structuring" | "et_mandate";

export async function createPilotCheckout(input: {
  offerCode: PilotOfferCode;
  projectType: string;
  name: string;
  email: string;
  phone?: string;
  organization?: string;
  location?: string;
  legalAcceptances?: {
    privacyPolicyAccepted?: boolean;
    pilotTermsAccepted?: boolean;
    marketingConsent?: boolean;
  };
}) {
  const response = await fetch("/api/pilot-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || "pilot_checkout_failed");
  return payload;
}
