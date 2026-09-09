/**
 * scripts/fetch-fonts.mjs
 *
 * Downloads the two web fonts into client/public/fonts so they are served from
 * this origin instead of a third-party CDN.
 *
 * Run once, then commit the two .woff2 files:
 *
 *   pnpm fonts:fetch
 *
 * The build works without them — every family declares a full fallback stack —
 * but the intended typography only appears once they are present.
 *
 * Both fonts are under the SIL Open Font License, which permits redistribution
 * including self-hosting. The licence text is written alongside the files.
 */

import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const OUT = join(process.cwd(), "client", "public", "fonts");

const FONTS = [
  {
    name: "manrope-variable.woff2",
    // Variable weight axis 200..800; the @font-face declares 500..800.
    url: "https://cdn.jsdelivr.net/fontsource/fonts/manrope:vf@latest/latin-wght-normal.woff2",
  },
  {
    name: "ibm-plex-sans-variable.woff2",
    url: "https://cdn.jsdelivr.net/fontsource/fonts/ibm-plex-sans:vf@latest/latin-wght-normal.woff2",
  },
];

const LICENCE = `The fonts in this directory are licensed under the SIL Open Font
License, Version 1.1, which permits redistribution and self-hosting.

  Manrope        — https://github.com/sharanda/manrope
  IBM Plex Sans  — https://github.com/IBM/plex

Refreshed with: pnpm fonts:fetch
`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "LICENSE.txt"), LICENCE);

  let failures = 0;
  for (const font of FONTS) {
    const target = join(OUT, font.name);
    process.stdout.write(`→ ${font.name} … `);
    try {
      const res = await fetch(font.url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // A truncated or error-page download would silently break rendering.
      if (buf.length < 5_000) throw new Error(`suspiciously small (${buf.length} bytes)`);
      if (buf.subarray(0, 4).toString("latin1") !== "wOF2") {
        throw new Error("not a woff2 file");
      }
      writeFileSync(target, buf);
      console.log(`ok (${(buf.length / 1024).toFixed(0)} kB)`);
    } catch (err) {
      failures++;
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failures > 0) {
    console.error(
      `\n${failures} font(s) could not be downloaded. The site still builds and reads\n` +
        `correctly using the fallback stack; re-run this script from a network that\n` +
        `can reach the CDN to restore the intended typography.`,
    );
    process.exitCode = 1;
    return;
  }

  const present = FONTS.every((f) => existsSync(join(OUT, f.name)));
  console.log(present ? "\nAll fonts present." : "\nSome fonts are missing.");
}

main();
