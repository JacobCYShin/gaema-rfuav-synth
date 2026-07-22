// Records a scripted 78-second demo mission to media/simulation-demo.mp4.
//
// Deterministic frame-stepped capture: the page's own engine ticking is
// frozen (window.__captureManualTick) and the engine is advanced exactly
// 1/FPS per captured frame, so the encoded video plays at true speed no
// matter how slow the (software-rendered) browser is.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPreview } from './preview-server.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mediaDir = path.join(rootDir, 'media');
const framesDir = path.join(mediaDir, 'frames');
const probesDir = path.join(mediaDir, 'probes');
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
mkdirSync(probesDir, { recursive: true });

const FPS = 24;
const DURATION = 78; // seconds of simulation time
const PROBE_TIMES = [3, 12, 26, 40, 52, 66, 76];
// storyboard: sim-time → action executed inside the page
const EVENTS = [
  { t: 0.0, action: 'run' }, // tactical: takeoff & ingress; first detection ≈ t=22
  { t: 24.0, action: 'cam3' }, // drone cinematic, estimate marker alongside
  { t: 34.0, action: 'cam1' }, // tactical: fusion tightening → TRACKING
  { t: 42.0, action: 'scoutA' }, // scout follow view + live spectrum/waterfall panel
  { t: 47.0, action: 'camFp' }, // scout first-person while the spectrum keeps painting
  { t: 52.0, action: 'cam1drone' }, // back to tactical, drone selected
  { t: 54.0, action: 'rerouteWp' }, // live route edit while flying
  { t: 58.0, action: 'analytics' }, // error/RSSI/trajectory charts over the closing acts
  { t: 64.0, action: 'rth' }, // return home — route turn visible on tactical
  { t: 67.0, action: 'cam3' }, // cinematic of the egress
  { t: 74.0, action: 'cam1' }, // closing overview with analytics strip
];

const server = await startPreview({ rootDir });
const URL = server.url;
const consoleErrors = [];
let browser;

try {
  browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction('window.__simReady === true', null, { timeout: 40000 });
  await page.waitForTimeout(2000);

  // ---- scenario setup: distant ingress route crossing the facility
  await page.evaluate(() => {
    const { engine, ui } = window.__simApi;
    engine.reset();
    ui.getState().select('drone-1');
    engine.moveEntity('drone-1', -1250, -880); // IDLE in edit → home follows
    engine.addWaypoint('drone-1', -720, -420, 70, 32);
    engine.addWaypoint('drone-1', -160, -30, 55, 26);
    engine.addWaypoint('drone-1', 150, 170, 60, 20);
    engine.addWaypoint('drone-1', 470, -60, 70, 26);
    ui.getState().selectWaypoint(null);
    window.__captureManualTick = true;
  });

  const runAction = (action) =>
    page.evaluate((a) => {
      const { engine, ui } = window.__simApi;
      switch (a) {
        case 'run':
          engine.setMode('run');
          break;
        case 'cam1':
          ui.getState().setCamMode(1);
          break;
        case 'cam1drone':
          ui.getState().setCamMode(1);
          ui.getState().select('drone-1');
          break;
        case 'cam3':
          ui.getState().setCamMode(3);
          break;
        case 'scoutA':
          ui.getState().select('A');
          ui.getState().setCamMode(2);
          break;
        case 'camFp':
          ui.getState().setCamMode(5);
          break;
        case 'analytics':
          if (!ui.getState().showAnalytics) ui.getState().toggle('showAnalytics');
          break;
        case 'rerouteWp': {
          const wp = engine.drone.waypoints.find((w) => w.id === engine.drone.nextWpId);
          if (wp) engine.moveWaypoint('drone-1', wp.id, wp.x + 260, wp.y - 220);
          break;
        }
        case 'rth':
          engine.setFlightMode('RTH');
          break;
      }
    }, action);

  const totalFrames = DURATION * FPS;
  const probeFrames = new Set(PROBE_TIMES.map((t) => Math.round(t * FPS)));
  let nextEvent = 0;
  const started = Date.now();

  for (let f = 0; f < totalFrames; f++) {
    const t = f / FPS;
    while (nextEvent < EVENTS.length && EVENTS[nextEvent].t <= t) {
      await runAction(EVENTS[nextEvent].action);
      nextEvent++;
    }
    await page.evaluate((dt) => {
      window.__simApi.engine.tick(dt);
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, 1 / FPS);
    const file = path.join(framesDir, `${String(f).padStart(5, '0')}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 87 });
    if (probeFrames.has(f)) {
      copyFileSync(file, path.join(probesDir, `probe_${t.toFixed(0).padStart(2, '0')}s.jpg`));
    }
    if (f % (FPS * 5) === 0) {
      const el = ((Date.now() - started) / 1000).toFixed(0);
      console.log(`frame ${f}/${totalFrames} (sim t=${t.toFixed(1)}s, wall ${el}s)`);
    }
  }

  await browser.close();
  browser = undefined;

  console.log('encoding mp4...');
  execFileSync('ffmpeg', [
    '-y',
    '-framerate', String(FPS),
    '-i', path.join(framesDir, '%05d.jpg'),
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    path.join(mediaDir, 'simulation-demo.mp4'),
  ], { stdio: 'inherit' });
  rmSync(framesDir, { recursive: true, force: true });
  console.log('done: media/simulation-demo.mp4');
} finally {
  try {
    await browser?.close();
  } finally {
    await server.stop();
  }
}

console.log('--- console errors ---');
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)');
process.exit(consoleErrors.length ? 2 : 0);
