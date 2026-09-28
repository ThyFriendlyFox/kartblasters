// Prerender every car in every palette colour to public/cars/<car>-<hex>.webp,
// so the menu's car picker just swaps pictures when you change colour.
// Re-run after changing a car model or the palette:
//   npm run thumbs
// Needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium).
import fs from 'fs';
import path from 'path';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const SIZE = 192; // twice the on-screen size, sharp on high-DPI screens
const out = path.resolve('public/cars');
fs.mkdirSync(out, { recursive: true });

const server = await createServer({ server: { port: 5199, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5199/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  const shots = await page.evaluate(async (size) => {
    const { CAR_IDS, COLORS, carThumbnail } = await import('/src/cars.js');
    const res = [];
    for (const id of CAR_IDS) {
      for (const color of COLORS) {
        const img = new Image();
        img.src = carThumbnail(id, color, size);
        await img.decode();
        const c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, 0, 0);
        res.push([`${id}-${color.slice(1)}.webp`, c.toDataURL('image/webp', 0.9)]);
      }
    }
    return res;
  }, SIZE);
  let bytes = 0;
  for (const [name, url] of shots) {
    const buf = Buffer.from(url.split(',')[1], 'base64');
    fs.writeFileSync(path.join(out, name), buf);
    bytes += buf.length;
  }
  console.log(`wrote ${shots.length} pictures (${(bytes / 1024).toFixed(0)} KB) to public/cars`);
} finally {
  await browser.close();
  await server.close();
}
