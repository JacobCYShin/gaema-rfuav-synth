// Integration check (Step 2): the RF fusion model actually drives per-scout
// RSSI from the physical link budget. Places the drone + scouts at known
// geometry, ticks MockRfModel.update(), and asserts each scout's reported RSSI
// equals linkBudget(distance) — reproducing the model's deterministic
// shadowing exactly, so this is an equality check, not a loose bound.
import * as esbuild from 'esbuild';
import { linkBudget, noiseFloorDbm, DEFAULT_LINK_BUDGET } from '../src/sim/propagation.ts';

// rf.ts uses extensionless relative imports (vite/tsc resolve them; raw Node
// ESM does not), so bundle it with esbuild and import the self-contained result.
const built = await esbuild.build({
  entryPoints: [new URL('../src/sim/rf.ts', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const { MockRfModel } = await import(
  'data:text/javascript,' + encodeURIComponent(built.outputFiles[0].text)
);

const P = DEFAULT_LINK_BUDGET;
const SEEDS = { A: 1.3, B: 2.7, C: 4.1 };

// must match propagation-free deterministic shadowing in rf.ts
const noise = (t, seed) =>
  Math.sin(t * 1.9 + seed * 12.9) * 0.55 +
  Math.sin(t * 3.7 + seed * 78.2) * 0.3 +
  Math.sin(t * 6.3 + seed * 37.7) * 0.15;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

let pass = 0;
let fail = 0;
const check = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);
  cond ? pass++ : fail++;
};

const dronePos = { x: 0, y: 0, alt: 100 };
const scouts = [
  { id: 'A', pos: { x: 100, y: 0, alt: 0 }, receiverOn: true }, // 3D dist ≈ 141 m
  { id: 'B', pos: { x: 500, y: 0, alt: 0 }, receiverOn: true }, // ≈ 510 m
  { id: 'C', pos: { x: 0, y: 1000, alt: 0 }, receiverOn: true }, // ≈ 1005 m
];
const dist3d = (s) => Math.hypot(dronePos.x - s.pos.x, dronePos.y - s.pos.y, dronePos.alt - s.pos.alt);

const model = new MockRfModel();
const time = 0;
const F24 = 2.45e9;
const out = model.update({ dronePos, droneAirborne: true, scouts, dt: 0.1, time, frequencyHz: F24 });

console.log('\n— per-scout RSSI equals physical link budget (with model shadowing) —');
console.log('  scout   dist(m)   model RSSI   predicted   Δ');
for (const s of scouts) {
  const d = dist3d(s);
  const shadow = noise(time, SEEDS[s.id]) * P.shadowingSigmaDb;
  const predicted = Math.round(clamp(linkBudget(d, P, shadow).rssiDbm, -115, -20) * 10) / 10;
  const got = out.perScout[s.id].rssi;
  const dd = Math.abs(got - predicted);
  console.log(
    `    ${s.id}    ${d.toFixed(1).padStart(7)}   ${String(got).padStart(9)}   ${String(predicted).padStart(9)}   ${dd.toFixed(3)}`,
  );
  check(dd <= 0.05, `scout ${s.id} RSSI matches link budget`, `${got} vs ${predicted} dBm`);
}

console.log('\n— sanity: closer scout hears a stronger signal —');
check(out.perScout.A.rssi > out.perScout.B.rssi, 'A (141 m) louder than B (510 m)');
check(out.perScout.B.rssi > out.perScout.C.rssi, 'B (510 m) louder than C (1005 m)');

console.log('\n— receiver off ⇒ no RSSI —');
const out2 = model.update({
  dronePos,
  droneAirborne: true,
  scouts: scouts.map((s) => (s.id === 'A' ? { ...s, receiverOn: false } : s)),
  dt: 0.1,
  time: 0.1,
  frequencyHz: F24,
});
check(out2.perScout.A.rssi === null, 'scout A with receiver off reports null RSSI');

console.log('\n— grounded drone (not airborne) ⇒ no link —');
const out3 = model.update({ dronePos, droneAirborne: false, scouts, dt: 0.1, time: 0.2, frequencyHz: F24 });
check(
  out3.perScout.A.rssi === null && out3.perScout.B.rssi === null,
  'no RSSI while drone is on the ground',
);

console.log('\n— frequency band effect: 5.8 GHz shortens detection range vs 2.45 GHz —');
const det24 = out.detectionRangeM;
const out58 = model.update({ dronePos, droneAirborne: true, scouts, dt: 0.1, time: 0.3, frequencyHz: 5.8e9 });
const det58 = out58.detectionRangeM;
console.log(`  detection range: 2.45 GHz = ${det24.toFixed(0)} m, 5.8 GHz = ${det58.toFixed(0)} m, ratio = ${(det24 / det58).toFixed(2)}`);
check(det24 > det58, '5.8 GHz detection range shorter than 2.45 GHz');
check(Math.abs(det24 / det58 - 2.19) < 0.05, 'detection-range ratio matches 7.48 dB theory (≈2.19×)');
check(Math.abs(out.noiseFloorDbm - -97.98) < 0.05, 'reported noise floor = -97.98 dBm');

console.log(`\nnoise floor = ${noiseFloorDbm(P).toFixed(2)} dBm  |  detect threshold = 14 dB SNR`);
console.log(`${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
