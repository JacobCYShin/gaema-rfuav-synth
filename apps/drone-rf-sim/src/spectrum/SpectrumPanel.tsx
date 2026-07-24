import { useEffect, useRef, useState } from 'react';
import { engine } from '../state/store';
import { heroSpectrum, loadHeroReplay } from './heroReplay';
import type { HeroReplay } from './heroReplay';
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
  const [heroReplay, setHeroReplay] = useState<HeroReplay | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [heroError, setHeroError] = useState(false);

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
    if (!profile) return;
    let cancelled = false;
    void loadHeroReplay(profile)
      .then((replay) => {
        if (!cancelled) setHeroReplay(replay);
      })
      .catch(() => {
        if (!cancelled) setHeroError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

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
      const usingHero = heroReplay !== null;
      const liveTime =
        engine.mode === 'run' || engine.mode === 'replay' ? engine.simTime : nowMs / 1000;
      const heroResult = heroReplay
        ? heroSpectrum(heroReplay, profile, nowMs / 1000, row)
        : null;
      const liveResult = heroResult
        ? null
        : liveSpectrum(
            profile,
            engine.scouts.map((scout) => scout.rssi),
            liveTime,
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

      if (heroResult?.activeLabels.length) {
        context.strokeStyle = 'rgba(114, 230, 255, 0.92)';
        context.lineWidth = 1;
        for (const label of heroResult.activeLabels) {
          const x = (1 - label.cy - label.h / 2) * DISPLAY_FREQ_BINS;
          context.strokeRect(x, TRACE_HEIGHT + 0.5, label.h * DISPLAY_FREQ_BINS, 8);
        }
      }

      if (frame % 12 === 0) {
        panel.dataset.profileLoaded = 'true';
        panel.dataset.heroLoaded = String(heroReplay !== null);
        panel.dataset.spectrumSource = usingHero ? 'hero' : 'live';
        if (heroResult) {
          panel.dataset.heroRow = String(heroResult.rowIndex);
          panel.dataset.activeLabels = String(heroResult.activeLabels.length);
        } else if (liveResult) {
          panel.dataset.hopIndex = String(liveResult.hopIndex);
          panel.dataset.fhssActive = String(liveResult.fhssActive);
          panel.dataset.videoActive = String(liveResult.videoActive);
          panel.dataset.strongestRssi =
            liveResult.strongestRssi === null ? 'none' : liveResult.strongestRssi.toFixed(1);
          panel.dataset.rssiGainDb = liveResult.rssiGainDb.toFixed(2);
        }
        panel.dataset.rowMin = Math.min(...row).toFixed(2);
        panel.dataset.rowMax = Math.max(...row).toFixed(2);
      }
      frame += 1;
      animationFrame = requestAnimationFrame(draw);
    };
    animationFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationFrame);
  }, [heroReplay, profile]);

  const sourceLabel = loadError
    ? 'PROFILE ERROR'
    : heroReplay
      ? 'VERIFIED REPLAY'
      : heroError
        ? 'LIVE FALLBACK'
        : 'CAPTURE LOADING';

  return (
    <div
      className="panel spectrum-panel"
      data-testid="spectrum-panel"
      data-profile-loaded={profile ? 'true' : 'false'}
      data-hero-loaded={heroReplay ? 'true' : 'false'}
      data-spectrum-source={heroReplay ? 'hero' : 'live'}
      ref={panelRef}
    >
      <div className="spectrum-head">
        <div>
          <strong>RF SPECTRUM</strong>
          <span>{profile?.drone ?? 'PROFILE LOADING'}</span>
        </div>
        <span className={`spectrum-source ${loadError ? 'error' : ''}`}>
          {sourceLabel}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        width={DISPLAY_FREQ_BINS}
        height={CANVAS_HEIGHT}
        aria-label="RF spectrum and waterfall"
      />
      <div className="spectrum-axis">
        <span>{profile ? `${((profile.center_freq_hz - profile.span_hz / 2) / 1e9).toFixed(3)} GHz` : '--'}</span>
        <span>{profile?.colormap.toUpperCase() ?? '--'} · PROFILE LOCK</span>
        <span>{profile ? `${((profile.center_freq_hz + profile.span_hz / 2) / 1e9).toFixed(3)} GHz` : '--'}</span>
      </div>
    </div>
  );
}
