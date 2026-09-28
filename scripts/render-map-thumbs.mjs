// Prerender an aerial shot of every race track and battle arena to
// public/maps/<race|battle>-<id>.webp, plus their facts (lap length, size)
// to src/mapfacts.json, so the menu's map grid needs no 3D rendering.
// Re-run after changing a map:   npm run thumbs
// Needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium).
import fs from 'fs';
import path from 'path';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const out = path.resolve('public/maps');
fs.mkdirSync(out, { recursive: true });

const server = await createServer({ server: { port: 5198, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5198/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  const shots = await page.evaluate(async () => {
    const { mapPreview } = await import('/src/preview.js');
    const { TRACK_IDS } = await import('/src/trackdefs.js');
    const jobs = [...TRACK_IDS.map((id) => ['race', id]), ...['stadium', 'craters', 'daytona', 'cube'].map((id) => ['battle', id])];
    const res = [];
    for (const [mode, id] of jobs) {
      const { url, facts } = await mapPreview(mode, id);
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 480;
      c.height = 270;
      c.getContext('2d').drawImage(img, 0, 0, 480, 270);
      res.push([`${mode}-${id}`, c.toDataURL('image/webp', 0.82), facts]);
    }
    return res;
  });
  const facts = {};
  let bytes = 0;
  for (const [name, url, f] of shots) {
    const buf = Buffer.from(url.split(',')[1], 'base64');
    fs.writeFileSync(path.join(out, `${name}.webp`), buf);
    bytes += buf.length;
    facts[name] = f;
  }
  fs.writeFileSync(path.resolve('src/mapfacts.json'), JSON.stringify(facts, null, 1) + '\n');
  console.log(`wrote ${shots.length} map shots (${(bytes / 1024).toFixed(0)} KB) to public/maps`);
} finally {
  await browser.close();
  await server.close();
}
