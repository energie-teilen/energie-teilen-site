/**
 * scripts/doctor.ts — the go-live gate.
 *
 * The funnel can be deployed in full and still take zero euros, because what
 * stops it is configuration, not code. This reads /api/health and prints the
 * scoreboard: what is missing, what it costs while it stays missing, and the
 * exact fix — revenue blockers first, then fulfilment gaps, then optional
 * surfaces.
 *
 * All judgement lives in shared/health.ts, the same register the endpoint is
 * built from; this file only fetches and prints. It never sees a secret:
 * /api/health reports presence, not values.
 *
 *   pnpm doctor                         # APP_URL if set, else the public host
 *   pnpm doctor http://localhost:3000
 *
 * Exit codes (DOCTOR_EXIT):
 *   0  no revenue blocker (fulfilment gaps are printed, not failed)
 *   1  at least one revenue blocker — money cannot move
 *   2  site unreachable, or it answered without a scoreboard
 */

import {
  DOCTOR_EXIT,
  doctorExitCode,
  parseHealthReport,
  renderDoctorReport,
} from "../shared/health.js";
import { siteOrigin } from "../shared/routes.js";

const TIMEOUT_MS = 15_000;

async function main(): Promise<number> {
  const base = (process.argv[2] || siteOrigin()).replace(/\/+$/, "");
  process.stdout.write(`Prüfe ${base}/api/health …\n\n`);

  let body: unknown;
  try {
    const res = await fetch(`${base}/api/health?cb=${Date.now()}`, {
      headers: { "cache-control": "no-cache", accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
  } catch (err) {
    process.stdout.write(`Website nicht erreichbar: ${String(err)}\n`);
    process.stdout.write("Ist sie deployt, und stimmt die Adresse?\n");
    return DOCTOR_EXIT.unreachable;
  }

  const report = parseHealthReport(body);
  if (!report) {
    process.stdout.write(
      "Die Website antwortet, aber ohne Scoreboard. Vermutlich läuft ein Deployment von vor diesem Stand — neu deployen und erneut prüfen.\n",
    );
    return DOCTOR_EXIT.unreachable;
  }

  for (const line of renderDoctorReport(report, base)) process.stdout.write(`${line}\n`);
  return doctorExitCode(report);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stdout.write(`Doctor ist abgebrochen: ${String(err)}\n`);
    process.exit(DOCTOR_EXIT.unreachable);
  },
);
