import { useEffect, useRef } from 'react';
import { engine } from '../state/store';
import type { ScoutId } from '../sim/types';

/**
 * Synthetic spectrum + waterfall for the selected scout's receiver.
 * Purely a visualization mock: amplitudes are anchored to the scout's real
 * RSSI from the RF model (same path-loss result), so a closer drone paints a
 * brighter trace. Deterministic noise (sin-hash of time+bin) keeps replays
 * and frame-stepped video capture reproducible. Swapping in a real IQ→STFT
 * backend later only needs to replace synthesizeRow().
 */

const BINS = 120;
const SPEC_H = 34; // spectrum trace strip at the top, waterfall below
const FLOOR_DBM = -94;
const MIN_DBM = -96;
const MAX_DBM = -38;
const HOP_PERIOD_S = 0.12; // FHSS dwell
const SEEDS: Record<ScoutId, number> = { A: 11.3, B: 23.7, C: 37.1 };

const fract = (v: number): number => v - Math.floor(v);
const hash = (k: number, seed: number): number => fract(Math.sin(k * 127.1 + seed * 311.7) * 43758.5453);

function synthesizeRow(t: number, rssi: number | null, seed: number): Float32Array {
  const row = new Float32Array(BINS);
  for (let b = 0; b < BINS; b++) {
    row[b] =
      FLOOR_DBM +
      2.6 * (hash(b * 7.13 + Math.floor(t * 24), seed) - 0.5) * 2 +
      1.2 * Math.sin(t * 2.1 + b * 0.4 + seed);
  }
  if (rssi !== null) {
    // frequency-hopping control link: narrow burst that re-tunes every dwell
    const hopCenter = Math.floor(hash(Math.floor(t / HOP_PERIOD_S), seed) * (BINS - 12)) + 6;
    for (let b = 0; b < BINS; b++) {
      const d = (b - hopCenter) / 3.2;
      const bump = (rssi + 8 - row[b]) * Math.exp(-d * d);
      if (bump > 0) row[b] += bump;
    }
    // wide video downlink band, slowly drifting
    const vidCenter = BINS * 0.62 + Math.sin(t * 0.06 + seed) * 6;
    for (let b = 0; b < BINS; b++) {
      const d = (b - vidCenter) / 13;
      const bump = (rssi - 4 - row[b]) * Math.exp(-d * d * d * d);
      if (bump > 0) row[b] += bump;
    }
  }
  for (let b = 0; b < BINS; b++) row[b] = Math.min(MAX_DBM, Math.max(MIN_DBM, row[b]));
  return row;
}

/** dBm → waterfall color (dark navy → cyan → yellow) */
function heat(dbm: number): string {
  const t = Math.min(1, Math.max(0, (dbm - MIN_DBM) / (MAX_DBM - MIN_DBM)));
  return `hsl(${215 - t * 170}, ${60 + t * 35}%, ${9 + t * 52}%)`;
}

export function SpectrumPanel({ scoutId }: { scoutId: ScoutId }): JSX.Element {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const lastT = useRef(-1);

  useEffect(() => {
    lastT.current = -1; // repaint from scratch when switching scouts
    const cv = cvRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#08111a';
    ctx.fillRect(0, 0, w, h);

    const tick = (): void => {
      const t = engine.simTime;
      if (t === lastT.current) return; // paused / replay-scrubbed to same frame
      lastT.current = t;
      const s = engine.scouts.find((q) => q.id === scoutId);
      if (!s) return;
      const rssi = s.receiverOn ? s.rssi : null;
      const row = synthesizeRow(t, rssi, SEEDS[scoutId]);
      const binW = w / BINS;

      // waterfall: scroll history down one pixel, stamp the new row on top
      ctx.drawImage(cv, 0, SPEC_H * dpr, w * dpr, (h - SPEC_H - 1) * dpr, 0, SPEC_H + 1, w, h - SPEC_H - 1);
      for (let b = 0; b < BINS; b++) {
        ctx.fillStyle = heat(row[b]);
        ctx.fillRect(b * binW, SPEC_H, binW + 0.5, 1);
      }

      // live spectrum trace
      ctx.fillStyle = '#08111a';
      ctx.fillRect(0, 0, w, SPEC_H);
      ctx.strokeStyle = 'rgba(140, 165, 190, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, SPEC_H - 0.5);
      ctx.lineTo(w, SPEC_H - 0.5);
      ctx.stroke();
      ctx.strokeStyle = rssi !== null && s.detecting ? '#57d98a' : '#4db8ff';
      ctx.beginPath();
      for (let b = 0; b < BINS; b++) {
        const y = 2 + (1 - (row[b] - MIN_DBM) / (MAX_DBM - MIN_DBM)) * (SPEC_H - 6);
        if (b === 0) ctx.moveTo(b * binW, y);
        else ctx.lineTo(b * binW, y);
      }
      ctx.stroke();
      ctx.fillStyle = '#8fa3b8';
      ctx.font = '8px system-ui, sans-serif';
      ctx.fillText('2.400', 2, 8);
      ctx.textAlign = 'right';
      ctx.fillText('2.483 GHz', w - 2, 8);
      ctx.textAlign = 'left';
    };

    tick();
    const id = window.setInterval(tick, 90);
    return () => window.clearInterval(id);
  }, [scoutId]);

  return (
    <>
      <div className="section">RF 스펙트럼 (모의)</div>
      <canvas ref={cvRef} className="spectrum-canvas" data-testid="spectrum-canvas" />
    </>
  );
}
