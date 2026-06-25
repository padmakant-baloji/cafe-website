/**
 * Builds square PNG icons for PWA / favicon from the cafe logo (landscape source).
 * Uses theme green as letterboxing for maskable safe zone (10% inset).
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'images/logo/logo-quickkart cafe.png');
const OUT_DIR = path.join(ROOT, 'images/logo');
/** #15803d — matches manifest theme_color */
const BG = { r: 21, g: 128, b: 61, alpha: 1 };

async function squareIcon(size, filename, safeMarginRatio = 0) {
  const margin = Math.round(size * safeMarginRatio);
  const inner = Math.max(1, size - 2 * margin);
  const resized = await sharp(SRC)
    .resize(inner, inner, { fit: 'inside', withoutEnlargement: false })
    .toBuffer();

  const out = path.join(OUT_DIR, filename);
  await sharp({
    create: { width: size, height: size, channels: 4, background: BG }
  })
    .composite([{ input: resized, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(out);

  console.log(`wrote ${path.relative(ROOT, out)} (${size}×${size}${safeMarginRatio ? `, ${Math.round(safeMarginRatio * 100)}% safe margin` : ''})`);
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error('Missing cafe logo:', SRC);
    process.exit(1);
  }
  await squareIcon(144, 'pwa-144.png', 0);
  await squareIcon(192, 'pwa-192.png', 0);
  await squareIcon(512, 'pwa-512.png', 0);
  await squareIcon(512, 'pwa-maskable-512.png', 0.1);
  await squareIcon(180, 'apple-touch-icon.png', 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
