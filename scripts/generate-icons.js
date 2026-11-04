import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// 1. SVG Standard (512x512) avec coins arrondis
const standardSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="112" fill="#ff6a2b"/>
  <text x="256" y="348" font-family="'DM Sans', 'Manrope', system-ui, -apple-system, sans-serif" font-size="288" font-weight="800" text-anchor="middle" fill="#f1ece4" letter-spacing="-0.04em">A</text>
  <circle cx="360" cy="160" r="28" fill="#ffd23f"/>
</svg>`;

// 2. SVG Maskable (512x512) pleine surface avec safe-zone de 20%
const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#ff6a2b"/>
  <!-- Safe zone centrale de 80% -->
  <g transform="translate(51.2, 51.2) scale(0.8)">
    <text x="256" y="348" font-family="'DM Sans', 'Manrope', system-ui, -apple-system, sans-serif" font-size="288" font-weight="800" text-anchor="middle" fill="#f1ece4" letter-spacing="-0.04em">A</text>
    <circle cx="360" cy="160" r="28" fill="#ffd23f"/>
  </g>
</svg>`;

// 3. SVG Apple Touch Icon (180x180)
const appleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180">
  <rect width="180" height="180" rx="38" fill="#ff6a2b"/>
  <text x="90" y="122" font-family="'DM Sans', 'Manrope', system-ui, -apple-system, sans-serif" font-size="102" font-weight="800" text-anchor="middle" fill="#f1ece4" letter-spacing="-0.04em">A</text>
  <circle cx="128" cy="56" r="10" fill="#ffd23f"/>
</svg>`;

// Sauvegarder les SVGs sources
fs.writeFileSync(path.join(publicDir, 'icon.svg'), standardSvg);
fs.writeFileSync(path.join(publicDir, 'icon-maskable.svg'), maskableSvg);
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.svg'), appleSvg);

async function generatePngs() {
  console.log('Génération des icônes PNG avec sharp...');
  
  // pwa-192x192.png
  await sharp(Buffer.from(standardSvg))
    .resize(192, 192)
    .png()
    .toFile(path.join(publicDir, 'pwa-192x192.png'));

  // pwa-512x512.png
  await sharp(Buffer.from(standardSvg))
    .resize(512, 512)
    .png()
    .toFile(path.join(publicDir, 'pwa-512x512.png'));

  // pwa-maskable-512x512.png
  await sharp(Buffer.from(maskableSvg))
    .resize(512, 512)
    .png()
    .toFile(path.join(publicDir, 'pwa-maskable-512x512.png'));

  // apple-touch-icon.png (180x180)
  await sharp(Buffer.from(appleSvg))
    .resize(180, 180)
    .png()
    .toFile(path.join(publicDir, 'apple-touch-icon.png'));

  // favicon.ico / favicon-32x32.png
  await sharp(Buffer.from(standardSvg))
    .resize(64, 64)
    .png()
    .toFile(path.join(publicDir, 'favicon.png'));

  console.log('✅ Toutes les icônes SVG et PNG ont été générées dans /public !');
}

generatePngs().catch((err) => {
  console.error('Erreur lors de la génération des icônes :', err);
  process.exit(1);
});
