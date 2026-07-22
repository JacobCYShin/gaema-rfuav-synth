import type {
  Estimate,
  FusionStatus,
  RfInput,
  RfModel,
  RfOutput,
  RfScoutOutput,
  ScoutId,
  WorldPos,
} from './types';
import {
  DEFAULT_LINK_BUDGET,
  detectionRangeM,
  distanceFromRssi,
  linkBudget,
  noiseFloorDbm,
  type LinkBudgetParams,
} from './propagation';

/**
 * RF fusion model. Per-scout received power is now computed from a physically
 * grounded link budget (see propagation.ts — Friis free-space loss +
 * log-distance path loss + thermal-noise floor), so RSSI and SNR are traceable
 * to electromagnetics rather than tuned constants. The layers on top —
 * detection with SNR hysteresis, confidence smoothing, weighted
 * multilateration and the uncertainty estimate — remain engineering heuristics:
 *
 *  1. per-scout RSSI/SNR from the physical link budget + shadowing (propagation.ts)
 *  2. detection decided by SNR against the thermal-noise floor (with hysteresis)
 *  3. RSSI inverted back to a range estimate per scout (physical inverse)
 *  4. fused position from weighted multilateration over detecting scouts
 *  5. uncertainty radius from ranging residuals + geometry quality
 *
 * The SNR here is exactly what gaema-rfuav-synth's add_awgn_at_snr consumes, so
 * swapping this class for a WebSocket bridge to that pipeline needs no other
 * change — the RfModel interface is the seam.
 */

const SNR_DETECT_DB = 14; // detection threshold → emergent radius ≈ 1.3 km @ 2.45 GHz with the default link budget
const SEEDS: Record<ScoutId, number> = { A: 1.3, B: 2.7, C: 4.1 };

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** deterministic pseudo-noise so replays and scrubbing stay reproducible */
function noise(t: number, seed: number): number {
  return (
    Math.sin(t * 1.9 + seed * 12.9) * 0.55 +
    Math.sin(t * 3.7 + seed * 78.2) * 0.3 +
    Math.sin(t * 6.3 + seed * 37.7) * 0.15
  );
}

/**
 * Physically-grounded received power (dBm) for one scout, with deterministic
 * pseudo-shadowing so replays and video capture stay byte-reproducible. The
 * shadowing term stands in for a log-normal Xσ of the configured σ.
 */
function rssiAt(dist: number, t: number, seed: number, p: LinkBudgetParams): number {
  const shadowingDb = noise(t, seed) * p.shadowingSigmaDb;
  const { rssiDbm } = linkBudget(dist, p, shadowingDb);
  return clamp(rssiDbm, -115, -20);
}

interface Ranging {
  x: number;
  y: number;
  range: number;
  weight: number;
}

/** weighted linear least-squares multilateration (3+ rangings) */
function multilaterate(r: Ranging[]): { x: number; y: number } | null {
  const ref = r[0];
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 1; i < r.length; i++) {
    const ri = r[i];
    const w = Math.min(ref.weight, ri.weight) + 0.05;
    const ax = 2 * (ri.x - ref.x);
    const ay = 2 * (ri.y - ref.y);
    const bv =
      ref.range * ref.range -
      ri.range * ri.range +
      (ri.x * ri.x - ref.x * ref.x) +
      (ri.y * ri.y - ref.y * ref.y);
    a11 += w * ax * ax;
    a12 += w * ax * ay;
    a22 += w * ay * ay;
    b1 += w * ax * bv;
    b2 += w * ay * bv;
  }
  const det = a11 * a22 - a12 * a12;
  // scale-invariant conditioning guard: near-colinear scouts make the
  // normal equations ill-conditioned and the fix explodes
  if (det < 1e-3 * Math.max(1, a11 * a22)) return null;
  return { x: (a22 * b1 - a12 * b2) / det, y: (a11 * b2 - a12 * b1) / det };
}

