import type { SignalProfile, SpectrumRow } from './types';

export const DISPLAY_FREQ_BINS = 256;

function hash01(seed: number, a: number, b: number): number {
  let value = (seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value / 0xffffffff;
}

function addDb(baseDb: number, signalDb: number): number {
  return 10 * Math.log10(10 ** (baseDb / 10) + 10 ** (signalDb / 10));
}

function combinedRelativeGain(rssiByScout: readonly (number | null)[]): {
  gainDb: number;
  strongest: number | null;
} {
  const active = rssiByScout.filter((value): value is number => Number.isFinite(value));
  if (active.length === 0) return { gainDb: 0, strongest: null };
  const strongest = Math.max(...active);
  const combined = active.reduce((sum, value) => sum + 10 ** ((value - strongest) / 10), 0);
  return { gainDb: 10 * Math.log10(combined), strongest };
}

/**
 * Display-resolution approximation driven only by the exported validated
 * morphology profile and current simulated receiver levels.
 *
 * This single-function boundary is intentionally replaceable by a future
 * dev_light IQ -> STFT WASM implementation.
 */
export function liveSpectrum(
  profile: SignalProfile,
  rssiByScout: readonly (number | null)[],
  simTime: number,
  out = new Float32Array(DISPLAY_FREQ_BINS),
): SpectrumRow {
  if (out.length !== DISPLAY_FREQ_BINS) {
    throw new RangeError(`live spectrum output must contain ${DISPLAY_FREQ_BINS} bins`);
  }

  const quantizationDb = (profile.db_max - profile.db_min) / 255;
  const { gainDb, strongest } = combinedRelativeGain(rssiByScout);
  const dwell = profile.fhss.dwell_s;
  const hopCycle = Math.max(0, Math.floor(simTime / dwell));
  const hopIndex = hopCycle % profile.fhss.hops.length;
  const hopOffsetHz = profile.fhss.hops[hopIndex] ?? 0;
  const hopLocalTime = simTime - hopCycle * dwell;
  const timingJitter = (hash01(profile.seed, hopCycle, 1) * 2 - 1) * profile.fhss.timing_jitter_s;
  const durationScale =
    1 + (hash01(profile.seed, hopCycle, 2) * 2 - 1) * profile.fhss.duration_jitter_frac;
  const burstDuration = profile.fhss.burst_s * durationScale;
  const fhssActive = hopLocalTime >= Math.max(0, timingJitter) &&
    hopLocalTime < Math.max(0, timingJitter) + burstDuration;

  const videoPeriod = profile.video.tdd_period_s;
  const videoCycle = Math.max(0, Math.floor(simTime / videoPeriod));
  const videoLocalTime = simTime - videoCycle * videoPeriod;
  const videoJitter = (hash01(profile.seed, videoCycle, 3) * 2 - 1) * profile.video.jitter;
  const videoActive = videoLocalTime >= Math.max(0, videoJitter) &&
    videoLocalTime < Math.max(0, videoJitter) + videoPeriod * profile.video.duty;

  const binWidth = profile.span_hz / DISPLAY_FREQ_BINS;
  const fhssSigma = profile.fhss.bw_hz / (2 * Math.sqrt(2 * Math.log(2)));
  const fhssLevel =
    profile.noise_floor_db +
    profile.fhss.level_over_floor_db +
    gainDb +
    (hash01(profile.seed, hopCycle, 4) * 2 - 1) * profile.fhss.amp_jitter_db;
  const videoLevel = profile.noise_floor_db + profile.video.level_over_floor_db + gainDb;
  const videoHalfBandwidth = profile.video.bw_hz / 2;

  for (let bin = 0; bin < DISPLAY_FREQ_BINS; bin += 1) {
    const frequency = -profile.span_hz / 2 + (bin + 0.5) * binWidth;
    let level =
      profile.noise_floor_db +
      (hash01(profile.seed + Math.floor(simTime / quantizationDb), hopCycle, bin) * 2 - 1) *
        quantizationDb;

    if (fhssActive) {
      const delta = frequency - hopOffsetHz;
      const shapeDb = -4.342944819 * (delta * delta) / (2 * fhssSigma * fhssSigma);
      level = addDb(level, fhssLevel + shapeDb);
    }

    if (videoActive && Math.abs(frequency - profile.video.center_offset_hz) <= videoHalfBandwidth) {
      const ripple =
        (hash01(profile.seed + videoCycle, 5, bin) * 2 - 1) * profile.video.spectral_ripple_db;
      level = addDb(level, videoLevel + ripple);
    }

    out[bin] = Math.max(profile.db_min, Math.min(profile.db_max, level));
  }

  return {
    values: out,
    fhssActive,
    videoActive,
    hopIndex,
    hopOffsetHz,
    strongestRssi: strongest,
    rssiGainDb: gainDb,
  };
}
