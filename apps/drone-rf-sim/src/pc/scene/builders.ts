import * as pc from 'playcanvas';

export interface PrimOpts {
  parent: pc.Entity;
  material: pc.Material;
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
  castShadows?: boolean;
  receiveShadows?: boolean;
  name?: string;
}

export type PrimType = 'box' | 'sphere' | 'cylinder' | 'cone' | 'capsule' | 'plane';

export function prim(type: PrimType, o: PrimOpts): pc.Entity {
  const e = new pc.Entity(o.name ?? type);
  e.addComponent('render', {
    type,
    castShadows: o.castShadows ?? true,
    receiveShadows: o.receiveShadows ?? true,
  });
  e.render!.material = o.material;
  if (o.pos) e.setLocalPosition(o.pos[0], o.pos[1], o.pos[2]);
  if (o.rot) e.setLocalEulerAngles(o.rot[0], o.rot[1], o.rot[2]);
  if (o.scale) e.setLocalScale(o.scale[0], o.scale[1], o.scale[2]);
  o.parent.addChild(e);
  return e;
}

const torusMeshCache = new Map<string, pc.Mesh>();

/** Drop references to meshes that become invalid when their graphics device is destroyed. */
export function clearPrimitiveMeshCache(): void {
  torusMeshCache.clear();
}

export function torus(
  app: pc.Application,
  o: PrimOpts & { ringRadius?: number; tubeRadius?: number },
): pc.Entity {
  const rr = o.ringRadius ?? 1;
  const tr = o.tubeRadius ?? 0.05;
  const key = `${rr}:${tr}`;
  let mesh = torusMeshCache.get(key);
  if (!mesh) {
    mesh = pc.createTorus(app.graphicsDevice, {
      ringRadius: rr,
      tubeRadius: tr,
      segments: 56,
      sides: 12,
    });
    torusMeshCache.set(key, mesh);
  }
  const mi = new pc.MeshInstance(mesh, o.material as pc.Material);
  const e = new pc.Entity(o.name ?? 'torus');
  e.addComponent('render', {
    meshInstances: [mi],
    castShadows: o.castShadows ?? false,
    receiveShadows: o.receiveShadows ?? false,
  });
  if (o.pos) e.setLocalPosition(o.pos[0], o.pos[1], o.pos[2]);
  if (o.rot) e.setLocalEulerAngles(o.rot[0], o.rot[1], o.rot[2]);
  if (o.scale) e.setLocalScale(o.scale[0], o.scale[1], o.scale[2]);
  o.parent.addChild(e);
  return e;
}
