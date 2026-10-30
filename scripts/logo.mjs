// Builds the app artwork from the source logo: the full logo for large surfaces and a round
// portrait for icons, which must stay readable at 16–48 px. Run: node scripts/logo.mjs, then
// npm run tauri icon app-icon.png
import sharp from "sharp";

const src = process.argv[2] ?? "docs/logo.webp";

// Square around the head, including the beret; measured on the 1254 px source.
const CROP = { left: 318, top: 10, width: 676, height: 676 };
const SIZE = 1024;
const RING = "#1d4e7a";
const FILL = "#8fc6ea";

const portrait = await sharp(src).extract(CROP).resize(SIZE - 96, SIZE - 96).toBuffer();
const circle = (r, fill) => Buffer.from(`<svg width="${SIZE}" height="${SIZE}"><circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${r}" fill="${fill}"/></svg>`);

// Ring, sky-blue disc, portrait on top, then everything outside the disc cut away.
await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([
    { input: circle(SIZE / 2 - 4, RING) },
    { input: circle(SIZE / 2 - 44, FILL) },
    { input: portrait, left: 48, top: 64 },
    { input: circle(SIZE / 2 - 44, "#fff"), blend: "dest-in" },
    { input: Buffer.from(`<svg width="${SIZE}" height="${SIZE}"><circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${SIZE / 2 - 24}" fill="none" stroke="${RING}" stroke-width="44"/></svg>`) },
  ])
  .png()
  .toFile("app-icon.png");

// Shown in onboarding and the About tab only; loaded on demand.
await sharp(src).resize(360, 360).webp({ quality: 86 }).toFile("src/lib/assets/logo.webp");
await sharp("app-icon.png").resize(64, 64).png().toFile("static/favicon.png");
console.log("app-icon.png, src/lib/assets/logo.webp, static/favicon.png");
