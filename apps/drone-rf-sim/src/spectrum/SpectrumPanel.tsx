import { useEffect, useRef, useState } from 'react';
import { engine } from '../state/store';
import { heroSpectrum, loadHeroReplay } from './heroReplay';
import type { HeroReplay } from './heroReplay';
import { DISPLAY_FREQ_BINS, liveSpectrum } from './liveSpectrum';
import { onSpectrumInteraction } from './sourceControl';
import type { SignalProfile } from './types';

const TRACE_HEIGHT = 48;
const WATERFALL_HEIGHT = 112;
const CANVAS_HEIGHT = TRACE_HEIGHT + WATERFALL_HEIGHT;
const PROFILE_URL = '/assets/spectro/profile_DJI_MINI3.json';
const IDLE_RETURN_MS = 6000;
const CROSSFADE_MS = 280;

type SpectrumSource = 'hero' | 'live';
type SpectrumMode = 'auto' | SpectrumSource;

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
  const lastRowRef = useRef(new Float32Array(DISPLAY_FREQ_BINS));
  const transitionFromRef = useRef(new Float32Array(DISPLAY_FREQ_BINS));
  const transitionStartedRef = useRef(0);
  const sourceRef = useRef<SpectrumSource>('live');
  const modeRef = useRef<SpectrumMode>('auto');
  const lastInteractionRef = useRef(0);
  const [profile, setProfile] = useState<SignalProfile | null>(null);
  const [heroReplay, setHeroReplay] = useState<HeroReplay | null>(null);
  const [source, setSource] = useState<SpectrumSource>('live');
  const [mode, setMode] = useState<SpectrumMode>('auto');
  const [loadError, setLoadError] = useState(false);
  const [heroError, setHeroError] = useState(false);

  const changeSource = (next: SpectrumSource): void => {
    if (sourceRef.current === next) return;
    transitionFromRef.current.set(lastRowRef.current);
    transitionStartedRef.current = performance.now();
    sourceRef.current = next;
    setSource(next);
  };

  const changeMode = (next: SpectrumMode): void => {
    modeRef.current = next;
    setMode(next);
    if (next === 'live') changeSource('live');
    else changeSource(heroReplay ? 'hero' : 'live');
  };

  useEffect(() => {
    const controller = new AbortController();
    void fetch(PROFILE_URL, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`signal profile HTTP ${response.status}`);
        return response.json() as Promise<SignalProfile>;
      })
      .then((loadedProfile) => {
        lastRowRef.current.fill(loadedProfile.db_min);
        transitionFromRef.current.fill(loadedProfile.db_min);
        setProfile(loadedProfile);
      })
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
        if (cancelled) return;
        setHeroReplay(replay);
        if (modeRef.current !== 'live') changeSource('hero');
      })
      .catch(() => {
        if (!cancelled) {
          setHeroError(true);
          changeSource('live');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  useEffect(
    () =>
      onSpectrumInteraction(() => {
        lastInteractionRef.current = performance.now();
        if (modeRef.current === 'auto') changeSource('live');
      }),
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const panel = panelRef.current;
    if (!canvas || !panel || !profile) return;

    const context = canvas.getContext('2d');
    if (!context) return;
    const lut = profile.colormap_lut.map(parseColor);
    const waterfall = context.createImageData(DISPLAY_FREQ_BINS, WATERFALL_HEIGHT);
    const targetRow = new Float32Array(DISPLAY_FREQ_BINS);
    const displayRow = new Float32Array(DISPLAY_FREQ_BINS);
    const rowBytes = DISPLAY_FREQ_BINS * 4;
    let frame = 0;
    let animationFrame = 0;

    const draw = (nowMs: number): void => {
      if (
        modeRef.current === 'auto' &&
        heroReplay &&
        (engine.mode === 'replay' ||
          (sourceRef.current === 'live' &&
            nowMs - lastInteractionRef.current >= IDLE_RETURN_MS))
      ) {
        changeSource('hero');
      }

      const usingHero = sourceRef.current === 'hero' && heroReplay !== null;
      const liveTime =
        engine.mode === 'run' || engine.mode === 'replay' ? engine.simTime : nowMs / 1000;
      let heroResult: ReturnType<typeof heroSpectrum> | null = null;
      let liveResult: ReturnType<typeof liveSpectrum> | null = null;
      try {
        if (usingHero && heroReplay) {
          heroResult = heroSpectrum(heroReplay, profile, nowMs / 1000, targetRow);
        } else {
          liveResult = liveSpectrum(
            profile,
            engine.scouts.map((scout) => scout.rssi),
            liveTime,
            targetRow,
          );
        }
        panel.dataset.spectrumDegraded = 'false';
      } catch {
        targetRow.set(lastRowRef.current);
        panel.dataset.spectrumDegraded = 'true';
      }

      const transitionElapsed = nowMs - transitionStartedRef.current;
      const transitioning =
        transitionStartedRef.current > 0 && transitionElapsed < CROSSFADE_MS;
      if (transitioning) {
        const blend = Math.max(0, Math.min(1, transitionElapsed / CROSSFADE_MS));
        for (let bin = 0; bin < DISPLAY_FREQ_BINS; bin += 1) {
          displayRow[bin] =
            transitionFromRef.current[bin] * (1 - blend) + targetRow[bin] * blend;
        }
      } else {
        displayRow.set(targetRow);
      }
      lastRowRef.current.set(displayRow);

      waterfall.data.copyWithin(rowBytes, 0, waterfall.data.length - rowBytes);
      for (let bin = 0; bin < DISPLAY_FREQ_BINS; bin += 1) {
        const normalized =
          (displayRow[bin] - profile.db_min) / (profile.db_max - profile.db_min);
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
        const normalized =
          (displayRow[bin] - profile.db_min) / (profile.db_max - profile.db_min);
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
        panel.dataset.spectrumMode = modeRef.current;
        panel.dataset.transitioning = String(transitioning);
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
        panel.dataset.rowMin = Math.min(...displayRow).toFixed(2);
        panel.dataset.rowMax = Math.max(...displayRow).toFixed(2);
      }
      frame += 1;
      animationFrame = requestAnimationFrame(draw);
    };
    animationFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationFrame);
  }, [heroReplay, profile]);

  const sourceLabel = loadError
    ? 'PROFILE ERROR'
    : source === 'hero'
      ? 'VERIFIED REPLAY'
      : heroError
        ? 'LIVE FALLBACK'
        : 'LIVE APPROX';

  return (
    <div
      className="panel spectrum-panel"
      data-testid="spectrum-panel"
      data-profile-loaded={profile ? 'true' : 'false'}
      data-hero-loaded={heroReplay ? 'true' : 'false'}
      data-spectrum-source={source}
      data-spectrum-mode={mode}
      data-idle-return-ms={IDLE_RETURN_MS}
      data-crossfade-ms={CROSSFADE_MS}
      ref={panelRef}
    >
      <div className="spectrum-head">
        <div className="spectrum-profile">
          <strong>RF SPECTRUM</strong>
          <span>{profile?.drone ?? 'PROFILE LOADING'}</span>
        </div>
        <div className="spectrum-head-actions">
          <span className={`spectrum-source ${loadError ? 'error' : ''}`}>
            {sourceLabel}
          </span>
          <div className="spectrum-controls" aria-label="Spectrum source">
            <button
              className={mode === 'auto' ? 'active' : ''}
              data-testid="spectrum-auto"
              onClick={() => changeMode('auto')}
            >
              AUTO
            </button>
            <button
              className={mode === 'hero' ? 'active' : ''}
              data-testid="spectrum-hero"
              onClick={() => changeMode('hero')}
            >
              REAL CAPTURE
            </button>
            <button
              className={mode === 'live' ? 'active' : ''}
              data-testid="spectrum-live"
              onClick={() => changeMode('live')}
            >
              LIVE
            </button>
          </div>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        width={DISPLAY_FREQ_BINS}
        height={CANVAS_HEIGHT}
        aria-label="RF spectrum and waterfall"
      />
      <div className="spectrum-axis">
        <span>
          {profile
            ? `${((profile.center_freq_hz - profile.span_hz / 2) / 1e9).toFixed(3)} GHz`
            : '--'}
        </span>
        <span>{profile?.colormap.toUpperCase() ?? '--'} · PROFILE LOCK</span>
        <span>
          {profile
            ? `${((profile.center_freq_hz + profile.span_hz / 2) / 1e9).toFixed(3)} GHz`
            : '--'}
        </span>
      </div>
    </div>
  );
}
