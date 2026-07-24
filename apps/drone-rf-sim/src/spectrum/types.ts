export interface SignalProfile {
  version: number;
  drone: string;
  seed: number;
  center_freq_hz: number;
  span_hz: number;
  noise_floor_db: number;
  level_cal_db: number;
  fhss: {
    bw_hz: number;
    burst_s: number;
    dwell_s: number;
    hop_span_hz: number;
    hops: number[];
    timing_jitter_s: number;
    duration_jitter_frac: number;
    amp_jitter_db: number;
    freq_jitter_hz: number;
    level_over_floor_db: number;
  };
  video: {
    bw_hz: number;
    center_offset_hz: number;
    tdd_period_s: number;
    duty: number;
    jitter: number;
    spectral_ripple_db: number;
    level_over_floor_db: number;
  };
  db_min: number;
  db_max: number;
  colormap: string;
  colormap_lut: string[];
}

export interface SpectrumRow {
  values: Float32Array;
  fhssActive: boolean;
  videoActive: boolean;
  hopIndex: number;
  hopOffsetHz: number;
  strongestRssi: number | null;
  rssiGainDb: number;
}
