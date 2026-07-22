import * as pc from 'playcanvas';

const cache = new Map<string, pc.StandardMaterial>();

export function color(hex: string): pc.Color {
  const v = parseInt(hex.replace('#', ''), 16);
  return new pc.Color(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

export interface MatOpts {
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  gloss?: number;
  twoSided?: boolean;
}

function build(diffuseHex: string, opts: MatOpts): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.diffuse = color(diffuseHex);
  m.specular = new pc.Color(0.05, 0.05, 0.055);
  m.gloss = opts.gloss ?? 0.35;
  if (opts.emissive) {
    m.emissive = color(opts.emissive);
    m.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  if (opts.opacity !== undefined) {
    m.opacity = opts.opacity;
    m.blendType = pc.BLEND_NORMAL;
    m.depthWrite = false;
  }
  if (opts.twoSided) m.cull = pc.CULLFACE_NONE;
  m.update();
  return m;
}

/** shared/cached material (do not mutate at runtime) */
export function mat(diffuseHex: string, opts: MatOpts = {}): pc.StandardMaterial {
  const key = diffuseHex + JSON.stringify(opts);
  const hit = cache.get(key);
  if (hit) return hit;
  const m = build(diffuseHex, opts);
  cache.set(key, m);
  return m;
}

/** un-cached material instance, safe to animate (opacity, emissive...) */
export function uniqueMat(diffuseHex: string, opts: MatOpts = {}): pc.StandardMaterial {
  return build(diffuseHex, opts);
}

/** Drop references to resources owned by a PlayCanvas app before remounting. */
export function clearMaterialCache(): void {
  cache.clear();
}
