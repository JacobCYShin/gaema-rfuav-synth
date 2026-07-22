/**
 * Physically-grounded RF propagation for a small-drone control/video link.
 *
 * This replaces the earlier ad-hoc `RSSI = -38 - 22·log10(d/10)` placeholder
 * with a real link budget so that received power, noise and SNR are traceable
 * to textbook electromagnetics rather than tuned magic numbers.
 *
 * Chain (all in dB / dBm):
 *   1. Free-space path loss ...... Friis transmission equation (Friis, 1946)
 *   2. Log-distance path loss .... FSPL(d0) + 10·n·log10(d/d0) + Xσ
 *                                  (Rappaport, "Wireless Communications:
 *                                   Principles and Practice", 2nd ed., §4.9)
 *   3. Link budget → RSSI ........ RSSI = Ptx + Gtx + Grx − PL
 *   4. Thermal noise floor ....... N = kТB → −174 dBm/Hz + 10·log10(B) + NF
 *                                  (Johnson–Nyquist thermal noise, T0 = 290 K)
 *   5. SNR = RSSI − N
 *
 * The SNR produced here is exactly the quantity that
 * gaema-rfuav-synth's `add_awgn_at_snr(signal, target_snr_db)` consumes, so
 * this module is the physical bridge between drone/scout geometry and that
 * signal-morphology pipeline.
 */

/** Speed of light in vacuum, m/s (CODATA, exact by SI definition). */
export const SPEED_OF_LIGHT = 299_792_458;

/**
 * Thermal noise power spectral density at the standard reference temperature
 * T0 = 290 K: 10·log10(k·T0 / 1 mW) = −173.98 dBm/Hz. (k = 1.380649e-23 J/K)
 */
export const THERMAL_NOISE_DBM_PER_HZ = -173.98;

/** Link-budget parameters for one Tx (drone) ↔ Rx (ground scout) pair. */
export interface LinkBudgetParams {
  /** drone transmit power, dBm. 20 dBm = 100 mW — DJI OcuSync CE EIRP limit. */
  txPowerDbm: number;
  /** drone antenna gain, dBi. ~2 dBi for a near-omni whip. */
  txAntennaGainDbi: number;
  /** scout antenna gain, dBi. ~3 dBi for a handheld panel/omni. */
  rxAntennaGainDbi: number;
  /**
   * path-loss exponent n. 2.0 = ideal free space; 2.0–2.7 for near-LOS
   * ground-to-air with light clutter (the drone is elevated, so the link is
   * mostly line-of-sight). Urban NLOS would be 3–5.
   */
  pathLossExponent: number;
  /** reference distance d0 for the log-distance anchor, m (far-field, ≥1 m). */
  refDistanceM: number;
  /** log-normal shadowing standard deviation σ, dB (Rappaport §4.9.1). */
  shadowingSigmaDb: number;
  /** receiver noise figure, dB. 6 dB is typical for a consumer SDR front-end. */
  noiseFigureDb: number;
  /** receiver noise bandwidth, Hz. ~10 MHz OcuSync channel occupancy. */
  bandwidthHz: number;
  /** carrier frequency, Hz. DJI-class links: 2.45 GHz or 5.8 GHz ISM. */
  frequencyHz: number;
}

/** DJI-class consumer drone received by a handheld ground scout (2.45 GHz). */
export const DEFAULT_LINK_BUDGET: LinkBudgetParams = {
  txPowerDbm: 20,
  txAntennaGainDbi: 2,
  rxAntennaGainDbi: 3,
  pathLossExponent: 2.2,
  refDistanceM: 1,
  shadowingSigmaDb: 5,
  noiseFigureDb: 6,
  bandwidthHz: 10e6,
  frequencyHz: 2.45e9,
};

/**
 * Free-space path loss (Friis), dB.
 *   FSPL = 20·log10(4π·d·f / c) = 20·log10(d) + 20·log10(f) − 147.55
 * @param distanceM separation, metres
 * @param freqHz    carrier frequency, Hz
 */
export function freeSpacePathLossDb(distanceM: number, freqHz: number): number {
  const d = Math.max(distanceM, 1e-3);
  return 20 * Math.log10((4 * Math.PI * d * freqHz) / SPEED_OF_LIGHT);
}

/**
 * Log-distance path loss, dB: free-space loss to the reference distance, then
 * decay at 10·n dB/decade beyond it, plus an optional shadowing offset.
 */
export function pathLossDb(
  distanceM: number,
  p: LinkBudgetParams,
  shadowingDb = 0,
): number {
  const d = Math.max(distanceM, p.refDistanceM);
  const pl0 = freeSpacePathLossDb(p.refDistanceM, p.frequencyHz);
  return pl0 + 10 * p.pathLossExponent * Math.log10(d / p.refDistanceM) + shadowingDb;
}

/** Receiver thermal noise floor, dBm: N = −174 dBm/Hz + 10·log10(B) + NF. */
export function noiseFloorDbm(p: LinkBudgetParams): number {
  return THERMAL_NOISE_DBM_PER_HZ + 10 * Math.log10(p.bandwidthHz) + p.noiseFigureDb;
}

export interface LinkResult {
  /** total path loss, dB (incl. shadowing) */
  pathLossDb: number;
  /** received signal strength, dBm */
  rssiDbm: number;
  /** noise floor, dBm */
  noiseDbm: number;
  /** signal-to-noise ratio, dB */
  snrDb: number;
}

/** Full link budget for a given geometry: distance → RSSI, noise and SNR. */
export function linkBudget(
  distanceM: number,
  p: LinkBudgetParams,
  shadowingDb = 0,
): LinkResult {
  const pl = pathLossDb(distanceM, p, shadowingDb);
  const rssi = p.txPowerDbm + p.txAntennaGainDbi + p.rxAntennaGainDbi - pl;
  const noise = noiseFloorDbm(p);
  return { pathLossDb: pl, rssiDbm: rssi, noiseDbm: noise, snrDb: rssi - noise };
}

/**
 * Invert the (shadowing-free) link budget: the distance, in metres, that would
 * produce a given RSSI. Used to turn a measured RSSI back into a range ring for
 * multilateration — the physical inverse of {@link linkBudget}.
 */
export function distanceFromRssi(rssiDbm: number, p: LinkBudgetParams): number {
  const pl = p.txPowerDbm + p.txAntennaGainDbi + p.rxAntennaGainDbi - rssiDbm;
  const pl0 = freeSpacePathLossDb(p.refDistanceM, p.frequencyHz);
  const exponent = (pl - pl0) / (10 * p.pathLossExponent);
  return p.refDistanceM * Math.pow(10, exponent);
}

/**
 * The distance at which the mean SNR (no shadowing) drops to a threshold — the
 * emergent detection radius of the link, derived from physics rather than a
 * hardcoded constant.
 */
export function detectionRangeM(snrThresholdDb: number, p: LinkBudgetParams): number {
  const rssiAtThreshold = noiseFloorDbm(p) + snrThresholdDb;
  return distanceFromRssi(rssiAtThreshold, p);
}
