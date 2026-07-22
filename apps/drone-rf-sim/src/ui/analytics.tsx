import { useEffect, useRef } from 'react';
import { engine, useUi } from '../state/store';
import type { ReplayFrame, ScoutId } from '../sim/types';
import { COLORS } from '../cesium/icons';

const SCOUT_IDS: ScoutId[] = ['A', 'B', 'C'];
const MAX_POINTS = 600; // charts downsample beyond this; CSV always exports everything

interface Series {
  color: string;
  dashed?: boolean;
  /** y per frame; null = gap */
  values: (number | null)[];
}

function frameError(f: ReplayFrame): number | null {
  if (!f.estimate.available) return null;
  return Math.hypot(f.drone.pos.x - f.estimate.pos.x, f.drone.pos.y - f.estimate.pos.y);
}

function sampled(rec: ReplayFrame[]): ReplayFrame[] {
  if (rec.length <= MAX_POINTS) return rec;
  const stride = Math.ceil(rec.length / MAX_POINTS);
  return rec.filter((_, i) => i % stride === 0);
}

function setupCanvas(cv: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (cv.width !== w * dpr || cv.height !== h * dpr) {
    cv.width = w * dpr;
    cv.height = h * dpr;
  }
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.fillRect(0, 0, w, h);
  return ctx;
}

/** time-series line chart with a fixed or auto y-range and min/max tick text */
function drawTimeChart(
  cv: HTMLCanvasElement,
  frames: ReplayFrame[],
  series: Series[],
  yRange: { min: number; max: number } | null,
  unit: string,
): void {
  const ctx = setupCanvas(cv);
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (frames.length < 2) return;

  let yMin = yRange?.min ?? Infinity;
  let yMax = yRange?.max ?? -Infinity;
  if (!yRange) {
    for (const s of series) for (const v of s.values) if (v !== null) { yMin = Math.min(yMin, v); yMax = Math.max(yMax, v); }
    if (!isFinite(yMin)) return;
    const pad = Math.max(1, (yMax - yMin) * 0.12);
    yMin = Math.max(0, yMin - pad);
    yMax += pad;
  }
  const t0 = frames[0].t;
  const t1 = frames[frames.length - 1].t;
  const px = (t: number): number => 4 + ((t - t0) / Math.max(0.1, t1 - t0)) * (w - 8);
  const py = (v: number): number => h - 14 - ((v - yMin) / Math.max(0.001, yMax - yMin)) * (h - 22);

  ctx.strokeStyle = 'rgba(60, 90, 120, 0.16)';
  ctx.lineWidth = 1;
  for (const fy of [0.25, 0.5, 0.75]) {
    ctx.beginPath();
    ctx.moveTo(4, 8 + (h - 22) * fy);
    ctx.lineTo(w - 4, 8 + (h - 22) * fy);
    ctx.stroke();
  }

  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.4;
    ctx.setLineDash(s.dashed ? [4, 3] : []);
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < frames.length; i++) {
      const v = s.values[i];
      if (v === null) { pen = false; continue; }
      const x = px(frames[i].t);
      const y = py(Math.max(yMin, Math.min(yMax, v)));
      if (pen) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      pen = true;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = '#54687c';
  ctx.font = '9px system-ui, sans-serif';
  ctx.fillText(`${yMax.toFixed(0)}${unit}`, 6, 12);
  ctx.fillText(`${yMin.toFixed(0)}${unit}`, 6, h - 16);
  ctx.textAlign = 'right';
  ctx.fillText(`${(t1 - t0).toFixed(0)}s`, w - 6, h - 4);
  ctx.textAlign = 'left';
}

/** XY map of the true track vs the fused estimate track */
function drawTrajectory(cv: HTMLCanvasElement, frames: ReplayFrame[]): void {
  const ctx = setupCanvas(cv);
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (frames.length < 2) return;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const grow = (x: number, y: number): void => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };
  for (const f of frames) {
    grow(f.drone.pos.x, f.drone.pos.y);
    if (f.estimate.available) grow(f.estimate.pos.x, f.estimate.pos.y);
  }
  const spanX = Math.max(50, maxX - minX);
  const spanY = Math.max(50, maxY - minY);
  const scale = Math.min((w - 16) / spanX, (h - 16) / spanY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const px = (x: number): number => w / 2 + (x - cx) * scale;
  const py = (y: number): number => h / 2 - (y - cy) * scale; // north up

  const path = (pick: (f: ReplayFrame) => { x: number; y: number } | null, color: string, dashed: boolean): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.setLineDash(dashed ? [4, 3] : []);
    ctx.beginPath();
    let pen = false;
    for (const f of frames) {
      const p = pick(f);
      if (!p) { pen = false; continue; }
      if (pen) ctx.lineTo(px(p.x), py(p.y));
      else ctx.moveTo(px(p.x), py(p.y));
      pen = true;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };
  path((f) => ({ x: f.drone.pos.x, y: f.drone.pos.y }), COLORS.drone, false);
  path((f) => (f.estimate.available ? { x: f.estimate.pos.x, y: f.estimate.pos.y } : null), COLORS.estimate, true);

  const last = frames[frames.length - 1];
  ctx.fillStyle = COLORS.drone;
  ctx.beginPath();
  ctx.arc(px(last.drone.pos.x), py(last.drone.pos.y), 2.6, 0, Math.PI * 2);
  ctx.fill();
}

