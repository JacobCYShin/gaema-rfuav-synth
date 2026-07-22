import * as pc from 'playcanvas';
import { engine } from '../../state/store';
import type { EntityId, ScoutId, WorldPos } from '../../sim/types';
import { color, mat, uniqueMat } from './materials';
import { prim, torus } from './builders';
import { COLORS } from '../../cesium/icons';

const SCOUT_IDS: ScoutId[] = ['A', 'B', 'C'];
const tmpA = new pc.Vec3();
const tmpB = new pc.Vec3();

export const P = (p: WorldPos): pc.Vec3 => new pc.Vec3(p.x, p.alt, -p.y);

/** thin box stretched between two points */
class Beam {
  entity: pc.Entity;
  constructor(parent: pc.Entity, material: pc.Material, thickness: number) {
    this.entity = prim('box', {
      parent,
      material,
      scale: [thickness, thickness, 1],
      castShadows: false,
      receiveShadows: false,
    });
    this.entity.enabled = false;
  }
  set(from: pc.Vec3, to: pc.Vec3, thickness: number): void {
    tmpA.copy(from);
    tmpB.copy(to);
    const len = tmpA.distance(tmpB);
    if (len < 0.05) {
      this.entity.enabled = false;
      return;
    }
    this.entity.enabled = true;
    this.entity.setPosition((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    // near-vertical beams need a different up vector — lookAt with the
    // default (0,1,0) degenerates and corrupts the transform
    if (Math.abs(to.y - from.y) / len > 0.98) {
      this.entity.lookAt(tmpB.x, tmpB.y, tmpB.z, 0, 0, 1);
    } else {
      this.entity.lookAt(tmpB.x, tmpB.y, tmpB.z);
    }
    this.entity.setLocalScale(thickness, thickness, len);
  }
  hide(): void {
    this.entity.enabled = false;
  }
}

/** breadcrumb dots for movement trails */
class DotPool {
  private dots: pc.Entity[] = [];
  constructor(parent: pc.Entity, material: pc.Material, private max: number, private flat: boolean) {
    for (let i = 0; i < max; i++) {
      const d = this.flat
        ? prim('cylinder', { parent, material, castShadows: false, receiveShadows: false })
        : prim('sphere', { parent, material, castShadows: false, receiveShadows: false });
      d.enabled = false;
      this.dots.push(d);
    }
  }
  set(points: WorldPos[], visible: boolean, dotScale: number): void {
    const shown = visible ? Math.min(points.length, this.max) : 0;
    const start = points.length - shown;
    for (let i = 0; i < this.max; i++) {
      const dot = this.dots[i];
      if (i < shown) {
        const p = points[start + i];
        dot.enabled = true;
        dot.setPosition(p.x, this.flat ? 0.9 : p.alt, -p.y);
        const f = 0.45 + 0.55 * (i / Math.max(1, shown - 1));
        const s = dotScale * f;
        dot.setLocalScale(s, this.flat ? 0.1 : s, s);
      } else {
        dot.enabled = false;
      }
    }
  }
}

interface Pulse {
  entity: pc.Entity;
  material: pc.StandardMaterial;
  age: number;
  active: boolean;
}

export interface MarkerUiState {
  showTrails: boolean;
  showUncertainty: boolean;
  selectedId: EntityId | null;
  selectedWpId: string | null;
}

export class PcMarkers {
  private root: pc.Entity;
  private routeMaterial: pc.Material;
  private scoutRouteMaterial: pc.Material;
  private waypointGuideMaterial: pc.Material;
  private waypointGroundMaterial: pc.Material;

  private droneTrail: DotPool;
  private scoutTrails: Record<ScoutId, DotPool>;

  private routeBeams: Beam[] = [];
  private scoutRouteBeams: Beam[] = [];
  private activeLeg: Beam;
  private wpTops: pc.Entity[] = [];
  private wpTopMats: pc.StandardMaterial[] = [];
  private wpGuides: Beam[] = [];
  private wpGroundDots: pc.Entity[] = [];
  private wpSelectedRing: pc.Entity;

  private estimateGroup: pc.Entity;
  private diamond: pc.Entity;
  private estDropBeam: Beam;
  private uncDisc: pc.Entity;
  private uncRing: pc.Entity;
  private errorBeam: Beam;
  private measureBeams: Record<ScoutId, Beam>;

  private droneSelRing: pc.Entity;
  private droneShadow: pc.Entity;
  private droneDropLine: Beam;
  private homeGroup: pc.Entity;

  private pulses: Pulse[] = [];
  private prevDetecting: Record<ScoutId, boolean> = { A: false, B: false, C: false };

  constructor(private app: pc.Application) {
    this.root = new pc.Entity('markers');
    app.root.addChild(this.root);

    this.droneTrail = new DotPool(
      this.root,
      mat(COLORS.drone, { emissive: COLORS.drone, emissiveIntensity: 0.9, opacity: 0.8 }),
      140,
      false,
    );
    this.scoutTrails = {} as Record<ScoutId, DotPool>;
    for (const id of SCOUT_IDS) {
      this.scoutTrails[id] = new DotPool(
        this.root,
        mat(COLORS[id], { emissive: COLORS[id], emissiveIntensity: 0.9, opacity: 0.85 }),
        140,
        true,
      );
    }

    this.routeMaterial = mat('#4db8ff', { emissive: '#4db8ff', emissiveIntensity: 0.9, opacity: 0.85 });
    this.scoutRouteMaterial = uniqueMat('#c9d4dd', { emissive: '#c9d4dd', emissiveIntensity: 0.6, opacity: 0.5 });
    this.waypointGuideMaterial = mat('#4db8ff', { emissive: '#4db8ff', emissiveIntensity: 0.5, opacity: 0.25 });
    this.waypointGroundMaterial = mat('#4db8ff', { emissive: '#4db8ff', emissiveIntensity: 0.9, opacity: 0.8 });
    this.ensureWaypointCapacity(26);
    this.activeLeg = new Beam(this.root, mat('#9fe0ff', { emissive: '#9fe0ff', emissiveIntensity: 1.1, opacity: 0.55 }), 0.9);
    this.wpSelectedRing = torus(this.app, {
      parent: this.root,
      material: mat('#ffffff', { emissive: '#ffffff', emissiveIntensity: 1.4, opacity: 0.9 }),
      ringRadius: 1,
      tubeRadius: 0.06,
      scale: [6.5, 6.5, 6.5],
    });
    this.wpSelectedRing.enabled = false;

    // estimate marker
    this.estimateGroup = new pc.Entity('estimate');
    this.root.addChild(this.estimateGroup);
    this.diamond = new pc.Entity('diamond');
    this.estimateGroup.addChild(this.diamond);
    const est = mat(COLORS.estimate, { emissive: COLORS.estimate, emissiveIntensity: 1.1, opacity: 0.9 });
    prim('cone', { parent: this.diamond, material: est, pos: [0, 3.4, 0], rot: [180, 0, 0], scale: [6.6, 6.6, 6.6], castShadows: false });
    prim('cone', { parent: this.diamond, material: est, pos: [0, -3.4, 0], scale: [6.6, 6.6, 6.6], castShadows: false });
    torus(this.app, {
      parent: this.diamond,
      material: mat(COLORS.estimate, { emissive: COLORS.estimate, emissiveIntensity: 1.4, opacity: 0.9 }),
      ringRadius: 1,
      tubeRadius: 0.04,
      scale: [7.5, 7.5, 7.5],
    });
    this.estDropBeam = new Beam(this.root, mat(COLORS.estimate, { emissive: COLORS.estimate, emissiveIntensity: 0.7, opacity: 0.13 }), 2.2);
    this.uncDisc = prim('cylinder', {
      parent: this.root,
      material: mat(COLORS.estimate, { opacity: 0.12, emissive: COLORS.estimate, emissiveIntensity: 0.35 }),
      scale: [1, 0.4, 1],
      castShadows: false,
      receiveShadows: false,
    });
    this.uncRing = torus(this.app, {
      parent: this.root,
      material: mat(COLORS.estimate, { emissive: COLORS.estimate, emissiveIntensity: 1, opacity: 0.55 }),
      ringRadius: 1,
      tubeRadius: 0.006,
    });
    this.errorBeam = new Beam(this.root, mat('#ff9d7a', { emissive: '#ff9d7a', emissiveIntensity: 0.9, opacity: 0.5 }), 1.1);
    this.measureBeams = {} as Record<ScoutId, Beam>;
    for (const id of SCOUT_IDS) {
      this.measureBeams[id] = new Beam(
        this.root,
        mat(COLORS[id], { emissive: COLORS[id], emissiveIntensity: 0.8, opacity: 0.22 }),
        0.7,
      );
    }

    // drone cues
    this.droneSelRing = torus(this.app, {
      parent: this.root,
      material: mat(COLORS.drone, { emissive: COLORS.drone, emissiveIntensity: 1.3, opacity: 0.9 }),
      ringRadius: 1,
      tubeRadius: 0.05,
      scale: [12, 4, 12],
    });
    this.droneSelRing.enabled = false;
    this.droneShadow = prim('cylinder', {
      parent: this.root,
      material: mat('#1c2226', { opacity: 0.3 }),
      scale: [7, 0.1, 7],
      castShadows: false,
      receiveShadows: false,
    });
    this.droneDropLine = new Beam(this.root, mat(COLORS.drone, { emissive: COLORS.drone, emissiveIntensity: 0.5, opacity: 0.14 }), 0.5);

    // home pad
    this.homeGroup = new pc.Entity('home');
    this.root.addChild(this.homeGroup);
    prim('cylinder', {
      parent: this.homeGroup,
      material: mat(COLORS.drone, { emissive: COLORS.drone, emissiveIntensity: 0.5, opacity: 0.5 }),
      pos: [0, 0.3, 0],
      scale: [14, 0.3, 14],
      castShadows: false,
    });
    torus(this.app, {
      parent: this.homeGroup,
      material: mat(COLORS.drone, { emissive: COLORS.drone, emissiveIntensity: 1 }),
      pos: [0, 0.5, 0],
      ringRadius: 1,
      tubeRadius: 0.04,
      scale: [8, 2, 8],
    });

    for (let i = 0; i < 8; i++) {
      const m = uniqueMat('#ffffff', { emissive: '#ffffff', emissiveIntensity: 1.5, opacity: 0 });
      const e = torus(this.app, { parent: this.root, material: m, ringRadius: 1, tubeRadius: 0.04 });
      e.enabled = false;
      this.pulses.push({ entity: e, material: m, age: 0, active: false });
    }
  }

  private ensureWaypointCapacity(count: number): void {
    while (this.wpTops.length < count) {
      this.routeBeams.push(new Beam(this.root, this.routeMaterial, 1.6));
      this.scoutRouteBeams.push(new Beam(this.root, this.scoutRouteMaterial, 1.2));
      const m = uniqueMat('#4db8ff', { emissive: '#4db8ff', emissiveIntensity: 1.2 });
      this.wpTopMats.push(m);
      const top = prim('sphere', { parent: this.root, material: m, castShadows: false, scale: [4.4, 4.4, 4.4] });
      top.enabled = false;
      this.wpTops.push(top);
      this.wpGuides.push(new Beam(this.root, this.waypointGuideMaterial, 0.5));
      const gd = prim('cylinder', {
        parent: this.root,
        material: this.waypointGroundMaterial,
        scale: [5, 0.15, 5],
        castShadows: false,
        receiveShadows: false,
      });
      gd.enabled = false;
      this.wpGroundDots.push(gd);
    }
  }

  pulse(pos: WorldPos, colorHex: string): void {
    const p = this.pulses.find((q) => !q.active) ?? this.pulses[0];
    p.active = true;
    p.age = 0;
    p.entity.enabled = true;
    p.entity.setPosition(pos.x, 1.4, -pos.y);
    const c = color(colorHex);
    p.material.emissive.set(c.r, c.g, c.b);
    p.material.diffuse.set(c.r, c.g, c.b);
  }

  update(dt: number, ui: MarkerUiState, time: number): void {
    const d = engine.drone;

    // trails
    this.droneTrail.set(engine.trails.get('drone-1') ?? [], ui.showTrails, 2.6);
    for (const id of SCOUT_IDS) {
      this.scoutTrails[id].set(engine.trails.get(id) ?? [], ui.showTrails, 2.4);
    }

    // planned route + pins
    const wps = d.waypoints;
    const selScout = ui.selectedId && ui.selectedId !== 'drone-1' ? engine.getEntity(ui.selectedId) : null;
    const sWps = selScout ? selScout.waypoints : [];
    const pinList = selScout ? sWps : wps;
    this.ensureWaypointCapacity(Math.max(26, wps.length, sWps.length));
    this.wpSelectedRing.enabled = false;
    for (let i = 0; i < this.wpTops.length; i++) {
      // drone route legs
      if (i < wps.length - 1) {
        this.routeBeams[i].set(P({ x: wps[i].x, y: wps[i].y, alt: wps[i].alt }), P({ x: wps[i + 1].x, y: wps[i + 1].y, alt: wps[i + 1].alt }), 1.6);
      } else {
        this.routeBeams[i].hide();
      }
      // scout patrol loop (only when a scout is selected)
      if (selScout && sWps.length >= 2 && i < sWps.length) {
        const a = sWps[i];
        const b = sWps[(i + 1) % sWps.length];
        this.scoutRouteBeams[i].set(new pc.Vec3(a.x, 1.4, -a.y), new pc.Vec3(b.x, 1.4, -b.y), 1.2);
      } else {
        this.scoutRouteBeams[i].hide();
      }
      // pins: drone route always, or selected scout's route
      const showDroneExtras = !selScout;
      if (i < pinList.length) {
        const w = pinList[i];
        const top = this.wpTops[i];
        top.enabled = true;
        top.setPosition(w.x, Math.max(w.alt, 4), -w.y);
        const cHex = selScout ? COLORS[selScout.id as ScoutId] : '#4db8ff';
        const c = color(cHex);
        this.wpTopMats[i].diffuse.set(c.r, c.g, c.b);
        this.wpTopMats[i].emissive.set(c.r, c.g, c.b);
        this.wpTopMats[i].update();
        if (ui.selectedWpId === w.id) {
          this.wpSelectedRing.enabled = true;
          this.wpSelectedRing.setPosition(w.x, Math.max(w.alt, 4), -w.y);
          this.wpSelectedRing.setLocalEulerAngles(0, time * 40, 0);
        }
        if (showDroneExtras) {
          this.wpGuides[i].set(new pc.Vec3(w.x, 0.5, -w.y), new pc.Vec3(w.x, w.alt, -w.y), 0.5);
          this.wpGroundDots[i].enabled = true;
          this.wpGroundDots[i].setPosition(w.x, 0.6, -w.y);
        } else {
          this.wpGuides[i].hide();
          this.wpGroundDots[i].enabled = false;
        }
      } else {
        this.wpTops[i].enabled = false;
        this.wpGuides[i].hide();
        this.wpGroundDots[i].enabled = false;
      }
    }

    // active leg
    const next = wps.find((w) => w.id === d.nextWpId);
    if (d.flightMode === 'MISSION' && next) {
      this.activeLeg.set(P(d.pos), P({ x: next.x, y: next.y, alt: next.alt }), 0.9);
    } else {
      this.activeLeg.hide();
    }

    // estimate + uncertainty + error vector
    const est = engine.estimate;
    this.estimateGroup.enabled = est.available;
    this.uncDisc.enabled = est.available && ui.showUncertainty;
    this.uncRing.enabled = est.available && ui.showUncertainty;
    if (est.available) {
      const p = est.pos;
      this.estimateGroup.setPosition(p.x, p.alt, -p.y);
      this.diamond.setLocalEulerAngles(0, time * 60, 0);
      this.diamond.setLocalPosition(0, Math.sin(time * 2.2) * 1.2, 0);
      this.estDropBeam.set(new pc.Vec3(p.x, 0.5, -p.y), new pc.Vec3(p.x, p.alt - 4, -p.y), 2.2);
      const r = Math.max(12, est.uncertainty);
      this.uncDisc.setPosition(p.x, 0.7, -p.y);
      this.uncDisc.setLocalScale(r * 2, 0.4, r * 2);
      this.uncRing.setPosition(p.x, 1.1, -p.y);
      this.uncRing.setLocalScale(r, 2, r);
      this.errorBeam.set(P(d.pos), P(p), 1.1);
      for (const s of engine.scouts) {
        if (s.detecting) {
          this.measureBeams[s.id].set(new pc.Vec3(s.pos.x, 4, -s.pos.y), P(p), 0.7);
        } else {
          this.measureBeams[s.id].hide();
        }
      }
    } else {
      this.estDropBeam.hide();
      this.errorBeam.hide();
      for (const id of SCOUT_IDS) this.measureBeams[id].hide();
    }

    // drone cues + selection
    const airborne = d.flightMode !== 'IDLE' && d.pos.alt > 2;
    this.droneShadow.enabled = airborne && d.visible;
    this.droneShadow.setPosition(d.pos.x, 0.5, -d.pos.y);
    if (airborne && d.visible) {
      this.droneDropLine.set(P(d.pos), new pc.Vec3(d.pos.x, 0.6, -d.pos.y), 0.5);
    } else {
      this.droneDropLine.hide();
    }
    this.droneSelRing.enabled = ui.selectedId === 'drone-1';
    if (this.droneSelRing.enabled) {
      const pulse = 1 + Math.sin(time * 3) * 0.06;
      this.droneSelRing.setPosition(d.pos.x, 1, -d.pos.y);
      this.droneSelRing.setLocalScale(12 * pulse, 4, 12 * pulse);
    }
    this.homeGroup.setPosition(d.home.x, 0, -d.home.y);

    // detect pulses
    for (const s of engine.scouts) {
      if (s.detecting && !this.prevDetecting[s.id]) this.pulse(s.pos, COLORS[s.id]);
      this.prevDetecting[s.id] = s.detecting;
    }
    for (const p of this.pulses) {
      if (!p.active) continue;
      p.age += dt;
      const life = 1.4;
      if (p.age >= life) {
        p.active = false;
        p.entity.enabled = false;
        continue;
      }
      const f = p.age / life;
      const r = 6 + f * 55;
      p.entity.setLocalScale(r, 2, r);
      p.material.opacity = 0.6 * (1 - f);
      p.material.update();
    }
  }
}
