/** canvas-generated tactical symbols — no external image assets */

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return [c, c.getContext('2d')!];
}

function glowCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10,16,24,0.85)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

const cache = new Map<string, string>();

export function droneIcon(color: string, selected: boolean): string {
  const key = `drone:${color}:${selected}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = makeCanvas(64);
  const m = 32;
  if (selected) {
    ctx.beginPath();
    ctx.arc(m, m, 29, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  glowCircle(ctx, m, m, 21, color);
  // quad-rotor glyph
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(m - 10, m - 10);
  ctx.lineTo(m + 10, m + 10);
  ctx.moveTo(m + 10, m - 10);
  ctx.lineTo(m - 10, m + 10);
  ctx.stroke();
  for (const [dx, dy] of [[-10, -10], [10, -10], [-10, 10], [10, 10]] as const) {
    ctx.beginPath();
    ctx.arc(m + dx, m + dy, 5.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(m, m, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#0d141c';
  ctx.fill();
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

export function scoutIcon(color: string, letter: string, selected: boolean, off: boolean): string {
  const key = `scout:${color}:${letter}:${selected}:${off}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = makeCanvas(64);
  const m = 32;
  const col = off ? '#8b949c' : color;
  if (selected) {
    ctx.beginPath();
    ctx.arc(m, m, 28, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  glowCircle(ctx, m, m, 20, col);
  ctx.fillStyle = col;
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, m, m + 1);
  // small antenna tick when receiver is on
  if (!off) {
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(m + 11, m - 13);
    ctx.lineTo(m + 16, m - 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(m + 16, m - 20, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  }
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

export function waypointPin(n: number, color: string, selected: boolean): string {
  const key = `wp:${n}:${color}:${selected}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = makeCanvas(48);
  const m = 24;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = selected ? 12 : 6;
  ctx.beginPath();
  ctx.arc(m, m, 15, 0, Math.PI * 2);
  ctx.fillStyle = selected ? color : 'rgba(12,18,26,0.9)';
  ctx.fill();
  ctx.lineWidth = selected ? 3 : 2.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = selected ? '#0d141c' : color;
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), m, m + 1);
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

export function diamondIcon(color: string): string {
  const key = `dia:${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = makeCanvas(56);
  const m = 28;
  ctx.save();
  ctx.translate(m, m);
  ctx.rotate(Math.PI / 4);
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgba(12,18,26,0.85)';
  ctx.fillRect(-13, -13, 26, 26);
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = color;
  ctx.strokeRect(-13, -13, 26, 26);
  ctx.restore();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(m, m, 4.5, 0, Math.PI * 2);
  ctx.fill();
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

export function homeIcon(color: string): string {
  const key = `home:${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = makeCanvas(44);
  const m = 22;
  ctx.beginPath();
  ctx.arc(m, m, 15, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(12,18,26,0.8)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('H', m, m + 1);
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

export const COLORS = {
  drone: '#ff7a3d',
  estimate: '#c95df0',
  A: '#3ddc84',
  B: '#4aa3ff',
  C: '#ffd23f',
  disabled: '#8b949c',
} as const;
