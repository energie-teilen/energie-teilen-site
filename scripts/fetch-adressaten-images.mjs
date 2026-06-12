#!/usr/bin/env node
/**
 * Downloads on-theme images for Section 06 (Adressaten) via the official
 * Unsplash API → client/public/adressaten/, regenerates the manifest, writes
 * CREDITS. Theme: people, advisory, planning — NOT rooftops.
 *   UNSPLASH_ACCESS_KEY=xxxxx node scripts/fetch-adressaten-images.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const KEY = process.env.UNSPLASH_ACCESS_KEY;
if (!KEY) { console.error("✗ UNSPLASH_ACCESS_KEY not set."); process.exit(1); }

const QUERIES = [
  "business people reviewing blueprints",
  "architects meeting table plans",
  "professional advisory office meeting",
  "engineers discussing documents",
  "real estate developers meeting",
  "municipal planning meeting people",
  "corporate handshake office",
  "consultants documents table discussion",
];
const PER_QUERY = 1, TARGET_W = 1400;
const OUT_DIR = join("client", "public", "adressaten");
const MANIFEST = join("client", "src", "lib", "adressaten-images.ts");
const api = (p) => fetch(`https://api.unsplash.com${p}`, {
  headers: { Authorization: `Client-ID ${KEY}`, "Accept-Version": "v1" },
});

const picked = [], seen = new Set();
await mkdir(OUT_DIR, { recursive: true });
for (const q of QUERIES) {
  const res = await api(`/search/photos?query=${encodeURIComponent(q)}&orientation=landscape&content_filter=high&per_page=5`);
  if (!res.ok) { console.error(`✗ "${q}": ${res.status}`); continue; }
  const data = await res.json();
  let kept = 0;
  for (const photo of data.results ?? []) {
    if (kept >= PER_QUERY) break;
    if (seen.has(photo.id)) continue;
    seen.add(photo.id); picked.push(photo); kept++;
  }
}
if (!picked.length) { console.error("✗ No photos. Check key/quota."); process.exit(1); }

const manifest = [];
for (const photo of picked) {
  try { await api(`/photos/${photo.id}/download`); } catch {}
  const url = `${photo.urls.raw}&w=${TARGET_W}&q=80&fm=webp&fit=crop&auto=format`;
  const bin = await fetch(url);
  if (!bin.ok) { console.error(`✗ download ${photo.id}: ${bin.status}`); continue; }
  const file = `${photo.id}.webp`;
  await writeFile(join(OUT_DIR, file), Buffer.from(await bin.arrayBuffer()));
  const author = photo.user?.name ?? "Unknown";
  manifest.push({ src: `/adressaten/${file}`, alt: "Professionelle Zusammenarbeit im Kontext lokaler Energieprojekte", credit: `Foto: ${author} / Unsplash`, link: photo.links?.html });
  console.log(`✓ ${file} — ${author}`);
}
const ts = `import type { HeroImage } from "@/lib/hero-images";\n\nexport const ADRESSATEN_IMAGES: readonly HeroImage[] = ${JSON.stringify(manifest.map(({src,alt,credit})=>({src,alt,credit})), null, 2)};\n`;
await writeFile(MANIFEST, ts);
await writeFile(join(OUT_DIR, "CREDITS.md"), `# Adressaten image credits\n\nUnsplash License (https://unsplash.com/license).\n\n${manifest.map(m=>`- [${m.alt}](${m.link}) — ${m.credit}`).join("\n")}\n`);
console.log(`\n✓ ${manifest.length} images → ${OUT_DIR}\n✓ manifest → ${MANIFEST}`);
