import { useState } from "react";

const OFFERS = [
  {
    offerCode: "et_eligibility",
    title: "Pilot Eligibility Check",
    subtitle: "Fast project qualification for one site or project concept.",
  },
  {
    offerCode: "et_structuring",
    title: "Pilot Structuring Package",
    subtitle: "Detailed structuring for stakeholders, documents, and rollout path.",
  },
  {
    offerCode: "et_mandate",
    title: "Full Pilot Preparation Mandate",
    subtitle: "Hands-on implementation preparation and operating support.",
  },
] as const;

export function PilotOfferCards() {
  const [loadingCode, setLoadingCode] = useState<string | null>(null);

  async function startCheckout(offerCode: string) {
    setLoadingCode(offerCode);
    const response = await fetch("/api/pilot-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offerCode,
        projectType: "local_energy_project",
        name: "",
        email: "",
      }),
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "Checkout failed");
    window.location.href = payload.checkoutUrl;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {OFFERS.map((offer) => (
        <button key={offer.offerCode} onClick={() => startCheckout(offer.offerCode)} disabled={loadingCode === offer.offerCode}>
          <h3>{offer.title}</h3>
          <p>{offer.subtitle}</p>
          <span>{loadingCode === offer.offerCode ? "Opening checkout…" : "Start paid intake"}</span>
        </button>
      ))}
    </div>
  );
}
