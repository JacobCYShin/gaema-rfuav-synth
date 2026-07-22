// Numeric verification of the physical propagation model (Step 1).
//
// Imports the REAL src/sim/propagation.ts (Node 22+/24 strips the TS types)
// and asserts its output against values hand-computed from the Friis equation
// and the thermal-noise floor, independently of the module's own code. Run:
//   node scripts/verify-propagation.mjs
import {
  freeSpacePathLossDb,
  noiseFloorDbm,
  linkBudget,
  distanceFromRssi,
  detectionRangeM,
  DEFAULT_LINK_BUDGET,
} from '../src/sim/propagation.ts';

let pass = 0;
let fail = 0;
const approx = (got, want, tol, label) => {
  const ok = Math.abs(got - want) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${got.toFixed(3)}, want ${want.toFixed(3)} (±${tol})`);
  ok ? pass++ : fail++;
};

const P = DEFAULT_LINK_BUDGET; // 2.45 GHz, Ptx 20 dBm, Gt 2, Gr 3, n 2.2, NF 6, B 10 MHz

console.log('\n— Friis free-space path loss (n = 2), 2.45 GHz —');
// Reference: FSPL = 20log10(4π·d·f/c). K(1m,2.45GHz) = 40.231 dB, +20 dB/decade.
approx(freeSpacePathLossDb(1, 2.45e9), 40.231, 0.02, 'FSPL @ 1 m');
approx(freeSpacePathLossDb(100, 2.45e9), 80.231, 0.02, 'FSPL @ 100 m');
approx(freeSpacePathLossDb(1000, 2.45e9), 100.231, 0.02, 'FSPL @ 1 km');
// Cross-check against the textbook compact form 32.44 + 20log10(d_km) + 20log10(f_MHz)
const compact = 32.44 + 20 * Math.log10(1) + 20 * Math.log10(2450);
approx(freeSpacePathLossDb(1000, 2.45e9), compact, 0.05, 'FSPL @ 1 km vs 32.44+... form');

console.log('\n— Thermal noise floor —');
// N = -173.98 dBm/Hz + 10log10(10e6) + 6 dB = -97.98 dBm
approx(noiseFloorDbm(P), -97.98, 0.02, 'noise floor (B=10 MHz, NF=6)');

console.log('\n— Link budget → RSSI (log-distance, n = 2.2) —');
// RSSI = 25 dBm - [40.231 + 22·log10(d)]
approx(linkBudget(100, P).rssiDbm, -59.231, 0.03, 'RSSI @ 100 m');
approx(linkBudget(1000, P).rssiDbm, -81.231, 0.03, 'RSSI @ 1 km');
approx(linkBudget(100, P).snrDb, 38.749, 0.05, 'SNR @ 100 m');
approx(linkBudget(1000, P).snrDb, 16.749, 0.05, 'SNR @ 1 km');

console.log('\n— Inverse consistency: distanceFromRssi ∘ linkBudget = identity —');
for (const d of [50, 200, 500, 1200]) {
  const rssi = linkBudget(d, P).rssiDbm; // no shadowing
  approx(distanceFromRssi(rssi, P), d, d * 0.001, `invert RSSI(${d} m)`);
}

console.log('\n— Emergent detection radius (SNR threshold 14 dB) —');
approx(detectionRangeM(14, P), 1333, 2, 'detection range @ 2.45 GHz');
// 5.8 GHz has 20log10(5.8/2.45)=7.48 dB more loss → range shrinks by
// 10^(7.48/(10·2.2)) = 2.19×. Predicted: 1333/2.19 ≈ 609 m.
const P58 = { ...P, frequencyHz: 5.8e9 };
approx(detectionRangeM(14, P58), 609, 3, 'detection range @ 5.8 GHz');
approx(detectionRangeM(14, P) / detectionRangeM(14, P58), 2.19, 0.02, '2.45/5.8 GHz range ratio');

console.log('\n— Distance → RSSI / SNR table (2.45 GHz, mean, no shadowing) —');
console.log('   d(m)   PL(dB)   RSSI(dBm)   SNR(dB)   detect?');
for (const d of [10, 50, 100, 250, 500, 770, 1000, 1333, 2000]) {
  const r = linkBudget(d, P);
  const det = r.snrDb >= 14 ? 'yes' : 'no';
  console.log(
    `  ${String(d).padStart(5)}  ${r.pathLossDb.toFixed(1).padStart(6)}  ${r.rssiDbm.toFixed(1).padStart(9)}  ${r.snrDb.toFixed(1).padStart(7)}     ${det}`,
  );
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
