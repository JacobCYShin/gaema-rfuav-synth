import { useEffect, useRef, useState } from 'react';
import { engine } from '../state/store';
import { DISPLAY_FREQ_BINS, liveSpectrum } from './liveSpectrum';
import type { SignalProfile } from './types';

const TRACE_HEIGHT = 48;
const WATERFALL_HEIGHT = 112;
const CANVAS_HEIGHT = TRACE_HEIGHT + WATERFALL_HEIGHT;
const PROFILE_URL = '/assets/spectro/profile_DJI_MINI3.json';

function parseColor(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

export function SpectrumPanel(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState<SignalProfile | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(PROFILE_URL, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`signal profile HTTP ${response.status}`);
        return response.json() as Promise<SignalProfile>;
      })
      .then(setProfile)
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError') setLoadError(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const panel = panelRef.current;
    if (!canvas || !panel || !profile) return;

    const context = canvas.getContext('2d');
    if (!context) return;
    const lut = profile.colormap_lut.map(parseColor);
    const waterfall = context.createImageData(DISPLAY_FREQ_BINS, WATERFALL_HEIGHT);
    const row = new Float32Array(DISPLAY_FREQ_BINS);
    const rowBytes = DISPLAY_FREQ_BINS * 4;
    let frame = 0;
    let animationFrame = 0;

    const draw = (nowMs: number): void => {
      const displayTime =
        engine.mode === 'run' || engine.mode === 'replay' ? engine.simTime : nowMs / 1000;
      const result = liveSpectrum(
        profile,
        engine.scouts.map((scout) => scout.rssi),
        displayTime,
        row,
      );

      waterfall.data.copyWithin(rowBytes, 0, waterfall.data.length - rowBytes);
      for (let bin = 0; bin < DISPLAY_FREQ_BINS; bin += 1) {
        const normalized = (row[bin] - profile.db_min) / (profile.db_max - profile.db_min);
        const colorIndex = Math.max(0, Math.min(255, Math.round(normalized * 255)));
        const [red, green, blue] = lut[colorIndex];
        const pixel = bin * 4;
        waterfall.data[pixel] = red;
        waterfall.data[pixel + 1] = green;
        waterfall.data[pixel + 2] = blue;
        waterfall.data[pixel + 3] = 255;
      }

      context.fillStyle = '#071019';
      context.fillRect(0, 0, DISPLAY_FREQ_BINS, TRACE_HEIGHT);
      context.strokeStyle = '#72e6ff';
      context.lineWidth = 1;
      context.beginPath();
      for (let bin = 0; bin < DISPLAY_FREQ_BINS; bin += 1) {
        const normalized = (row[bin] - profile.db_min) / (profile.db_max - profile.db_min);
        const y = TRACE_HEIGHT - 2 - normalized * (TRACE_HEIGHT - 5);
        if (bin === 0) context.moveTo(bin, y);
        else context.lineTo(bin, y);
      }
      context.stroke();
      context.putImageData(waterfall, 0, TRACE_HEIGHT);

      if (frame % 12 === 0) {
        panel.dataset.profileLoaded = 'true';
        panel.dataset.spectrumSource = 'live';
        panel.dataset.hopIndex = String(result.hopIndex);
        panel.dataset.fhssActive = String(result.fhssActive);
        panel.dataset.videoActive = String(result.videoActive);
        panel.dataset.strongestRssi =
          result.strongestRssi === null ? 'none' : result.strongestRssi.toFixed(1);
        panel.dataset.rssiGainDb = result.rssiGainDb.toFixed(2);
        panel.dataset.rowMin = Math.min(...row).toFixed(2);
        panel.dataset.rowMax = Math.max(...row).toFixed(2);
      }
      frame += 1;
      animationFrame = requestAnimationFrame(draw);
    };
    animationFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationFrame);
  }, [profile]);

  return (
    <div
      className="panel spectrum-panel"
      data-testid="spectrum-panel"
      data-profile-loaded={profile ? 'true' : 'false'}
      data-spectrum-source="live"
      ref={panelRef}
    >
      <div className="spectrum-head">
        <div>
          <strong>RF SPECTRUM</strong>
          <span>{profile?.drone ?? 'PROFILE LOADING'}</span>
        </div>
        <span className={`spectrum-source ${loadError ? 'error' : ''}`}>
          {loadError ? 'PROFILE ERROR' : 'LIVE APPROX'}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        width={DISPLAY_FREQ_BINS}
        height={CANVAS_HEIGHT}
        aria-label="Live RF spectrum and waterfall"
      />
      <div className="spectrum-axis">
        <span>{profile ? `${((profile.center_freq_hz - profile.span_hz / 2) / 1e9).toFixed(3)} GHz` : '--'}</span>
        <span>{profile?.colormap.toUpperCase() ?? '--'} · PROFILE LOCK</span>
        <span>{profile ? `${((profile.center_freq_hz + profile.span_hz / 2) / 1e9).toFixed(3)} GHz` : '--'}</span>
      </div>
    </div>
  );
}