export class MockRfModel implements RfModel {
  private conf: Record<ScoutId, number> = { A: 0, B: 0, C: 0 };
  private det: Record<ScoutId, boolean> = { A: false, B: false, C: false };
  private est: WorldPos | null = null;
  private uncertainty = 400;
  private staleFor = 0;
  private readonly params: LinkBudgetParams;

  constructor(params: Partial<LinkBudgetParams> = {}) {
    this.params = { ...DEFAULT_LINK_BUDGET, ...params };
  }

  reset(): void {
    this.conf = { A: 0, B: 0, C: 0 };
    this.det = { A: false, B: false, C: false };
    this.est = null;
    this.uncertainty = 400;
    this.staleFor = 0;
  }

  update(input: RfInput): RfOutput {
    const { dronePos, scouts, dt, time } = input;
    // the drone's operating frequency sets the path loss for this tick
    const p: LinkBudgetParams = { ...this.params, frequencyHz: input.frequencyHz };
    const perScout = {} as Record<ScoutId, RfScoutOutput>;
    const rangings: Ranging[] = [];
    const activeConfs: number[] = [];
    let nDetecting = 0;
    const noiseFloor = noiseFloorDbm(p);

    for (const s of scouts) {
      const dist = Math.hypot(
        dronePos.x - s.pos.x,
        dronePos.y - s.pos.y,
        dronePos.alt - s.pos.alt,
      );
      const listening = s.receiverOn && input.droneAirborne;
      const rssi = listening ? rssiAt(dist, time, SEEDS[s.id], p) : null;
      const snr = rssi === null ? -Infinity : rssi - noiseFloor;
      // SNR hysteresis band so shadowing noise near the threshold can't flap
      // the detection state (and spam the event log) every few frames
      const detectable = this.det[s.id] ? snr > SNR_DETECT_DB - 1.5 : snr > SNR_DETECT_DB + 1.5;
      this.det[s.id] = detectable;
      // confidence ramps with SNR margin, smoothed
      const target = detectable ? clamp01((snr - SNR_DETECT_DB + 2) / 16) : 0;
      const rate = target > this.conf[s.id] ? 0.55 : 0.85;
      this.conf[s.id] += (target - this.conf[s.id]) * Math.min(1, rate * dt * 3);
      const confidence = clamp01(this.conf[s.id]);
      const detecting = confidence > 0.22 && detectable;
      if (detecting) {
        nDetecting++;
        // horizontal range: project slant range using an assumed altitude band
        const slant = distanceFromRssi(rssi!, p);
        const assumedAlt = clamp(dronePos.alt + noise(time * 0.6, SEEDS[s.id] + 9) * 15, 20, 200);
        const horiz = Math.sqrt(Math.max(100, slant * slant - assumedAlt * assumedAlt));
        rangings.push({ x: s.pos.x, y: s.pos.y, range: horiz, weight: confidence });
      }
      if (s.receiverOn) activeConfs.push(confidence);
      perScout[s.id] = {
        rssi: rssi === null ? null : Math.round(rssi * 10) / 10,
        confidence,
        detecting,
      };
    }

    activeConfs.sort((a, b) => b - a);
    const combined = clamp01(
      0.7 * (activeConfs[0] ?? 0) + 0.35 * (activeConfs[1] ?? 0) + 0.2 * (activeConfs[2] ?? 0),
    );

    if (nDetecting > 0) {
      this.staleFor = 0;
      const solved = this.solvePosition(rangings, time);
      const desired: WorldPos = {
        x: solved.x,
        y: solved.y,
        alt: clamp(dronePos.alt + noise(time * 0.8, 8) * 20 * (1 - combined) + 4, 15, 400),
      };
      if (!this.est) {
        this.est = { ...desired };
      } else {
        const k = 1 - Math.exp(-1.5 * dt);
        this.est.x += (desired.x - this.est.x) * k;
        this.est.y += (desired.y - this.est.y) * k;
        this.est.alt += (desired.alt - this.est.alt) * k;
      }
      // uncertainty: ranging residuals against the fused point + geometry term
      let residual = 0;
      for (const r of rangings) {
        residual += Math.abs(Math.hypot(this.est.x - r.x, this.est.y - r.y) - r.range);
      }
      residual /= rangings.length;
      const geomPenalty = nDetecting >= 3 ? 0 : nDetecting === 2 ? 70 : 190;
      const target = clamp(18 + residual * 1.1 + geomPenalty + 260 * Math.pow(1 - combined, 1.6), 20, 620);
      this.uncertainty += (target - this.uncertainty) * Math.min(1, dt * 1.5);
    } else if (this.est) {
      this.staleFor += dt;
      this.uncertainty = Math.min(650, this.uncertainty + 30 * dt);
      if (this.staleFor > 8) this.est = null;
    }

    let status: FusionStatus;
    if (!this.est) status = 'SEARCHING';
    else if (this.staleFor > 1.2) status = 'LOST';
    else if (nDetecting >= 2 && combined >= 0.55) status = 'TRACKING';
    else if (combined < 0.32) status = 'LOW CONFIDENCE';
    else status = 'DETECTED';

    const estimate: Estimate = this.est
      ? {
          available: true,
          pos: { ...this.est },
          uncertainty: Math.round(this.uncertainty),
          confidence: combined,
          staleFor: this.staleFor,
        }
      : { available: false, pos: { x: 0, y: 0, alt: 0 }, uncertainty: 0, confidence: 0, staleFor: 0 };

    return {
      perScout,
      estimate,
      status,
      noiseFloorDbm: noiseFloor,
      detectionRangeM: detectionRangeM(SNR_DETECT_DB, p),
    };
  }

