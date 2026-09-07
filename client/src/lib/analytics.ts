/**
 * client/src/lib/analytics.ts
 *
 * Funnel instrumentation over Plausible.
 *
 * Loads the script itself so the `window.plausible` queue stub exists before
 * any event fires, and resolves the reporting domain from
 * VITE_PLAUSIBLE_DOMAIN with the current hostname as fallback.
 *
 * Rules this module enforces:
 *   - No personal data. Event properties are enums, counts and booleans;
 *     sanitiseProps() drops free text, emails, phone numbers and postcodes.
 *   - Never throws into a render path.
 *   - Respects Do Not Track.
 */

// ============================================================================
// EVENTS — the funnel, named once
// ============================================================================

export const ANALYTICS_EVENTS = [
  /** Visitor actually moved a calculator input (not just loaded the page). */
  "calculator_used",
  /** The eligibility engine produced a verdict the visitor can see. */
  "eligibility_verdict",
  /** A specific paid tier was recommended. */
  "next_step_shown",
  /** Visitor clicked through from the recommendation to the pilot section. */
  "next_step_clicked",
  /** Email submitted, PDF generated. */
  "lead_captured",
  /** Stripe Checkout session requested. */
  "checkout_started",
  /** Returned from Stripe with a settled payment. */
  "checkout_succeeded",
  /** Returned from Stripe having abandoned. */
  "checkout_canceled",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

export type AnalyticsProps = Record<string, string | number | boolean>;

// ============================================================================
// PROPERTY SANITISATION — the privacy boundary
// ============================================================================

/** Anything longer than this is free text, not a category. */
const MAX_VALUE_LENGTH = 40;
const MAX_PROPS = 8;

/** Values that must never leave the browser as an analytics property. */
const PII_PATTERNS: RegExp[] = [
  /@/, // email addresses
  /\+?\d[\d\s/()-]{7,}/, // phone numbers
  /\b\d{5}\b/, // German postal codes
];

/**
 * Reduce arbitrary props to safe, low-cardinality categories.
 *
 * Deliberately strict: an unknown-shaped value is dropped rather than
 * truncated, because a truncated address is still an address.
 */
export function sanitiseProps(props?: AnalyticsProps): AnalyticsProps {
  if (!props) return {};
  const out: AnalyticsProps = {};

  for (const [key, value] of Object.entries(props)) {
    if (Object.keys(out).length >= MAX_PROPS) break;
    if (value === null || value === undefined) continue;

    if (typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) continue;
      out[key] = value;
      continue;
    }
    if (typeof value !== "string") continue;

    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_VALUE_LENGTH) continue;
    if (PII_PATTERNS.some((p) => p.test(trimmed))) continue;
    out[key] = trimmed;
  }

  return out;
}

// ============================================================================
// TRANSPORT
// ============================================================================

type PlausibleFn = ((event: string, options?: { props?: AnalyticsProps }) => void) & {
  q?: unknown[];
};

type WindowWithPlausible = Window & { plausible?: PlausibleFn };

function w(): WindowWithPlausible | null {
  return typeof window === "undefined" ? null : (window as WindowWithPlausible);
}

/** Do Not Track, in the three shapes browsers have used for it. */
export function doNotTrackEnabled(): boolean {
  const win = w();
  if (!win) return false;
  const nav = win.navigator as Navigator & { msDoNotTrack?: string };
  const signals = [nav?.doNotTrack, (win as unknown as { doNotTrack?: string }).doNotTrack, nav?.msDoNotTrack];
  return signals.some((s) => s === "1" || s === "yes");
}

export function analyticsDomain(): string {
  const configured = import.meta.env?.VITE_PLAUSIBLE_DOMAIN as string | undefined;
  if (configured && configured.trim().length > 0) return configured.trim();
  // Falling back to the actual host is correct on the custom domain; on any
  // other host Plausible ignores the events rather than attributing them
  // elsewhere.
  return w()?.location?.hostname ?? "";
}

let initialised = false;

/**
 * Install the queue stub and load Plausible. The stub must exist before any
 * track() call. Idempotent; safe to call from a React effect.
 */
export function initAnalytics(): void {
  const win = w();
  if (!win || initialised) return;
  initialised = true;

  if (doNotTrackEnabled()) return;

  // Queue stub: calls made before the script loads are replayed, not lost.
  if (typeof win.plausible !== "function") {
    const stub = function (...args: unknown[]) {
      (stub.q = stub.q || []).push(args);
    } as unknown as PlausibleFn;
    win.plausible = stub;
  }

  const domain = analyticsDomain();
  if (!domain) return;

  try {
    const existing = win.document.querySelector('script[data-analytics="plausible"]');
    if (existing) return;
    const el = win.document.createElement("script");
    el.defer = true;
    el.setAttribute("data-domain", domain);
    el.setAttribute("data-analytics", "plausible");
    el.src = "https://plausible.io/js/script.js";
    win.document.head.appendChild(el);
  } catch {
    // A blocked or failed script must never surface to the visitor.
  }
}

/**
 * Record a funnel event. Never throws.
 *
 * Props are sanitised before they leave; see sanitiseProps().
 */
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  const win = w();
  if (!win || doNotTrackEnabled()) return;
  try {
    const fn = win.plausible;
    if (typeof fn !== "function") return;
    const safe = sanitiseProps(props);
    if (Object.keys(safe).length === 0) fn(event);
    else fn(event, { props: safe });
  } catch {
    // Analytics must not be able to break a render path.
  }
}

/** Test seam. */
export function resetAnalyticsForTests(): void {
  initialised = false;
}
