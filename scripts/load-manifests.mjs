/**
 * scripts/load-manifests.mjs
 *
 * Loads the TypeScript manifests by executing them.
 *
 * The build scripts used to read these files with regular expressions. That
 * works until a manifest is reformatted, and then the generated documents
 * quietly describe something other than what the application serves — which is
 * the one failure a generated index must not have, because nothing downstream
 * can detect it. Bundling the real modules costs a second and removes the
 * whole class.
 */

import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { build } from "esbuild";

let cached = null;

export async function loadManifests() {
  if (cached) return cached;

  // Inside the project, so Node resolves the bundle's external imports against
  // this package's own node_modules.
  const cacheDir = join(process.cwd(), "node_modules", ".cache");
  const outfile = join(cacheDir, `et-manifests-${process.pid}.mjs`);
  mkdirSync(cacheDir, { recursive: true });

  await build({
    entryPoints: [join(process.cwd(), "scripts", "manifest-entry.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile,
    logLevel: "silent",
  });

  try {
    cached = await import(`file://${outfile}`);
    return cached;
  } finally {
    rmSync(outfile, { force: true });
  }
}