  /** fused ground position from however many rangings are available */
  private solvePosition(rangings: Ranging[], time: number): { x: number; y: number } {
    const prev = this.est;
    if (rangings.length >= 3) {
      const p = multilaterate(rangings);
      if (p) return p;
      // degenerate geometry: fall back to the two strongest rangings
      rangings = [...rangings].sort((a, b) => b.weight - a.weight).slice(0, 2);
    }
    if (rangings.length === 2) {
      // two-circle intersection; pick the branch closest to the previous fix
      const [a, b] = rangings;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      // clamp the radical-line foot so disjoint/contained circles (noisy
      // ranges) can't throw the fallback point kilometres past the baseline
      const l = clamp(
        (a.range * a.range - b.range * b.range + d * d) / (2 * d),
        -a.range,
        a.range,
      );
      const h2 = a.range * a.range - l * l;
      const mx = a.x + (l / d) * dx;
      const my = a.y + (l / d) * dy;
      if (h2 <= 0) return { x: mx, y: my };
      const h = Math.sqrt(h2);
      const p1 = { x: mx + (h / d) * dy, y: my - (h / d) * dx };
      const p2 = { x: mx - (h / d) * dy, y: my + (h / d) * dx };
      if (!prev) return Math.hypot(p1.x, p1.y) < Math.hypot(p2.x, p2.y) ? p1 : p2;
      return Math.hypot(p1.x - prev.x, p1.y - prev.y) < Math.hypot(p2.x - prev.x, p2.y - prev.y)
        ? p1
        : p2;
    }
    // single ranging: a point on the range ring, nearest the previous fix
    // (or biased toward the protected site when there is no history yet)
    const r = rangings[0];
    const toward = prev ?? { x: 0, y: 0, alt: 0 };
    let vx = toward.x - r.x;
    let vy = toward.y - r.y;
    const vlen = Math.hypot(vx, vy);
    if (vlen < 1) {
      const ang = noise(time * 0.2, 5) * Math.PI;
      vx = Math.cos(ang);
      vy = Math.sin(ang);
    } else {
      vx /= vlen;
      vy /= vlen;
    }
    return { x: r.x + vx * r.range, y: r.y + vy * r.range };
  }
}
