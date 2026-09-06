/**
 * client/src/lib/rechner-context.ts
 *
 * Reads back what the visitor did in the calculator, so the checkout form —
 * which lives in a different section of the page and shares no state with it —
 * can tag the order with the verdict it converted from.
 *
 * Without this the funnel breaks exactly where it matters: you would know how
 * many people saw REQUIRES_REVIEW and how many people paid, but never which
 * verdicts the payers came from. That is the one join that turns the
 * qualification gate from a feature into a decision.
 *
 * Best-effort by design: localStorage may be unavailable or stale, in which
 * case the order is simply untagged rather than wrongly tagged.
 */

import {
  QualificationFactsSchema,
  evaluateEligibility,
  type EligibilityVerdict,
} from "../../../shared/eligibility";
import { MieterstromInputsSchema } from "../../../shared/schema";
import { calculateMieterstrom } from "./mieterstrom";

const INPUTS_KEY = "et:rechner:v1";
const FACTS_KEY = "et:rechner:facts:v1";

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * The verdict the visitor last saw, or null if they never used the calculator
 * (or the stored state no longer parses against the current schema).
 */
export function lastEligibilityVerdict(): EligibilityVerdict | null {
  const inputs = MieterstromInputsSchema.safeParse(readJson(INPUTS_KEY));
  if (!inputs.success) return null;

  const facts = QualificationFactsSchema.safeParse(readJson(FACTS_KEY) ?? {});
  try {
    return evaluateEligibility({
      economics: inputs.data,
      kpis: calculateMieterstrom(inputs.data).kpis,
      facts: facts.success ? facts.data : {},
    }).verdict;
  } catch {
    return null;
  }
}
