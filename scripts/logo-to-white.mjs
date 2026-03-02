/**
 * Recolors a logo image to white, preserving transparency.
 * Usage: node scripts/logo-to-white.mjs <input.png> [output.png]
 * Example: node scripts/logo-to-white.mjs assets/MAIN_LOGO.png public/logo-white.png
 */
import sharp from "sharp";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath) {
  console.error("Usage: node scripts/logo-to-white.mjs <input.png> [output.png]");
  process.exit(1);
}

const input = inputPath.startsWith("/") || /^[A-Za-z]:/.test(inputPath)
  ? inputPath
  : join(root, inputPath);

if (!existsSync(input)) {
  console.error("Input file not found:", input);
  process.exit(1);
}

const out = outputPath
  ? (outputPath.startsWith("/") || /^[A-Za-z]:/.test(outputPath) ? outputPath : join(root, outputPath))
  : input.replace(/(\.\w+)$/, "-white$1");

async function main() {
  const pipeline = sharp(input).ensureAlpha();
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels || 4;

  for (let i = 0; i < data.length; i += channels) {
    data[i] = 255;     // R
    data[i + 1] = 255; // G
    data[i + 2] = 255; // B
    // keep alpha (i+3) unchanged
  }

  await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels,
    },
  })
    .png()
    .toFile(out);

  console.log("Saved white logo to:", out);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
