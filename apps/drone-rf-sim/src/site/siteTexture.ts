/** shared site ground texture — painted once, consumed by BOTH renderers
 *  (Cesium imagery layer and PlayCanvas ground plane) so the two views agree */

export const SITE_HALF = 1600; // meters covered by the detailed ground texture

/** deterministic PRNG so the site looks identical on every run */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** paints a stylized park/facility ground texture onto a canvas.
 *  canvas maps to [-SITE_HALF, SITE_HALF]^2 meters, north = up */
export function paintSiteTexture(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rnd = mulberry32(20260722);
  const px = (m: number): number => ((m + SITE_HALF) / (SITE_HALF * 2)) * size;
  const py = (m: number): number => ((SITE_HALF - m) / (SITE_HALF * 2)) * size;
  const sc = (m: number): number => (m / (SITE_HALF * 2)) * size;

  // base terrain
  ctx.fillStyle = '#5d7c4b';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 140; i++) {
    const r = 30 + rnd() * 180;
    ctx.fillStyle = ['#57764a', '#647f4c', '#6b8752', '#537247'][Math.floor(rnd() * 4)];
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.ellipse(rnd() * size, rnd() * size, sc(r), sc(r * (0.5 + rnd() * 0.6)), rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // forest patches
  for (let i = 0; i < 26; i++) {
    const cx = (rnd() * 2 - 1) * (SITE_HALF - 250);
    const cy = (rnd() * 2 - 1) * (SITE_HALF - 250);
    if (Math.hypot(cx, cy) < 380) continue;
    ctx.fillStyle = '#3f5e39';
    ctx.globalAlpha = 0.8;
    for (let k = 0; k < 24; k++) {
      const a = rnd() * Math.PI * 2;
      const rr = rnd() * 90;
      ctx.beginPath();
      ctx.arc(px(cx + Math.cos(a) * rr), py(cy + Math.sin(a) * rr), sc(12 + rnd() * 16), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // service roads: north-south + east-west crossing near the facility
  ctx.strokeStyle = '#565b60';
  ctx.lineWidth = sc(14);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(px(-SITE_HALF), py(-420));
  ctx.quadraticCurveTo(px(-200), py(-460), px(60), py(-260));
  ctx.quadraticCurveTo(px(320), py(-60), px(SITE_HALF), py(-40));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(px(-60), py(SITE_HALF));
  ctx.quadraticCurveTo(px(-120), py(400), px(0), py(60));
  ctx.lineTo(px(60), py(-260));
  ctx.stroke();
  // center dashes
  ctx.strokeStyle = '#cfccc0';
  ctx.lineWidth = sc(1.6);
  ctx.setLineDash([sc(16), sc(14)]);
  ctx.beginPath();
  ctx.moveTo(px(-SITE_HALF), py(-420));
  ctx.quadraticCurveTo(px(-200), py(-460), px(60), py(-260));
  ctx.quadraticCurveTo(px(320), py(-60), px(SITE_HALF), py(-40));
  ctx.stroke();
  ctx.setLineDash([]);

  // facility compound pad + apron
  ctx.fillStyle = '#8e8a7d';
  ctx.save();
  ctx.translate(px(0), py(0));
  ctx.rotate(-0.06);
  ctx.fillRect(-sc(150), -sc(110), sc(300), sc(220));
  ctx.strokeStyle = '#b9b4a4';
  ctx.lineWidth = sc(3);
  ctx.strokeRect(-sc(150), -sc(110), sc(300), sc(220));
  ctx.restore();
  // helipad
  ctx.fillStyle = '#77736a';
  ctx.beginPath();
  ctx.arc(px(220), py(180), sc(40), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d8d5c8';
  ctx.lineWidth = sc(3);
  ctx.stroke();
  ctx.fillStyle = '#d8d5c8';
  ctx.font = `bold ${sc(46)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('H', px(220), py(178));

  // perimeter track
  ctx.strokeStyle = '#8a8672';
  ctx.lineWidth = sc(6);
  ctx.globalAlpha = 0.9;
  ctx.strokeRect(px(-420), py(340), sc(840), sc(680));
  ctx.globalAlpha = 1;

  // water feature
  ctx.fillStyle = '#4d6f86';
  ctx.beginPath();
  ctx.ellipse(px(-620), py(-560), sc(150), sc(90), 0.4, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}