function exportCsv(rec: ReplayFrame[]): void {
  const head = [
    't_s', 'truth_x_m', 'truth_y_m', 'truth_alt_m',
    'est_available', 'est_x_m', 'est_y_m', 'est_alt_m', 'err_m', 'uncertainty_m', 'confidence', 'status',
    ...SCOUT_IDS.flatMap((id) => [`rssi_${id}_dbm`, `detecting_${id}`]),
  ];
  const rows = rec.map((f) => {
    const err = frameError(f);
    const byId = new Map(f.scouts.map((s) => [s.id, s]));
    return [
      f.t.toFixed(2), f.drone.pos.x.toFixed(1), f.drone.pos.y.toFixed(1), f.drone.pos.alt.toFixed(1),
      f.estimate.available ? 1 : 0,
      f.estimate.available ? f.estimate.pos.x.toFixed(1) : '',
      f.estimate.available ? f.estimate.pos.y.toFixed(1) : '',
      f.estimate.available ? f.estimate.pos.alt.toFixed(1) : '',
      err === null ? '' : err.toFixed(1),
      f.estimate.available ? f.estimate.uncertainty : '',
      f.estimate.confidence.toFixed(3),
      f.status,
      ...SCOUT_IDS.flatMap((id) => {
        const s = byId.get(id);
        return [s?.rssi === null || s?.rssi === undefined ? '' : s.rssi.toFixed(1), s?.detecting ? 1 : 0];
      }),
    ].join(',');
  });
  const blob = new Blob([[head.join(','), ...rows].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sim_log.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export function AnalyticsPanel(): JSX.Element | null {
  useUi((s) => s.rev);
  const showAnalytics = useUi((s) => s.showAnalytics);
  const errRef = useRef<HTMLCanvasElement>(null);
  const rssiRef = useRef<HTMLCanvasElement>(null);
  const trajRef = useRef<HTMLCanvasElement>(null);

  const rec = engine.recording;
  const frames = sampled(rec);
  const errs = frames.map(frameError);
  const valid = errs.filter((e): e is number => e !== null);
  const rms = valid.length ? Math.sqrt(valid.reduce((a, e) => a + e * e, 0) / valid.length) : null;

  useEffect(() => {
    if (!showAnalytics) return;
    if (errRef.current) {
      // cap the axis at the 90th percentile so one early single-scout spike
      // (ring-point estimates jump hundreds of meters) can't flatten the rest
      const sorted = [...valid].sort((a, b) => a - b);
      const p90 = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : 100;
      drawTimeChart(errRef.current, frames, [
        { color: COLORS.estimate, values: errs },
        { color: '#7d8fa0', dashed: true, values: frames.map((f) => (f.estimate.available ? f.estimate.uncertainty : null)) },
      ], { min: 0, max: Math.max(50, p90 * 1.6) }, 'm');
    }
    if (rssiRef.current) {
      drawTimeChart(rssiRef.current, frames, SCOUT_IDS.map((id) => ({
        color: COLORS[id],
        values: frames.map((f) => f.scouts.find((s) => s.id === id)?.rssi ?? null),
      })), { min: -96, max: -40 }, '');
    }
    if (trajRef.current) drawTrajectory(trajRef.current, frames);
  });

  if (!showAnalytics) return null;

  return (
    <div className="panel analytics-panel" data-testid="analytics-panel">
      <div className="chart-box">
        <div className="chart-title">추정 오차 (m) — 실선: 실제 · 점선: 불확실성{rms !== null ? ` · RMS ${rms.toFixed(1)}m` : ''}</div>
        <canvas ref={errRef} className="chart-canvas" />
      </div>
      <div className="chart-box">
        <div className="chart-title">스카우트별 RSSI (dBm)</div>
        <canvas ref={rssiRef} className="chart-canvas" />
      </div>
      <div className="chart-box">
        <div className="chart-title">실제(주황) vs 추정(자주) 궤적</div>
        <canvas ref={trajRef} className="chart-canvas" />
      </div>
      <div className="chart-side">
        {rec.length < 2 ? (
          <div className="hint">실행하면 기록이 쌓입니다.</div>
        ) : (
          <div className="hint">{rec.length}개 샘플 · {rec.length ? rec[rec.length - 1].t.toFixed(0) : 0}초</div>
        )}
        <button className="hbtn" data-testid="btn-csv" disabled={rec.length < 2} onClick={() => exportCsv(rec)}>
          CSV 내보내기
        </button>
      </div>
    </div>
  );
}
