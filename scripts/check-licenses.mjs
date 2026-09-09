/**
 * scripts/check-licenses.mjs
 *
 * Reads the licence inventory pnpm produces and fails on anything outside the
 * permitted set.
 *
 * The point is not licence purity for its own sake: a copyleft dependency
 * pulled in transitively can impose obligations on the whole distributed
 * product, and that is not a thing to discover after a customer's legal team
 * asks for the inventory.
 */

import { readFileSync, existsSync } from "fs";

const PERMITTED = new Set([
  "MIT",
  "MIT*",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "CC0-1.0",
  "CC-BY-4.0",
  "Unlicense",
  "Python-2.0",
  "BlueOak-1.0.0",
  "OFL-1.1",
  "MPL-2.0",
  // Permissive, BSD-like; used by pako, which jspdf pulls in for compression.
  "Zlib",
]);

const FILE = "licenses.json";

if (!existsSync(FILE)) {
  console.error(`${FILE} not found — run: pnpm licenses list --prod --json > ${FILE}`);
  process.exit(1);
}

const raw = JSON.parse(readFileSync(FILE, "utf8"));

/** pnpm emits an object keyed by licence, or an array; handle both. */
const entries = Array.isArray(raw)
  ? raw.map((p) => [p.license ?? "UNKNOWN", [p]])
  : Object.entries(raw);

/**
 * Evaluate an SPDX expression against the permitted set.
 *
 * A naive string match rejects "(MPL-2.0 OR Apache-2.0)" and "MIT AND ISC",
 * both of which are perfectly acceptable — and the usual response to that is
 * to paste the whole expression into the allowlist, which then also permits
 * any future package that happens to declare the same string. Evaluating the
 * expression keeps the decision about individual licences.
 *
 * OR  — satisfied when at least one operand is permitted (we may choose it).
 * AND — satisfied only when every operand is permitted (all apply).
 */
function spdxPermitted(expression) {
  const expr = String(expression || "").trim();
  if (expr.length === 0) return false;

  const inner = expr.replace(/^\((.*)\)$/s, "$1").trim();

  if (/\sOR\s/i.test(inner)) {
    return inner.split(/\sOR\s/i).some((part) => spdxPermitted(part));
  }
  if (/\sAND\s/i.test(inner)) {
    return inner.split(/\sAND\s/i).every((part) => spdxPermitted(part));
  }
  return PERMITTED.has(inner.replace(/\+$/, ""));
}

const offenders = [];
const undeclared = [];
for (const [license, packages] of entries) {
  if (spdxPermitted(license)) continue;
  for (const p of packages) {
    const id = `${p.name ?? "?"}@${(p.versions ?? [p.version]).join(",")}`;
    if (!license || license === "Unknown" || license === "UNKNOWN") undeclared.push(id);
    else offenders.push(`${id} — ${license}`);
  }
}

if (undeclared.length > 0) {
  console.error("Dependencies that declare no licence in their package.json:\n");
  undeclared.forEach((o) => console.error("  " + o));
  console.error(
    "\nCheck the LICENSE file in each package. A package with no declared licence\n" +
      "is not automatically unlicensed, but it is not automatically usable either.",
  );
}

if (offenders.length > 0 || undeclared.length > 0) {
  console.error("Dependencies with a licence outside the permitted set:\n");
  offenders.forEach((o) => console.error("  " + o));
  console.error(
    "\nEither remove the dependency or add its licence to PERMITTED in this file,\n" +
      "deliberately and with a reason.",
  );
  process.exit(1);
}

console.log(`All production dependencies carry a permitted licence (${entries.length} licence types).`);
