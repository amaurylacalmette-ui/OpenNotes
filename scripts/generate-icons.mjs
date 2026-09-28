#!/usr/bin/env node
/**
 * Generates all OpenNotes PWA icons from an inline SVG design.
 * Usage: node scripts/generate-icons.mjs   (requires deps installed first)
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "icons");
mkdirSync(outDir, { recursive: true });

/** Rounded-corner design for normal icons (transparent corners). */
const roundedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a06a3c"/>
      <stop offset="1" stop-color="#74481f"/>
    </linearGradient>
    <linearGradient id="spine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="rgba(0,0,0,0.30)"/>
      <stop offset="1" stop-color="rgba(0,0,0,0.12)"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <rect x="64" y="0" width="44" height="512" fill="url(#spine)"/>
  <rect x="108" y="0" width="8" height="512" fill="rgba(0,0,0,0.22)"/>
  <rect x="150" y="64" width="280" height="384" rx="24" fill="#fdfbf5"/>
  <circle cx="196" cy="128" r="9" fill="#c9bda9"/>
  <circle cx="240" cy="128" r="9" fill="#c9bda9"/>
  <circle cx="284" cy="128" r="9" fill="#c9bda9"/>
  <path d="M186 300 C 226 220, 258 316, 296 268 S 366 208, 396 258"
        stroke="#d6453d" stroke-width="20" stroke-linecap="round" fill="none"/>
  <path d="M186 352 C 240 330, 300 372, 396 340"
        stroke="#e5b32e" stroke-width="26" stroke-linecap="round" fill="none" opacity="0.55"/>
</svg>`;

/** Full-bleed square for maskable + apple-touch (OS applies its own mask). */
const fullBleedSvg = roundedSvg.replace('rx="112"', 'rx="0"');

async function writeIcon(svg, file, size) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(join(outDir, file));
  console.log(`✓ ${file} (${size}x${size})`);
}

await writeIcon(roundedSvg, "icon-192.png", 192);
await writeIcon(roundedSvg, "icon-512.png", 512);
await writeIcon(fullBleedSvg, "maskable-512.png", 512);
await writeIcon(fullBleedSvg, "apple-touch-icon.png", 180);
await writeIcon(roundedSvg, "favicon-64.png", 64);

console.log("Icons written to", outDir);
