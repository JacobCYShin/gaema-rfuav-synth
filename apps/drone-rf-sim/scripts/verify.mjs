// End-to-end interaction verification for the drone RF simulator.
// Drives the real UI (mouse picking, dragging, panel inputs) against the
// built app, asserts engine state via window.__simApi, and saves screenshots.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPreview } from './preview-server.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(rootDir, 'screenshots');
mkdirSync(outDir, { recursive: true });

const results = [];
let failures = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const server = await startPreview({ rootDir });
const URL = server.url;
const consoleErrors = [];
const failedRequests = [];
let browser;

try {
  browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  page.on('response', (res) => {
    if (res.status() >= 400) failedRequests.push(`${res.url()} :: HTTP ${res.status()}`);
  });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction('window.__simReady === true', null, { timeout: 40000 });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="spectrum-panel"]')?.dataset.profileLoaded === 'true',
    null,
    { timeout: 10000 },
  );
  await page.waitForTimeout(2500); // let imagery + first frames settle

  const api = (expr) => page.evaluate(expr);
  const shot = (file) => page.screenshot({ path: path.join(outDir, file) });

  await page.waitForFunction(
    () => Number(document.querySelector('[data-testid="spectrum-panel"]')?.dataset.rowMax) > 0,
    null,
    { timeout: 5000 },
  );
  const spectrumBefore = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="spectrum-panel"]');
    return {
      source: panel?.dataset.spectrumSource,
      hop: panel?.dataset.hopIndex,
      rowMin: Number(panel?.dataset.rowMin),
      rowMax: Number(panel?.dataset.rowMax),
    };
  });
  check(
    'validated live spectrum profile is rendering',
    spectrumBefore.source === 'live' &&
      Number.isFinite(spectrumBefore.rowMin) &&
      Number.isFinite(spectrumBefore.rowMax) &&
      Number.isFinite(Number(spectrumBefore.hop)) &&
      spectrumBefore.rowMax > 0,
    JSON.stringify(spectrumBefore),
  );

  // ---- EDIT mode screenshot
  await shot('01_edit_mode.png');

  // ---- 1. click the drone to select it
  const dronePt = await api(`window.__simApi.screenOfEntity('drone-1')`);
  check('drone projects to screen', !!dronePt);
  await page.mouse.click(dronePt.x, dronePt.y);
  await page.waitForTimeout(400);
  check('drone selected by click', (await api(`window.__simApi.ui.getState().selectedId`)) === 'drone-1');

  // ---- 2/3. add 3 waypoints by double-clicking the map
  const targets = [
    { x: -450, y: -250 },
    { x: -60, y: 120 },
    { x: 420, y: 260 },
  ];
  for (const t of targets) {
    const pt = await page.evaluate((q) => window.__simApi.screenOfGround(q.x, q.y), t);
    await page.mouse.dblclick(pt.x, pt.y, { delay: 60 });
    await page.waitForTimeout(350);
  }
  const wpCount = await api(`window.__simApi.engine.drone.waypoints.length`);
  check('3 waypoints added via double-click', wpCount === 3, `count=${wpCount}`);
  await shot('02_waypoint_edit.png');

  // ---- 4. drag waypoint 2 with the mouse
  const wp2id = await api(`window.__simApi.engine.drone.waypoints[1].id`);
  const before = await api(`(() => { const w = window.__simApi.engine.drone.waypoints[1]; return { x: w.x, y: w.y }; })()`);
  const wpPt = await page.evaluate((id) => window.__simApi.screenOfWaypoint('drone-1', id), wp2id);
  await page.mouse.move(wpPt.x, wpPt.y);
  await page.mouse.down();
  await page.mouse.move(wpPt.x + 90, wpPt.y + 45, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  const after = await api(`(() => { const w = window.__simApi.engine.drone.waypoints[1]; return { x: w.x, y: w.y }; })()`);
  const dragDist = Math.hypot(after.x - before.x, after.y - before.y);
  check('waypoint dragged on the map', dragDist > 30, `moved ${dragDist.toFixed(0)} m`);

  // ---- 5. change altitude & speed through the panel inputs
  await page.evaluate((id) => window.__simApi.ui.getState().select('drone-1', id), wp2id);
  await page.waitForTimeout(300);
  await page.fill('[data-testid="wp-alt"]', '120');
  await page.fill('[data-testid="wp-speed"]', '25');
  await page.waitForTimeout(300);
  const wp2 = await api(`window.__simApi.engine.drone.waypoints[1]`);
  check('waypoint altitude set to 120', Math.round(wp2.alt) === 120, `alt=${wp2.alt}`);
  check('waypoint speed set to 25', Math.round(wp2.speed) === 25, `speed=${wp2.speed}`);

  // ---- 6. RUN → drone starts flying the route
  await page.click('[data-testid="btn-run"]');
  await page.waitForTimeout(300);
  const posA = await api(`({ ...window.__simApi.engine.drone.pos })`);
  await page.waitForTimeout(2600);
  const posB = await api(`({ ...window.__simApi.engine.drone.pos })`);
  const flew = Math.hypot(posB.x - posA.x, posB.y - posA.y, posB.alt - posA.alt);
  check('RUN: drone follows the route', flew > 15, `moved ${flew.toFixed(0)} m in 2.6 s`);
  check('drone in MISSION mode', (await api(`window.__simApi.engine.drone.flightMode`)) === 'MISSION');
  await shot('03_run_mode.png');

  // ---- 7/8. add a waypoint while running + drag the next waypoint: immediate reaction
  const midPt = await page.evaluate(() => window.__simApi.screenOfGround(300, -300));
  await page.mouse.dblclick(midPt.x, midPt.y, { delay: 60 });
  await page.waitForTimeout(300);
  const wpCountRun = await api(`window.__simApi.engine.drone.waypoints.length`);
  check('waypoint added while running', wpCountRun === 4, `count=${wpCountRun}`);

  const nextBefore = await api(`window.__simApi.engine.drone.nextWpId`);
  await page.evaluate(() => {
    const e = window.__simApi.engine;
    const wp = e.drone.waypoints.find((w) => w.id === e.drone.nextWpId);
    e.moveWaypoint('drone-1', wp.id, wp.x - 350, wp.y + 250);
  });
  const h0 = await api(`window.__simApi.engine.drone.heading`);
  await page.waitForTimeout(1500);
  const h1 = await api(`window.__simApi.engine.drone.heading`);
  const turned = Math.abs(h1 - h0);
  check(
    'drone reacts to moved waypoint mid-flight',
    turned > 0.08 && (await api(`window.__simApi.engine.drone.nextWpId`)) === nextBefore,
    `heading changed ${(turned * 57.3).toFixed(1)}°`,
  );
  await shot('04_run_path_change.png');

  // ---- 9. drag Scout B to a new position while running
  const sbBefore = await api(`({ ...window.__simApi.engine.getEntity('B').pos })`);
  const sbPt = await api(`window.__simApi.screenOfEntity('B')`);
  await page.mouse.move(sbPt.x, sbPt.y);
  await page.mouse.down();
  await page.mouse.move(sbPt.x - 120, sbPt.y - 60, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  const sbAfter = await api(`({ ...window.__simApi.engine.getEntity('B').pos })`);
  const sbMoved = Math.hypot(sbAfter.x - sbBefore.x, sbAfter.y - sbBefore.y);
  check('Scout B repositioned by drag', sbMoved > 30, `moved ${sbMoved.toFixed(0)} m`);

  // ---- 10. RF telemetry updates as the drone approaches
  // fast-forward at 4x until the fused estimate appears, then back to 1x
  await page.evaluate(() => window.__simApi.engine.setSpeedMult(4));
  await page.waitForFunction(() => window.__simApi.engine.estimate.available, null, { timeout: 60000 });
  await page.evaluate(() => window.__simApi.engine.setSpeedMult(1));
  await page.waitForTimeout(1500);
  const rf = await api(`(() => {
    const e = window.__simApi.engine;
    return {
      rssiA: e.scouts[0].rssi, rssiB: e.scouts[1].rssi, rssiC: e.scouts[2].rssi,
      est: e.estimate.available, unc: e.estimate.uncertainty, status: e.status,
    };
  })()`);
  const anyRssi = [rf.rssiA, rf.rssiB, rf.rssiC].some((v) => v !== null);
  check('mock RSSI produced', anyRssi, JSON.stringify(rf));
  await page.waitForTimeout(300);
  const spectrumRf = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="spectrum-panel"]');
    return {
      strongestRssi: panel?.dataset.strongestRssi,
      rssiGainDb: Number(panel?.dataset.rssiGainDb),
      rowMax: Number(panel?.dataset.rowMax),
    };
  });
  check(
    'live spectrum consumes current scout RSSI',
    spectrumRf.strongestRssi !== 'none' &&
      Number.isFinite(Number(spectrumRf.strongestRssi)) &&
      spectrumRf.rssiGainDb > 0,
    JSON.stringify(spectrumRf),
  );
  check('estimate + uncertainty available', rf.est && rf.unc > 0, `±${rf.unc} m, status=${rf.status}`);
  await shot('05_detection_estimate.png');

  // ---- 11. camera modes
  await page.click('[data-testid="cam-2"]');
  await page.waitForTimeout(1400);
  const scoutCamera = await page.evaluate(() => ({
    mode: window.__simApi.ui.getState().camMode,
    active: document.querySelector('[data-testid="cam-2"]')?.classList.contains('active') ?? false,
  }));
  check('Scout Follow camera activated', scoutCamera.mode === 2 && scoutCamera.active,
    `mode=${scoutCamera.mode} active=${scoutCamera.active}`);
  await shot('06_scout_follow.png');
  await page.click('[data-testid="cam-3"]');
  await page.waitForTimeout(1400);
  const droneCamera = await page.evaluate(() => ({
    mode: window.__simApi.ui.getState().camMode,
    active: document.querySelector('[data-testid="cam-3"]')?.classList.contains('active') ?? false,
  }));
  check('Drone Follow camera activated', droneCamera.mode === 3 && droneCamera.active,
    `mode=${droneCamera.mode} active=${droneCamera.active}`);
  await shot('07_drone_follow.png');
  await page.click('[data-testid="cam-1"]');
  await page.waitForTimeout(1600);
  const tacticalCamera = await page.evaluate(() => ({
    mode: window.__simApi.ui.getState().camMode,
    active: document.querySelector('[data-testid="cam-1"]')?.classList.contains('active') ?? false,
  }));
  check('Tactical camera restored', tacticalCamera.mode === 1 && tacticalCamera.active,
    `mode=${tacticalCamera.mode} active=${tacticalCamera.active}`);

  // ---- 12. save → mutate → load restores
  await page.click('[data-testid="btn-pause"]');
  await page.click('[data-testid="btn-save"]');
  await page.waitForTimeout(200);
  const savedCount = await api(`window.__simApi.engine.drone.waypoints.length`);
  await page.evaluate(() => {
    const e = window.__simApi.engine;
    e.removeWaypoint('drone-1', e.drone.waypoints[0].id);
  });
  const mutated = await api(`window.__simApi.engine.drone.waypoints.length`);
  await page.click('[data-testid="btn-load"]');
  await page.waitForTimeout(400);
  const restored = await api(`window.__simApi.engine.drone.waypoints.length`);
  check('scenario save/load restores route', mutated === savedCount - 1 && restored === savedCount,
    `saved=${savedCount} mutated=${mutated} restored=${restored}`);

  const beforeMalformedLoad = await api(`JSON.stringify(window.__simApi.engine.serialize())`);
  await page.evaluate(() => {
    localStorage.setItem('drone-rf-sim.scenario.v1', '{not-valid-json');
  });
  await page.click('[data-testid="btn-load"]');
  await page.waitForTimeout(200);
  const afterMalformedLoad = await api(`JSON.stringify(window.__simApi.engine.serialize())`);
  check('malformed stored scenario is rejected',
    afterMalformedLoad === beforeMalformedLoad && (await api(`window.__simReady === true`)),
    `statePreserved=${afterMalformedLoad === beforeMalformedLoad}`);

  // ---- replay: run again briefly, then scrub
  await page.click('[data-testid="btn-run"]');
  await page.waitForTimeout(2500);
  await page.click('[data-testid="btn-pause"]');
  const recDur = await api(`window.__simApi.engine.recordingDuration()`);
  const liveBeforeReplay = await page.evaluate(() => {
    const e = window.__simApi.engine;
    return {
      pos: { ...e.drone.pos },
      route: JSON.stringify(e.drone.waypoints),
      simTime: e.simTime,
      flightMode: e.drone.flightMode,
      nextWpId: e.drone.nextWpId,
    };
  });
  await page.click('[data-testid="btn-replay"]');
  await page.evaluate(() => window.__simApi.engine.setReplayPlaying(false));
  const replaySeekTime = Math.max(0, recDur * 0.25);
  await page.evaluate((time) => window.__simApi.engine.replaySeek(time), replaySeekTime);
  await page.waitForTimeout(50);
  const replayState = await page.evaluate(() => {
    const e = window.__simApi.engine;
    return { mode: e.mode, replayTime: e.replayTime, pos: { ...e.drone.pos } };
  });
  const replayMoved = Math.hypot(
    replayState.pos.x - liveBeforeReplay.pos.x,
    replayState.pos.y - liveBeforeReplay.pos.y,
    replayState.pos.alt - liveBeforeReplay.pos.alt,
  );
  check('replay enters and seeks recorded state',
    replayState.mode === 'replay' && Math.abs(replayState.replayTime - replaySeekTime) < 0.1 && replayMoved > 0.1,
    `recorded=${recDur.toFixed(1)}s seek=${replayState.replayTime.toFixed(1)}s delta=${replayMoved.toFixed(1)}m`);
  await page.click('[data-testid="btn-edit"]');
  await page.waitForTimeout(200);
  const liveAfterReplay = await page.evaluate(() => {
    const e = window.__simApi.engine;
    return {
      mode: e.mode,
      pos: { ...e.drone.pos },
      route: JSON.stringify(e.drone.waypoints),
      simTime: e.simTime,
      flightMode: e.drone.flightMode,
      nextWpId: e.drone.nextWpId,
      replayPlaying: e.replayPlaying,
      active: document.querySelector('[data-testid="btn-edit"]')?.classList.contains('active') ?? false,
    };
  });
  const restoredDistance = Math.hypot(
    liveAfterReplay.pos.x - liveBeforeReplay.pos.x,
    liveAfterReplay.pos.y - liveBeforeReplay.pos.y,
    liveAfterReplay.pos.alt - liveBeforeReplay.pos.alt,
  );
  const progressRestored =
    Math.abs(liveAfterReplay.simTime - liveBeforeReplay.simTime) < 1e-6 &&
    liveAfterReplay.flightMode === liveBeforeReplay.flightMode &&
    liveAfterReplay.nextWpId === liveBeforeReplay.nextWpId;
  check('replay exit restores live route and progress',
    liveAfterReplay.mode === 'edit' && liveAfterReplay.active && !liveAfterReplay.replayPlaying &&
      restoredDistance < 1e-6 && liveAfterReplay.route === liveBeforeReplay.route && progressRestored,
    `mode=${liveAfterReplay.mode} positionDelta=${restoredDistance.toFixed(3)}m ` +
      `routePreserved=${liveAfterReplay.route === liveBeforeReplay.route} progressRestored=${progressRestored}`);

  // ---- switch renderers without reloading or replacing simulation/UI state
  const rendererWaypoint = await api(`window.__simApi.engine.drone.waypoints[1].id`);
  await page.evaluate((wpId) => window.__simApi.ui.getState().select('drone-1', wpId), rendererWaypoint);
  const rendererBaseline = await page.evaluate(() => {
    window.__e2eRendererSwitchSentinel = 'renderer-state-survives';
    const { engine, ui } = window.__simApi;
    return {
      route: JSON.stringify(engine.drone.waypoints),
      waypointCount: engine.drone.waypoints.length,
      selectedId: ui.getState().selectedId,
      selectedWpId: ui.getState().selectedWpId,
    };
  });
  const playcanvasBefore = await page.evaluate(() => {
    const canvas = document.querySelector('.pc-host #pc-canvas');
    return {
      canvasReady: canvas instanceof HTMLCanvasElement && canvas.clientWidth > 0 && canvas.clientHeight > 0,
      width: canvas?.clientWidth ?? 0,
      height: canvas?.clientHeight ?? 0,
    };
  });
  check('PlayCanvas renderer host is active', playcanvasBefore.canvasReady,
    `canvas=${playcanvasBefore.width}x${playcanvasBefore.height}`);

  await page.click('[data-testid="renderer-cesium"]');
  await page.waitForFunction(() =>
    window.__simReady === true &&
    window.__simApi?.ui.getState().renderer === 'cesium' &&
    document.querySelector('.cesium-host canvas') !== null,
  null, { timeout: 40000 });
  await page.waitForTimeout(2500);
  const cesiumState = await page.evaluate(() => {
    const { engine, ui } = window.__simApi;
    const canvas = document.querySelector('.cesium-host canvas');
    const errorPanel = document.querySelector('.cesium-widget-errorPanel');
    const errorStyle = errorPanel ? getComputedStyle(errorPanel) : null;
    const errorRect = errorPanel?.getBoundingClientRect();
    const errorVisible = !!errorPanel && errorStyle?.display !== 'none' && errorStyle?.visibility !== 'hidden' &&
      !!errorRect && errorRect.width > 0 && errorRect.height > 0;
    const drone = window.__simApi.screenOfEntity('drone-1');
    return {
      canvasReady: canvas instanceof HTMLCanvasElement && canvas.clientWidth > 0 && canvas.clientHeight > 0,
      droneProjected: !!drone && Number.isFinite(drone.x) && Number.isFinite(drone.y),
      width: canvas?.clientWidth ?? 0,
      height: canvas?.clientHeight ?? 0,
      route: JSON.stringify(engine.drone.waypoints),
      waypointCount: engine.drone.waypoints.length,
      selectedId: ui.getState().selectedId,
      selectedWpId: ui.getState().selectedWpId,
      sentinel: window.__e2eRendererSwitchSentinel,
      error: errorVisible ? errorPanel?.textContent?.trim() || 'Cesium error panel is visible' : null,
    };
  });
  const cesiumStatePreserved =
    cesiumState.route === rendererBaseline.route &&
    cesiumState.waypointCount === rendererBaseline.waypointCount &&
    cesiumState.selectedId === rendererBaseline.selectedId &&
    cesiumState.selectedWpId === rendererBaseline.selectedWpId;
  check('Cesium renderer initializes without losing state',
    cesiumState.canvasReady && cesiumState.droneProjected && !cesiumState.error && cesiumStatePreserved &&
      cesiumState.sentinel === 'renderer-state-survives',
    `canvas=${cesiumState.width}x${cesiumState.height} droneProjected=${cesiumState.droneProjected} ` +
      `statePreserved=${cesiumStatePreserved} noReload=${cesiumState.sentinel === 'renderer-state-survives'} ` +
      `error=${cesiumState.error ?? 'none'}`);
  await shot('08_cesium_map.png');

  await page.click('[data-testid="renderer-playcanvas"]', { force: !!cesiumState.error });
  await page.waitForFunction(() =>
    window.__simReady === true &&
    window.__simApi?.ui.getState().renderer === 'playcanvas' &&
    document.querySelector('.pc-host #pc-canvas') !== null,
  null, { timeout: 40000 });
  await page.waitForTimeout(1000);
  const playcanvasAfter = await page.evaluate(() => {
    const { engine, ui } = window.__simApi;
    const canvas = document.querySelector('.pc-host #pc-canvas');
    const drone = window.__simApi.screenOfEntity('drone-1');
    return {
      canvasReady: canvas instanceof HTMLCanvasElement && canvas.clientWidth > 0 && canvas.clientHeight > 0,
      droneProjected: !!drone && Number.isFinite(drone.x) && Number.isFinite(drone.y),
      route: JSON.stringify(engine.drone.waypoints),
      waypointCount: engine.drone.waypoints.length,
      selectedId: ui.getState().selectedId,
      selectedWpId: ui.getState().selectedWpId,
      sentinel: window.__e2eRendererSwitchSentinel,
    };
  });
  const playcanvasStatePreserved =
    playcanvasAfter.route === rendererBaseline.route &&
    playcanvasAfter.waypointCount === rendererBaseline.waypointCount &&
    playcanvasAfter.selectedId === rendererBaseline.selectedId &&
    playcanvasAfter.selectedWpId === rendererBaseline.selectedWpId;
  check('PlayCanvas renderer returns without losing state',
    playcanvasAfter.canvasReady && playcanvasAfter.droneProjected && playcanvasStatePreserved &&
      playcanvasAfter.sentinel === 'renderer-state-survives',
    `droneProjected=${playcanvasAfter.droneProjected} statePreserved=${playcanvasStatePreserved} ` +
      `noReload=${playcanvasAfter.sentinel === 'renderer-state-survives'}`);

  // ---- responsive layout remains usable on a narrow mobile viewport
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  const mobileLayout = await page.evaluate(() => {
    const selectors = ['.top-bar', '.left-panel', '.right-panel', '.bottom-bar'];
    const rects = Object.fromEntries(selectors.map((selector) => {
      const element = document.querySelector(selector);
      const rect = element?.getBoundingClientRect();
      return [selector, rect ? {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      } : null];
    }));
    const insideViewport = Object.values(rects).every((rect) => rect &&
      rect.top >= -0.5 && rect.left >= -0.5 &&
      rect.right <= window.innerWidth + 0.5 && rect.bottom <= window.innerHeight + 0.5 &&
      rect.width > 0 && rect.height > 0);
    return {
      insideViewport,
      panelsSeparated: rects['.left-panel']?.right < rects['.right-panel']?.left,
      noPageOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      canvasReady: document.querySelector('#pc-canvas')?.clientWidth > 0 &&
        document.querySelector('#pc-canvas')?.clientHeight > 0,
    };
  });
  check('mobile controls remain visible and separated',
    mobileLayout.insideViewport && mobileLayout.panelsSeparated && mobileLayout.noPageOverflow &&
      mobileLayout.canvasReady,
    JSON.stringify(mobileLayout));

  // ---- persisted waypoint IDs remain unique after a fresh page session
  await page.setViewportSize({ width: 1280, height: 720 });
  const persistedIds = await page.evaluate(() => {
    const scenario = window.__simApi.engine.serialize();
    localStorage.setItem('drone-rf-sim.scenario.v1', JSON.stringify(scenario));
    return [scenario.drone, ...scenario.scouts].flatMap((entity) =>
      entity.waypoints.map((waypoint) => waypoint.id));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction('window.__simReady === true', null, { timeout: 40000 });
  await page.click('[data-testid="btn-load"]');
  await page.waitForTimeout(300);
  const postReloadWaypoint = await page.evaluate(() => {
    const engine = window.__simApi.engine;
    const added = engine.addWaypoint('drone-1', 125, -175);
    const ids = [engine.drone, ...engine.scouts].flatMap((entity) =>
      entity.waypoints.map((waypoint) => waypoint.id));
    return { addedId: added.id, ids, uniqueCount: new Set(ids).size };
  });
  check('loaded scenario generates a collision-free waypoint ID',
    postReloadWaypoint.ids.length === postReloadWaypoint.uniqueCount &&
      !persistedIds.includes(postReloadWaypoint.addedId),
    `added=${postReloadWaypoint.addedId} total=${postReloadWaypoint.ids.length} ` +
      `unique=${postReloadWaypoint.uniqueCount}`);

} finally {
  try {
    await browser?.close();
  } finally {
    await server.stop();
  }
}

console.log('\n--- summary ---');
console.log(`${results.filter((r) => r.ok).length}/${results.length} checks passed`);
console.log('--- console errors ---');
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)');
console.log('--- failed requests ---');
console.log(failedRequests.length ? failedRequests.join('\n') : '(none)');
process.exit(failures || consoleErrors.length || failedRequests.length ? 2 : 0);
