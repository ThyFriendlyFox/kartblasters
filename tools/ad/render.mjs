// Renders the promo ad to an MP4.
//
//   npx vite --port 5174 &           (serve the repo)
//   node tools/ad/render.mjs out.mp4 [--w 1280 --h 720 --fps 30] [--frames 0,40,90] [--ffmpeg path]
//
// --frames renders just those frames as JPEGs (for checking a look).
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const outFile = path.resolve(args.find((a) => !a.startsWith('--') && !/^\d/.test(a)) || 'kart-blasters-ad.mp4');
const w = opt('w', '1280'), h = opt('h', '720'), fps = opt('fps', '30');
const host = opt('host', 'http://127.0.0.1:5174');
const ffmpeg = opt('ffmpeg', 'ffmpeg');
const work = outFile.replace(/\.mp4$/, '') + '_frames';
fs.mkdirSync(work, { recursive: true });

const { chromium } = await import('playwright').catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('pageerror', (e) => console.error('pageerror:', e.message));
await page.goto(`${host}/tools/ad/index.html?w=${w}&h=${h}&fps=${fps}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.AD, null, { timeout: 60000 });
await page.evaluate(() => window.AD.ready());
const info = await page.evaluate(() => ({ frames: window.AD.frames, total: window.AD.TOTAL, shots: window.AD.shots }));
console.log(`ad: ${info.total.toFixed(2)}s, ${info.frames} frames`, info.shots.map((s) => `${s.id}@${s.t0.toFixed(2)}`).join(' '));

const only = opt('frames', null);
const list = only ? only.split(',').map(Number) : [...Array(info.frames).keys()];
const t0 = Date.now();
for (const [k, i] of list.entries()) {
  const url = await page.evaluate((i) => window.AD.frame(i), i);
  fs.writeFileSync(path.join(work, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
  if (k % 30 === 0) console.log(`frame ${i}/${info.frames}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
if (only) {
  await browser.close();
  console.log('frames in', work);
  process.exit(0);
}
const wav = await page.evaluate(() => window.AD.audio());
fs.writeFileSync(path.join(work, 'audio.wav'), Buffer.from(wav, 'base64'));
await browser.close();

const r = spawnSync(ffmpeg, [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-framerate', fps, '-i', path.join(work, 'f%05d.jpg'),
  '-i', path.join(work, 'audio.wav'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart',
  '-c:a', 'aac', '-b:a', '192k', '-shortest',
  outFile,
], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
console.log('wrote', outFile);
