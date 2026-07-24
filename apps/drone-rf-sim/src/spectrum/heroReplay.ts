import type { SignalProfile } from './types';

export interface HeroManifest {
  version: number;
  drone: string;
  profile: string;
  fs_hz: number;
  center_freq_hz: number;
  freq_min_hz: number;
  freq_max_hz: number;
  n_time: number;
  n_freq: number;
  row_dt_s: number;
  duration_s: number;
  db_min: number;
  db_max: number;
  display_db_min: number;
  display_db_max: number;
  colormap: string;
  data: string;
  labels: string;
  loop: boolean;
  seed: number;
}

export interface HeroLabel {
  class_id: number;
  kind: 'fhss_burst' | 'video_signal';
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface HeroReplay {
  manifest: HeroManifest;
  data: Uint8Array;
  labels: HeroLabel[];
}

export interface HeroRow {
  values: Float32Array;
  rowIndex: number;
  activeLabels: HeroLabel[];
}

export async function loadHeroReplay(
  profile: SignalProfile,
  manifestUrl = '/assets/spectro/manifest.json',
): Promise<HeroReplay> {
  const manifestResponse = await fetch(manifestUrl);
  if (!manifestResponse.ok) throw new Error(`hero manifest HTTP ${manifestResponse.status}`);
  const manifest = (await manifestResponse.json()) as HeroManifest;
  if (
    manifest.drone !== profile.drone ||
    manifest.seed !== profile.seed ||
    manifest.colormap !== profile.colormap ||
    manifest.n_freq !== 256
  ) {
    throw new Error('hero manifest does not match the loaded signal profile');
  }

  const base = new URL('.', new URL(manifestUrl, window.location.href));
  const [dataResponse, labelsResponse] = await Promise.all([
    fetch(new URL(manifest.data, base)),
    fetch(new URL(manifest.labels, base)),
  ]);
  if (!dataResponse.ok) throw new Error(`hero data HTTP ${dataResponse.status}`);
  if (!labelsResponse.ok) throw new Error(`hero labels HTTP ${labelsResponse.status}`);
  const data = new Uint8Array(await dataResponse.arrayBuffer());
  if (data.length !== manifest.n_time * manifest.n_freq) {
    throw new Error('hero spectrogram size does not match manifest dimensions');
  }
  return {
    manifest,
    data,
    labels: (await labelsResponse.json()) as HeroLabel[],
  };
}

export function heroSpectrum(
  replay: HeroReplay,
  profile: SignalProfile,
  time: number,
  out: Float32Array,
): HeroRow {
  const { manifest, data, labels } = replay;
  const rawIndex = Math.floor(time / manifest.row_dt_s);
  const rowIndex = manifest.loop
    ? ((rawIndex % manifest.n_time) + manifest.n_time) % manifest.n_time
    : Math.max(0, Math.min(manifest.n_time - 1, rawIndex));
  const offset = rowIndex * manifest.n_freq;
  const displayRange = profile.db_max - profile.db_min;
  for (let bin = 0; bin < manifest.n_freq; bin += 1) {
    out[bin] = profile.db_min + (data[offset + bin] / 255) * displayRange;
  }
  const normalizedTime = (rowIndex + 0.5) / manifest.n_time;
  return {
    values: out,
    rowIndex,
    activeLabels: labels.filter(
      (label) =>
        normalizedTime >= label.cx - label.w / 2 &&
        normalizedTime <= label.cx + label.w / 2,
    ),
  };
}
