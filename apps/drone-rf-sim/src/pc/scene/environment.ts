import * as pc from 'playcanvas';
import { mat, uniqueMat } from './materials';
import { prim, torus } from './builders';
import { cityBuildings, mulberry32, paintSiteTexture, SITE_HALF } from '../../site/siteTexture';

/** engine ENU (x east, y north) → PlayCanvas (x east, z = -north) */
const Z = (northY: number): number => -northY;

/** approximate road center-lines (engine coords) so trees stay off them */
const ROADS: [number, number][][] = [
  [
    [-1600, -420],
    [-200, -460],
    [60, -260],
    [320, -60],
    [1600, -40],
  ],
  [
    [-60, 1600],
    [-120, 400],
    [0, 60],
    [60, -260],
  ],
];

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function nearRoad(x: number, y: number, margin: number): boolean {
  for (const road of ROADS) {
    for (let i = 0; i < road.length - 1; i++) {
      if (distToSeg(x, y, road[i][0], road[i][1], road[i + 1][0], road[i + 1][1]) < margin) return true;
    }
  }
  return false;
}

export function buildEnvironment(app: pc.Application): void {
  const root = new pc.Entity('environment');
  app.root.addChild(root);
  const rnd = mulberry32(777);

  // ------------------------------------------------ textured site ground
  // split into a 4x4 grid of tiles: a single 3.2 km quad shows large-scale
  // lighting/shadow interpolation artifacts, smaller quads shade cleanly
  const canvas = paintSiteTexture(2048);
  const GRID = 4;
  const tileWorld = (SITE_HALF * 2) / GRID;
  const tilePx = canvas.width / GRID;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const x0 = -SITE_HALF + i * tileWorld; // west edge (east coord)
      const n0 = SITE_HALF - (j + 1) * tileWorld; // south edge (north coord)
      const sub = document.createElement('canvas');
      sub.width = tilePx;
      sub.height = tilePx;
      sub.getContext('2d')!.drawImage(canvas, i * tilePx, j * tilePx, tilePx, tilePx, 0, 0, tilePx, tilePx);
      const texture = new pc.Texture(app.graphicsDevice, {
        width: tilePx,
        height: tilePx,
        format: pc.PIXELFORMAT_RGBA8,
        mipmaps: true,
      });
      texture.setSource(sub);
      texture.anisotropy = 4;
      texture.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
      texture.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
      const groundMat = new pc.StandardMaterial();
      groundMat.diffuseMap = texture;
      groundMat.gloss = 0.01;
      groundMat.specular = new pc.Color(0, 0, 0);
      groundMat.update();
      prim('plane', {
        parent: root,
        material: groundMat,
        pos: [x0 + tileWorld / 2, 0, -(n0 + tileWorld / 2)],
        scale: [tileWorld, 1, tileWorld],
        castShadows: false,
        name: `site-ground-${i}-${j}`,
      });
    }
  }
  // surrounding base terrain — kept well below the site tiles: near-coplanar
  // giant surfaces z-fight at 2 km viewing distances
  prim('box', {
    parent: root,
    material: mat('#46543f', { gloss: 0.1 }),
    pos: [0, -2.6, 0],
    scale: [9000, 1, 9000],
    castShadows: false,
  });

  // ------------------------------------------------------------ buildings
  const winMat = mat('#7fb4d8', { emissive: '#9fd2ee', emissiveIntensity: 0.35, gloss: 0.8 });
  const roofMat = mat('#4b555f');
  const building = (
    x: number,
    yN: number,
    w: number,
    d: number,
    h: number,
    bodyHex: string,
  ): pc.Entity => {
    const g = new pc.Entity('building');
    g.setLocalPosition(x, 0, Z(yN));
    root.addChild(g);
    prim('box', { parent: g, material: mat(bodyHex), pos: [0, h / 2, 0], scale: [w, h, d] });
    prim('box', { parent: g, material: roofMat, pos: [0, h + 0.4, 0], scale: [w + 2, 0.8, d + 2] });
    // window rows on the south (+z) face
    const cols = Math.floor(w / 8);
    for (let c = 0; c < cols; c++) {
      const wx = -w / 2 + 4.5 + c * 8;
      for (let r = 0; r < Math.max(1, Math.floor(h / 6)); r++) {
        prim('box', {
          parent: g,
          material: winMat,
          pos: [wx, 3 + r * 5.5, d / 2 + 0.15],
          scale: [4, 2.4, 0.25],
          castShadows: false,
        });
      }
    }
    prim('box', {
      parent: g,
      material: mat('#3c464f'),
      pos: [w / 2 - 6, 2, d / 2 + 0.18],
      scale: [3.4, 4, 0.25],
      castShadows: false,
    });
    return g;
  };
  building(-40, 20, 90, 42, 18, '#9aa4ad');
  building(55, -45, 46, 30, 11, '#8d99a4');
  building(-90, -60, 30, 22, 8, '#7f8a94');

  // -------------------------------------------------------- city districts
  // window grids are baked into tiled facade textures (one per style) so a
  // whole city stays at ~2 draw calls per building instead of a box per window
  const facadeTexture = (bodyHex: string, seed: number): pc.Texture => {
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 96;
    const cx = c.getContext('2d')!;
    const r = mulberry32(seed);
    cx.fillStyle = bodyHex;
    cx.fillRect(0, 0, 96, 96);
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 4; col++) {
        cx.fillStyle = r() > 0.3 ? '#c9dbe6' : '#5c6a75';
        cx.fillRect(6 + col * 23, 8 + row * 18, 13, 9);
      }
    }
    const t = new pc.Texture(app.graphicsDevice, {
      width: 96,
      height: 96,
      format: pc.PIXELFORMAT_RGBA8,
      mipmaps: true,
    });
    t.setSource(c);
    t.anisotropy = 4;
    return t;
  };
  const facades = ['#aab2b9', '#9aa3ac', '#b8bcc0', '#8f9aa5', '#c2bdb2'].map((hex, i) =>
    facadeTexture(hex, 900 + i),
  );
  const cityRoof = mat('#565e66');
  for (const b of cityBuildings()) {
    const m = new pc.StandardMaterial();
    m.diffuseMap = facades[b.style];
    // tile so windows stay ~4 m wide and one floor ~3 m regardless of size
    m.diffuseMapTiling = new pc.Vec2(Math.max(1, Math.round(b.w / 20)), Math.max(1, Math.round(b.h / 16)));
    m.gloss = 0.25;
    m.specular = new pc.Color(0.03, 0.03, 0.03);
    m.update();
    prim('box', { parent: root, material: m, pos: [b.x, b.h / 2, Z(b.y)], scale: [b.w, b.h, b.d] });
    prim('box', {
      parent: root,
      material: cityRoof,
      pos: [b.x, b.h + 0.5, Z(b.y)],
      scale: [b.w + 1.5, 1, b.d + 1.5],
      castShadows: false,
    });
  }

  // rooftop unit on the HQ
  prim('box', { parent: root, material: mat('#828c96'), pos: [-60, 19.6, Z(28)], scale: [10, 3, 7] });

  // comms tower + aviation light
  prim('cylinder', {
    parent: root,
    material: mat('#b8bfc7', { gloss: 0.5 }),
    pos: [20, 20, Z(62)],
    scale: [3.4, 40, 3.4],
  });
  prim('cylinder', {
    parent: root,
    material: mat('#9aa4ad'),
    pos: [20, 41, Z(62)],
    scale: [0.7, 6, 0.7],
  });
  prim('sphere', {
    parent: root,
    material: mat('#ff5f5f', { emissive: '#ff5f5f', emissiveIntensity: 2 }),
    pos: [20, 44.5, Z(62)],
    scale: [1.6, 1.6, 1.6],
    castShadows: false,
  });

  // ------------------------------------------------- protected-site ring
  torus(app, {
    parent: root,
    material: mat('#4db8ff', { emissive: '#4db8ff', emissiveIntensity: 0.8, opacity: 0.4 }),
    pos: [0, 0.8, 0],
    scale: [210, 1.5, 210],
    ringRadius: 1,
    tubeRadius: 0.012,
  });

  // ---------------------------------------------------------------- fence
  const postMat = mat('#7b838c');
  const railMat = mat('#8d959e');
  const FX = 430;
  const FZ = 350;
  for (let x = -FX; x <= FX; x += 20) {
    for (const z of [-FZ, FZ]) {
      prim('box', { parent: root, material: postMat, pos: [x, 1.1, z], scale: [0.35, 2.2, 0.35] });
    }
  }
  for (let z = -FZ; z <= FZ; z += 20) {
    for (const x of [-FX, FX]) {
      prim('box', { parent: root, material: postMat, pos: [x, 1.1, z], scale: [0.35, 2.2, 0.35] });
    }
  }
  for (const h of [0.8, 1.7]) {
    prim('box', { parent: root, material: railMat, pos: [0, h, -FZ], scale: [FX * 2, 0.12, 0.12], castShadows: false });
    prim('box', { parent: root, material: railMat, pos: [0, h, FZ], scale: [FX * 2, 0.12, 0.12], castShadows: false });
    prim('box', { parent: root, material: railMat, pos: [-FX, h, 0], scale: [0.12, 0.12, FZ * 2], castShadows: false });
    prim('box', { parent: root, material: railMat, pos: [FX, h, 0], scale: [0.12, 0.12, FZ * 2], castShadows: false });
  }

  // ---------------------------------------------------------------- trees
  const trunkMat = mat('#6d5236');
  const leafMats = [mat('#3f6e38'), mat('#4c7c40'), mat('#57894a'), mat('#47763d')];
  const pineMat = mat('#3a6634');
  const city = cityBuildings();
  const onBuildingPad = (x: number, y: number): boolean =>
    city.some((b) => Math.abs(x - b.x) < b.w / 2 + 10 && Math.abs(y - b.y) < b.d / 2 + 10);
  let placed = 0;
  let guard = 0;
  while (placed < 260 && guard++ < 4000) {
    const x = (rnd() * 2 - 1) * (SITE_HALF - 80);
    const y = (rnd() * 2 - 1) * (SITE_HALF - 80);
    if (Math.hypot(x, y) < 300) continue;
    if (nearRoad(x, y, 45)) continue;
    if (onBuildingPad(x, y)) continue;
    if (Math.hypot(x + 620, y + 560) < 200) continue; // water
    placed++;
    const g = new pc.Entity('tree');
    g.setLocalPosition(x, 0, Z(y));
    root.addChild(g);
    const s = 1.4 + rnd() * 1.8;
    if (rnd() > 0.35) {
      prim('cylinder', { parent: g, material: trunkMat, pos: [0, 1.4 * s, 0], scale: [0.4 * s, 2.8 * s, 0.4 * s] });
      const leaf = leafMats[Math.floor(rnd() * leafMats.length)];
      prim('sphere', { parent: g, material: leaf, pos: [0, 3.6 * s, 0], scale: [3.4 * s, 3 * s, 3.4 * s] });
      prim('sphere', { parent: g, material: leaf, pos: [0.9 * s, 4.6 * s, 0.4 * s], scale: [2 * s, 1.8 * s, 2 * s] });
    } else {
      prim('cylinder', { parent: g, material: trunkMat, pos: [0, 1.1 * s, 0], scale: [0.35 * s, 2.2 * s, 0.35 * s] });
      prim('cone', { parent: g, material: pineMat, pos: [0, 3.4 * s, 0], scale: [3 * s, 3 * s, 3 * s] });
      prim('cone', { parent: g, material: pineMat, pos: [0, 5.2 * s, 0], scale: [2.1 * s, 2.4 * s, 2.1 * s] });
    }
  }

  // ---------------------------------------------------------------- lamps
  const poleMat = mat('#454c55');
  const lampHead = uniqueMat('#ffe9b8', { emissive: '#ffdf9e', emissiveIntensity: 1.1 });
  const lampSpots: [number, number][] = [
    [-140, -90],
    [140, 90],
    [-140, 120],
    [160, -110],
    [0, -160],
    [40, 170],
  ];
  for (const [x, y] of lampSpots) {
    const g = new pc.Entity('lamp');
    g.setLocalPosition(x, 0, Z(y));
    root.addChild(g);
    prim('cylinder', { parent: g, material: poleMat, pos: [0, 3.2, 0], scale: [0.3, 6.4, 0.3] });
    prim('sphere', { parent: g, material: lampHead, pos: [0, 6.6, 0], scale: [1, 0.8, 1], castShadows: false });
  }
}
