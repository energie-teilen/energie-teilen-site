import Stripe from "stripe";
import { getRequiredEnv } from "./pilot-products.js";

let stripeClient;

export function getStripeClient() {
  if (!stripeClient) {
    stripeClient = new Stripe(getRequiredEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2025-03-31.basil",
    });
  }

  return stripeClient;
}

export function getStripeWebhookSecret() {
  return getRequiredEnv("STRIPE_WEBHOOK_SECRET");
}

export function getAppBaseUrl() {
  return getRequiredEnv("APP_BASE_URL").replace(/\/$/, "");
}

export async function createPilotCheckoutSession({
  product,
  contact,
  projectType,
  stage,
  legalAcceptances,
}) {
  const baseUrl = getAppBaseUrl();
  const stripe = getStripeClient();

  return stripe.checkout.sessions.create({
    mode: "payment",
    locale: "de",
    success_url: `${baseUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/?checkout=cancel&offer_code=${encodeURIComponent(product.offerCode)}`,
    payment_method_types: ["card"],
    billing_address_collection: "auto",
    customer_email: contact.email,
    phone_number_collection: { enabled: true },
    line_items: [
      {
        price: product.priceId,
        quantity: 1,
      },
    ],
    metadata: {
      offer_code: product.offerCode,
      offer_label: product.offerLabel,
      stage,
      project_type: projectType,
      email: contact.email,
      name: contact.name,
      phone: contact.phone,
      location: contact.location,
      organization: contact.organization,
      legal_privacy_accepted: String(Boolean(legalAcceptances?.privacyPolicyAccepted)),
      legal_terms_accepted: String(Boolean(legalAcceptances?.pilotTermsAccepted)),
      legal_marketing_consent: String(Boolean(legalAcceptances?.marketingConsent)),
    },
  });
}

export function constructWebhookEvent(rawBody, signature) {
  return getStripeClient().webhooks.constructEvent(rawBody, signature, getStripeWebhookSecret());
}
