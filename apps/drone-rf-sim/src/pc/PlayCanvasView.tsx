import { useEffect, useRef } from 'react';
import * as pc from 'playcanvas';
import { engine, useUi } from '../state/store';
import type { EntityId, ScoutId, WorldPos } from '../sim/types';
import { buildEnvironment } from './scene/environment';
import { buildDrone } from './scene/drone';
import { buildScout, type ScoutRig } from './scene/scout';
import { PcMarkers } from './scene/markers';
import { CameraRig } from './CameraRig';
import { COLORS } from '../cesium/icons';
import { clearMaterialCache } from './scene/materials';
import { clearPrimitiveMeshCache } from './scene/builders';

const SCOUT_IDS: ScoutId[] = ['A', 'B', 'C'];

interface DragState {
  kind: 'entity' | 'wp' | 'ground';
  entityId: EntityId;
  wpId?: string;
  startX: number;
  startY: number;
  moved: boolean;
}

export function PlayCanvasView(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const host = hostRef.current!;
    const app = new pc.Application(canvas, {
      graphicsDeviceOptions: { antialias: true, alpha: false },
    });
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    const onResize = (): void => {
      app.resizeCanvas();
    };
    window.addEventListener('resize', onResize);

    // ---------------------------------------------------------- lighting
    app.scene.ambientLight = new pc.Color(0.45, 0.5, 0.57);
    const sun = new pc.Entity('sun');
    sun.addComponent('light', {
      type: 'directional',
      color: new pc.Color(1.0, 0.96, 0.88),
      intensity: 1.55,
      castShadows: true,
      // large-scale scene: generous biases to avoid full-ground shadow acne
      shadowBias: 0.9,
      normalOffsetBias: 3.2,
      shadowDistance: 650,
      shadowResolution: 2048,
    });
    sun.setEulerAngles(55, 35, 0);
    app.root.addChild(sun);
    const fill = new pc.Entity('fill');
    fill.addComponent('light', {
      type: 'directional',
      color: new pc.Color(0.62, 0.72, 0.86),
      intensity: 0.45,
      castShadows: false,
    });
    fill.setEulerAngles(-40, -140, 0);
    app.root.addChild(fill);

    const sceneAny = app.scene as unknown as Record<string, unknown>;
    const fogColor = new pc.Color(0.68, 0.78, 0.87);
    if (sceneAny.fog && typeof sceneAny.fog === 'object') {
      const fog = sceneAny.fog as { type: string; start: number; end: number; color: pc.Color };
      fog.type = pc.FOG_LINEAR;
      fog.start = 2800;
      fog.end = 11000;
      fog.color = fogColor;
    }

    // ------------------------------------------------------------- scene
    buildEnvironment(app);
    const droneRig = buildDrone(app);
    droneRig.root.setLocalScale(2.6, 2.6, 2.6);
    app.root.addChild(droneRig.root);
    const scoutRigs = new Map<ScoutId, ScoutRig>();
    for (const id of SCOUT_IDS) {
      const rig = buildScout(app, id, COLORS[id]);
      rig.root.setLocalScale(2.4, 2.4, 2.4);
      app.root.addChild(rig.root);
      scoutRigs.set(id, rig);
    }
    const markers = new PcMarkers(app);
    const camRig = new CameraRig(app, canvas);
    const ui = useUi;

    // ----------------------------------------------------- screen helpers
    const tmpScreen = new pc.Vec3();
    const cssScale = (): number => canvas.clientWidth / Math.max(1, app.graphicsDevice.width);
    const worldToScreen = (x: number, alt: number, y: number): { x: number; y: number } | null => {
      const camPos = camRig.entity.getPosition();
      const fwd = camRig.entity.forward;
      if ((x - camPos.x) * fwd.x + (alt - camPos.y) * fwd.y + (-y - camPos.z) * fwd.z < 1) return null;
      camRig.cameraComponent.worldToScreen(new pc.Vec3(x, alt, -y), tmpScreen);
      const s = cssScale();
      return { x: tmpScreen.x * s, y: tmpScreen.y * s };
    };
    const groundPick = (cssX: number, cssY: number): { x: number; y: number } | null => {
      const inv = 1 / cssScale();
      const cam = camRig.cameraComponent;
      const from = cam.screenToWorld(cssX * inv, cssY * inv, cam.nearClip);
      const to = cam.screenToWorld(cssX * inv, cssY * inv, cam.farClip);
      const dy = from.y - to.y;
      if (Math.abs(dy) < 1e-6) return null;
      const t = from.y / dy;
      if (t < 0 || t > 1) return null;
      const wx = from.x + (to.x - from.x) * t;
      const wz = from.z + (to.z - from.z) * t;
      return { x: wx, y: -wz };
    };
    const pinAnchor = (w: { x: number; y: number; alt: number }): { x: number; y: number; alt: number } => ({
      x: w.x,
      y: w.y,
      alt: Math.max(w.alt, 4),
    });
    const displayedWaypoints = (): { owner: EntityId; wp: { id: string; x: number; y: number; alt: number } }[] => {
      const sel = ui.getState().selectedId;
      const owner: EntityId = sel && sel !== 'drone-1' ? sel : 'drone-1';
      return engine.getEntity(owner).waypoints.map((wp) => ({ owner, wp }));
    };

    // -------------------------------------------------------- interactions
    let drag: DragState | null = null;
    camRig.isBlocked = () => drag !== null;

    const hitTest = (cssX: number, cssY: number): DragState | null => {
      for (const { owner, wp } of displayedWaypoints()) {
        const a = pinAnchor(wp);
        const s = worldToScreen(a.x, a.alt, a.y);
        if (s && Math.hypot(s.x - cssX, s.y - cssY) < 22) {
          return { kind: 'wp', entityId: owner, wpId: wp.id, startX: cssX, startY: cssY, moved: false };
        }
      }
      const ents: EntityId[] = ['drone-1', 'A', 'B', 'C'];
      for (const id of ents) {
        const e = engine.getEntity(id);
        const s = worldToScreen(e.pos.x, e.pos.alt + (id === 'drone-1' ? 0 : 3), e.pos.y);
        if (s && Math.hypot(s.x - cssX, s.y - cssY) < 26) {
          return { kind: 'entity', entityId: id, startX: cssX, startY: cssY, moved: false };
        }
      }
      return null;
    };

    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      drag = hitTest(e.clientX, e.clientY);
      // empty ground + a selected object → drag anywhere to reposition it
      // (free camera keeps its drag-to-rotate, so skip in cam mode 4)
      if (!drag) {
        const sel = ui.getState().selectedId;
        if (sel && ui.getState().camMode !== 4 && groundPick(e.clientX, e.clientY)) {
          drag = { kind: 'ground', entityId: sel, startX: e.clientX, startY: e.clientY, moved: false };
        }
      }
    };
    const onPointerMove = (e: PointerEvent): void => {
      if (!drag) return;
      // ground drags use a larger threshold so a double-click (add waypoint)
      // with slight hand jitter never teleports the selected object
      const threshold = drag.kind === 'ground' ? 8 : 4;
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < threshold) return;
      drag.moved = true;
      const g = groundPick(e.clientX, e.clientY);
      if (!g) return;
      if (drag.kind === 'wp') {
        if (drag.wpId) engine.moveWaypoint(drag.entityId, drag.wpId, g.x, g.y);
      } else {
        engine.moveEntity(drag.entityId, g.x, g.y);
      }
    };
    const onPointerUp = (e: PointerEvent): void => {
      if (!drag) return;
      if (!drag.moved) {
        if (drag.kind === 'entity') ui.getState().select(drag.entityId);
        else if (drag.kind === 'wp') ui.getState().select(drag.entityId, drag.wpId);
        // ground click without movement: keep selection (double-click adds waypoints)
      }
      void e;
      drag = null;
    };
    const onDblClick = (e: MouseEvent): void => {
      const sel = ui.getState().selectedId;
      if (!sel) return;
      if (hitTest(e.clientX, e.clientY)) return;
      const g = groundPick(e.clientX, e.clientY);
      if (!g) return;
      const wp = engine.addWaypoint(sel, g.x, g.y);
      ui.getState().select(sel, wp.id);
    };
    canvas.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    canvas.addEventListener('dblclick', onDblClick);

    // ------------------------------------------------------------- labels
    const labelLayer = document.createElement('div');
    labelLayer.className = 'label-layer';
    host.appendChild(labelLayer);
    const chips = new Map<string, HTMLDivElement>();
    const chip = (
      id: string,
      text: string,
      colorHex: string,
      screen: { x: number; y: number } | null,
      opts: { dim?: boolean; small?: boolean } = {},
    ): void => {
      let el = chips.get(id);
      if (!el) {
        el = document.createElement('div');
        chips.set(id, el);
        labelLayer.appendChild(el);
      }
      el.className = opts.small ? 'entity-chip wp-chip' : 'entity-chip';
      if (!screen || !ui.getState().showLabels) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      el.textContent = text;
      el.style.borderColor = colorHex;
      el.style.color = opts.dim ? '#95a2ad' : colorHex;
      el.style.opacity = opts.dim ? '0.65' : '1';
      el.style.transform = `translate(-50%, -135%) translate(${screen.x}px, ${screen.y}px)`;
    };
    const updateLabels = (): void => {
      const seen = new Set<string>();
      const mark = (id: string): string => {
        seen.add(id);
        return id;
      };
      const d = engine.drone;
      chip(mark('drone'), d.name, COLORS.drone, d.visible ? worldToScreen(d.pos.x, d.pos.alt + 9, d.pos.y) : null);
      for (const s of engine.scouts) {
        chip(
          mark('scout-' + s.id),
          s.rssi !== null ? `${s.name} · ${s.rssi.toFixed(0)}dBm` : s.name,
          COLORS[s.id],
          s.visible ? worldToScreen(s.pos.x, s.pos.alt + 9, s.pos.y) : null,
          { dim: !s.detecting },
        );
      }
      const est = engine.estimate;
      chip(
        mark('est'),
        `추정 ±${est.uncertainty}m`,
        COLORS.estimate,
        est.available ? worldToScreen(est.pos.x, est.pos.alt + 12, est.pos.y) : null,
      );
      chip(mark('home'), '홈', COLORS.drone, worldToScreen(d.home.x, 3, d.home.y), { small: true, dim: true });
      displayedWaypoints().forEach(({ owner, wp }, i) => {
        const a = pinAnchor(wp);
        const colorHex = owner === 'drone-1' ? '#4db8ff' : COLORS[owner as ScoutId];
        chip(mark('wp-' + wp.id), String(i + 1), colorHex, worldToScreen(a.x, a.alt + 6, a.y), { small: true });
      });
      for (const [id, el] of chips) {
        if (!seen.has(id)) el.style.display = 'none';
      }
    };

    // ---------------------------------------------------------- main loop
    let time = 0;
    let lastSimTime = 0;
    const lastPos = new Map<ScoutId, WorldPos>();
    // walk cycle driven by accumulated distance (not instantaneous speed) so
    // it stays correct under replay scrubbing and frame-stepped video capture
    const walkDist: Record<ScoutId, number> = { A: 0, B: 0, C: 0 };
    const lastMoveAt: Record<ScoutId, number> = { A: -10, B: -10, C: -10 };
    app.on('update', (dt: number) => {
      // scripts/record.mjs freezes the internal clock and steps the engine
      // manually so captured frames advance at an exact, uniform rate
      const manualTick = (window as unknown as Record<string, unknown>).__captureManualTick === true;
      if (!manualTick) engine.tick(dt);
      // during capture, ALL time-based motion (camera easing/orbit, pulses,
      // rig smoothing) must follow the uniformly stepped simulation clock —
      // wall-clock dt would make the encoded video pacing machine-dependent
      const effDt = manualTick ? Math.max(0, engine.simTime - lastSimTime) : dt;
      lastSimTime = engine.simTime;
      if (manualTick) time = engine.simTime;
      else time += dt;
      const st = ui.getState();
      const d = engine.drone;

      droneRig.root.enabled = d.visible;
      droneRig.update(effDt, { x: d.pos.x, y: d.pos.alt, z: -d.pos.y, headingRad: Math.PI - d.heading }, time);

      for (const s of engine.scouts) {
        const rig = scoutRigs.get(s.id)!;
        rig.root.enabled = s.visible;
        const last = lastPos.get(s.id);
        const delta = last ? Math.hypot(s.pos.x - last.x, s.pos.y - last.y) : 0;
        lastPos.set(s.id, { ...s.pos });
        if (delta > 0.01) {
          walkDist[s.id] += Math.min(delta, 3); // clamp scrub/drag jumps
          lastMoveAt[s.id] = engine.simTime;
        }
        rig.setPose(
          {
            x: s.pos.x,
            y: s.pos.alt,
            z: -s.pos.y,
            headingRad: Math.PI - s.heading,
            walkPhase: walkDist[s.id] * 1.7,
            // walking pose only while the sim clock itself is advancing;
            // otherwise an edit-mode drag would freeze a mid-stride pose
            moving:
              (engine.mode === 'run' || engine.mode === 'replay') &&
              engine.simTime - lastMoveAt[s.id] < 0.3,
            detecting: s.detecting,
            selected: st.selectedId === s.id,
          },
          effDt,
        );
      }

      markers.update(
        effDt,
        {
          showTrails: st.showTrails,
          showUncertainty: st.showUncertainty,
          selectedId: st.selectedId,
          selectedWpId: st.selectedWpId,
        },
        time,
      );

      const selScout: ScoutId = st.selectedId && st.selectedId !== 'drone-1' ? st.selectedId : 'A';
      camRig.update(effDt, st.camMode, selScout);
      updateLabels();
    });

    app.start();

    // ---------------------------------------------------- automation hooks
    const api = {
      engine,
      ui,
      screenOfEntity(id: EntityId): { x: number; y: number } | null {
        const e = engine.getEntity(id);
        return worldToScreen(e.pos.x, e.pos.alt + (id === 'drone-1' ? 0 : 3), e.pos.y);
      },
      screenOfWaypoint(owner: EntityId, wpId: string): { x: number; y: number } | null {
        const wp = engine.getEntity(owner).waypoints.find((q) => q.id === wpId);
        if (!wp) return null;
        const a = pinAnchor(wp);
        return worldToScreen(a.x, a.alt, a.y);
      },
      screenOfGround(x: number, y: number): { x: number; y: number } | null {
        return worldToScreen(x, 0, y);
      },
    };
    (window as unknown as Record<string, unknown>).__simApi = api;
    (window as unknown as Record<string, unknown>).__simReady = true;

    return () => {
      (window as unknown as Record<string, unknown>).__simReady = false;
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      canvas.removeEventListener('dblclick', onDblClick);
      camRig.dispose();
      labelLayer.remove();
      app.destroy();
      clearMaterialCache();
      clearPrimitiveMeshCache();
    };
  }, []);

  return (
    <div ref={hostRef} className="pc-host">
      <canvas ref={canvasRef} id="pc-canvas" />
    </div>
  );
}
