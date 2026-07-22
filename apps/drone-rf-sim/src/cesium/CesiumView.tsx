import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { engine, useUi, type CamMode } from '../state/store';
import type { EntityId, ScoutId, WorldPos } from '../sim/types';
import { latOf, lonOf, xOfLon, yOfLat, SITE_LAT, SITE_LON } from '../sim/geo';
import { addEnvironment, addImagery } from './ground';
import { COLORS, diamondIcon, droneIcon, homeIcon, scoutIcon, waypointPin } from './icons';

const SCOUT_IDS: ScoutId[] = ['A', 'B', 'C'];

const cart = (p: WorldPos): Cesium.Cartesian3 =>
  Cesium.Cartesian3.fromDegrees(lonOf(p.x), latOf(p.y), p.alt);
const cartXY = (x: number, y: number, alt: number): Cesium.Cartesian3 =>
  Cesium.Cartesian3.fromDegrees(lonOf(x), latOf(y), alt);

function css(c: string): Cesium.Color {
  return Cesium.Color.fromCssColorString(c);
}

interface DragState {
  kind: 'entity' | 'wp';
  entityId: EntityId;
  wpId?: string;
  moved: boolean;
}

export function CesiumView(): JSX.Element {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = divRef.current!;
    const creditDiv = document.createElement('div');
    creditDiv.style.display = 'none';

    const viewer = new Cesium.Viewer(container, {
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      selectionIndicator: false,
      infoBox: false,
      creditContainer: creditDiv,
      requestRenderMode: false,
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    });
    viewer.scene.globe.baseColor = css('#3c4738');
    viewer.scene.globe.enableLighting = false;
    viewer.scene.globe.showGroundAtmosphere = false;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601('2026-07-22T03:30:00Z');
    viewer.clock.shouldAnimate = false;
    viewer.scene.screenSpaceCameraController.enableTilt = true;

    void addImagery(viewer);
    addEnvironment(viewer);

    // --------------------------------------------------------- helpers
    const ui = useUi;
    const groundPick = (screen: Cesium.Cartesian2): { x: number; y: number } | null => {
      const c3 = viewer.camera.pickEllipsoid(screen, viewer.scene.globe.ellipsoid);
      if (!c3) return null;
      const carto = Cesium.Cartographic.fromCartesian(c3);
      return {
        x: xOfLon(Cesium.Math.toDegrees(carto.longitude)),
        y: yOfLat(Cesium.Math.toDegrees(carto.latitude)),
      };
    };

    // ------------------------------------------------- persistent entities
    const showLabels = new Cesium.CallbackProperty(() => ui.getState().showLabels, false);
    const labelOf = (text: string, colorHex: string): Cesium.LabelGraphics.ConstructorOptions => ({
      text,
      font: '11px sans-serif',
      fillColor: css(colorHex),
      showBackground: true,
      backgroundColor: css('#0a1018').withAlpha(0.72),
      backgroundPadding: new Cesium.Cartesian2(5, 3),
      pixelOffset: new Cesium.Cartesian2(0, -30),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      show: showLabels,
    });

    // drone
    viewer.entities.add({
      id: 'sel:drone-1',
      position: new Cesium.CallbackProperty(() => cart(engine.drone.pos), false) as never,
      billboard: {
        image: new Cesium.CallbackProperty(
          () => droneIcon(COLORS.drone, ui.getState().selectedId === 'drone-1'),
          false,
        ) as never,
        width: 40,
        height: 40,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: new Cesium.CallbackProperty(() => engine.drone.visible, false) as never,
      },
      label: labelOf('DRONE-1', COLORS.drone),
    });
    // altitude drop line + ground ring
    viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          const p = engine.drone.pos;
          return [cart(p), cartXY(p.x, p.y, 0)];
        }, false) as never,
        width: 1.5,
        material: css(COLORS.drone).withAlpha(0.22),
        show: new Cesium.CallbackProperty(() => engine.drone.visible && engine.drone.pos.alt > 2, false) as never,
      },
    });
    viewer.entities.add({
      position: new Cesium.CallbackProperty(() => {
        const p = engine.drone.pos;
        return cartXY(p.x, p.y, 0.3);
      }, false) as never,
      ellipse: {
        semiMajorAxis: 9,
        semiMinorAxis: 9,
        height: 0.3,
        material: css(COLORS.drone).withAlpha(0.25),
        show: new Cesium.CallbackProperty(() => engine.drone.visible && engine.drone.pos.alt > 2, false) as never,
      },
    });
    // home marker
    viewer.entities.add({
      id: 'home:drone-1',
      position: new Cesium.CallbackProperty(() => cartXY(engine.drone.home.x, engine.drone.home.y, 1), false) as never,
      billboard: {
        image: homeIcon(COLORS.drone),
        width: 26,
        height: 26,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    // scouts (label offsets staggered so nearby callsigns don't collide)
    const labelDy: Record<ScoutId, number> = { A: -30, B: -46, C: -30 };
    for (const id of SCOUT_IDS) {
      viewer.entities.add({
        id: `sel:${id}`,
        position: new Cesium.CallbackProperty(() => cart(engine.getEntity(id).pos), false) as never,
        billboard: {
          image: new Cesium.CallbackProperty(() => {
            const s = engine.scouts.find((q) => q.id === id)!;
            return scoutIcon(COLORS[id], id, ui.getState().selectedId === id, !s.receiverOn);
          }, false) as never,
          width: 34,
          height: 34,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          show: new Cesium.CallbackProperty(() => engine.getEntity(id).visible, false) as never,
        },
        label: {
          ...labelOf(`SCOUT ${id}`, COLORS[id]),
          pixelOffset: new Cesium.Cartesian2(0, labelDy[id]),
        },
      });
      // detection ring pulse around a detecting scout
      viewer.entities.add({
        position: new Cesium.CallbackProperty(() => {
          const p = engine.getEntity(id).pos;
          return cartXY(p.x, p.y, 0.5);
        }, false) as never,
        ellipse: {
          semiMajorAxis: new Cesium.CallbackProperty(
            () => 26 + Math.sin(performance.now() / 260) * 6,
            false,
          ) as never,
          semiMinorAxis: new Cesium.CallbackProperty(
            () => 26 + Math.sin(performance.now() / 260) * 6,
            false,
          ) as never,
          height: 0.5,
          material: Cesium.Color.TRANSPARENT,
          outline: true,
          outlineColor: css(COLORS[id]).withAlpha(0.85),
          outlineWidth: 2,
          show: new Cesium.CallbackProperty(() => {
            const s = engine.scouts.find((q) => q.id === id)!;
            return s.visible && s.detecting;
          }, false) as never,
        },
      });
    }

    // estimate marker + uncertainty + error vector
    viewer.entities.add({
      id: 'estimate',
      position: new Cesium.CallbackProperty(() => cart(engine.estimate.pos), false) as never,
      billboard: {
        image: diamondIcon(COLORS.estimate),
        width: 34,
        height: 34,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: new Cesium.CallbackProperty(() => engine.estimate.available, false) as never,
      },
      label: {
        ...labelOf('EST', COLORS.estimate),
        text: new Cesium.CallbackProperty(
          () => `EST ±${engine.estimate.uncertainty}m`,
          false,
        ) as never,
        show: new Cesium.CallbackProperty(
          () => engine.estimate.available && ui.getState().showLabels,
          false,
        ) as never,
      },
    });
    const uncShow = new Cesium.CallbackProperty(
      () => engine.estimate.available && ui.getState().showUncertainty,
      false,
    );
    viewer.entities.add({
      position: new Cesium.CallbackProperty(() => {
        const p = engine.estimate.pos;
        return cartXY(p.x, p.y, 0.6);
      }, false) as never,
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(() => Math.max(10, engine.estimate.uncertainty), false) as never,
        semiMinorAxis: new Cesium.CallbackProperty(() => Math.max(10, engine.estimate.uncertainty), false) as never,
        height: 0.6,
        material: css(COLORS.estimate).withAlpha(0.13),
        outline: true,
        outlineColor: css(COLORS.estimate).withAlpha(0.7),
        outlineWidth: 2,
        show: uncShow as never,
      },
    });
    viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(
          () => [cart(engine.drone.pos), cart(engine.estimate.pos)],
          false,
        ) as never,
        width: 2,
        material: new Cesium.PolylineDashMaterialProperty({
          color: css('#ff9d7a').withAlpha(0.8),
          dashLength: 10,
        }),
        show: new Cesium.CallbackProperty(
          () => engine.estimate.available && engine.drone.visible,
          false,
        ) as never,
      },
    });

    // trails — incremental Cartesian3 caches over engine.trails
    const trailCache = new Map<string, { len: number; pts: Cesium.Cartesian3[] }>();
    const trailPositions = (key: EntityId | 'estimate', flat: boolean) =>
      new Cesium.CallbackProperty(() => {
        const src = engine.trails.get(key) ?? [];
        let c = trailCache.get(key);
        if (!c || c.len > src.length) {
          c = { len: 0, pts: [] };
          trailCache.set(key, c);
        }
        while (c.len < src.length) {
          const p = src[c.len];
          c.pts.push(flat ? cartXY(p.x, p.y, 0.8) : cart(p));
          c.len++;
        }
        if (c.pts.length > src.length) c.pts.splice(0, c.pts.length - src.length);
        return c.pts;
      }, false);
    const showTrails = new Cesium.CallbackProperty(() => ui.getState().showTrails, false);
    viewer.entities.add({
      polyline: {
        positions: trailPositions('drone-1', false) as never,
        width: 3,
        material: new Cesium.PolylineGlowMaterialProperty({
          color: css(COLORS.drone).withAlpha(0.9),
          glowPower: 0.25,
        }),
        show: showTrails as never,
      },
    });
    for (const id of SCOUT_IDS) {
      viewer.entities.add({
        polyline: {
          positions: trailPositions(id, true) as never,
          width: 2.2,
          material: css(COLORS[id]).withAlpha(0.65),
          show: showTrails as never,
        },
      });
    }

    // planned route (drone): glow polyline through remaining waypoints
    viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(
          () => engine.drone.waypoints.map((w) => cartXY(w.x, w.y, w.alt)),
          false,
        ) as never,
        width: 4,
        material: new Cesium.PolylineGlowMaterialProperty({
          color: css('#4db8ff').withAlpha(0.85),
          glowPower: 0.22,
        }),
        show: new Cesium.CallbackProperty(() => engine.drone.waypoints.length >= 2, false) as never,
      },
    });
    // active leg: drone → next waypoint
    viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          const wp = engine.drone.waypoints.find((w) => w.id === engine.drone.nextWpId);
          if (!wp) return [];
          return [cart(engine.drone.pos), cartXY(wp.x, wp.y, wp.alt)];
        }, false) as never,
        width: 2,
        material: new Cesium.PolylineDashMaterialProperty({
          color: css('#9fe0ff').withAlpha(0.9),
          dashLength: 8,
        }),
        show: new Cesium.CallbackProperty(
          () => engine.drone.flightMode === 'MISSION' && engine.drone.nextWpId !== null,
          false,
        ) as never,
      },
    });
    // scout patrol route (only for the selected scout)
    viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          const sel = ui.getState().selectedId;
          if (!sel || sel === 'drone-1') return [];
          const wps = engine.getEntity(sel).waypoints;
          if (wps.length < 2) return [];
          const pts = wps.map((w) => cartXY(w.x, w.y, 1));
          pts.push(pts[0]); // patrol loop closes
          return pts;
        }, false) as never,
        width: 2.4,
        material: new Cesium.PolylineDashMaterialProperty({
          color: css('#c9d4dd').withAlpha(0.85),
          dashLength: 10,
        }),
        show: new Cesium.CallbackProperty(() => {
          const sel = ui.getState().selectedId;
          return !!sel && sel !== 'drone-1' && engine.getEntity(sel).waypoints.length >= 2;
        }, false) as never,
      },
    });

    // -------------------------------------------- waypoint pins (rebuilt)
    const wpSource = new Cesium.CustomDataSource('waypoints');
    void viewer.dataSources.add(wpSource);
    const rebuildWaypoints = (): void => {
      wpSource.entities.removeAll();
      const state = ui.getState();
      const builds: { owner: EntityId; color: string; showAlways: boolean }[] = [
        { owner: 'drone-1', color: '#4db8ff', showAlways: true },
        ...SCOUT_IDS.map((id) => ({ owner: id as EntityId, color: COLORS[id], showAlways: false })),
      ];
      for (const b of builds) {
        if (!b.showAlways && state.selectedId !== b.owner) continue;
        const ent = engine.getEntity(b.owner);
        ent.waypoints.forEach((w, i) => {
          const selected = state.selectedWpId === w.id;
          wpSource.entities.add({
            id: `wp:${b.owner}:${w.id}`,
            position: new Cesium.CallbackProperty(() => {
              const cur = engine.getEntity(b.owner).waypoints.find((q) => q.id === w.id);
              return cur ? cartXY(cur.x, cur.y, cur.alt) : cartXY(w.x, w.y, w.alt);
            }, false) as never,
            billboard: {
              image: waypointPin(i + 1, b.color, selected),
              width: 30,
              height: 30,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
          if (b.owner === 'drone-1') {
            // ground tick + vertical guide so altitude reads at a glance
            wpSource.entities.add({
              id: `wpg:${b.owner}:${w.id}`,
              position: new Cesium.CallbackProperty(() => {
                const cur = engine.getEntity(b.owner).waypoints.find((q) => q.id === w.id);
                return cartXY(cur?.x ?? w.x, cur?.y ?? w.y, 0.4);
              }, false) as never,
              point: {
                pixelSize: 7,
                color: css(b.color).withAlpha(0.9),
                outlineColor: css('#0a1018'),
                outlineWidth: 1.5,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            });
            wpSource.entities.add({
              polyline: {
                positions: new Cesium.CallbackProperty(() => {
                  const cur = engine.getEntity(b.owner).waypoints.find((q) => q.id === w.id);
                  if (!cur) return [];
                  return [cartXY(cur.x, cur.y, 0.4), cartXY(cur.x, cur.y, cur.alt)];
                }, false) as never,
                width: 1.2,
                material: css(b.color).withAlpha(0.3),
              },
            });
          }
        });
      }
    };
    rebuildWaypoints();
    const unsubStruct = useUi.subscribe((s, prev) => {
      if (s.structRev !== prev.structRev || s.selectedId !== prev.selectedId || s.selectedWpId !== prev.selectedWpId) {
        rebuildWaypoints();
      }
    });

    // ------------------------------------------------------- interactions
    viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    let drag: DragState | null = null;

    const pickId = (screen: Cesium.Cartesian2): string | null => {
      const picked = viewer.scene.pick(screen) as { id?: { id?: string } } | undefined;
      const id = picked?.id?.id;
      return typeof id === 'string' ? id : null;
    };

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const id = pickId(e.position);
      if (!id) return;
      if (id.startsWith('sel:')) {
        drag = { kind: 'entity', entityId: id.slice(4) as EntityId, moved: false };
      } else if (id.startsWith('wp:') || id.startsWith('wpg:')) {
        const [, owner, wpId] = id.split(':');
        drag = { kind: 'wp', entityId: owner as EntityId, wpId, moved: false };
      } else {
        return;
      }
      viewer.scene.screenSpaceCameraController.enableInputs = false;
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      if (!drag) return;
      const g = groundPick(e.endPosition);
      if (!g) return;
      drag.moved = true;
      if (drag.kind === 'entity') engine.moveEntity(drag.entityId, g.x, g.y);
      else if (drag.wpId) engine.moveWaypoint(drag.entityId, drag.wpId, g.x, g.y);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(() => {
      if (drag) {
        viewer.scene.screenSpaceCameraController.enableInputs = true;
      }
      // keep drag reference until the click event fires (to suppress select)
      setTimeout(() => {
        drag = null;
      }, 0);
    }, Cesium.ScreenSpaceEventType.LEFT_UP);

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      if (drag?.moved) return;
      const id = pickId(e.position);
      if (!id) return; // clicking empty ground keeps the selection
      if (id.startsWith('sel:')) {
        ui.getState().select(id.slice(4) as EntityId);
      } else if (id.startsWith('wp:') || id.startsWith('wpg:')) {
        const [, owner, wpId] = id.split(':');
        ui.getState().select(owner as EntityId, wpId);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const sel = ui.getState().selectedId;
      if (!sel) return;
      const picked = pickId(e.position);
      if (picked && (picked.startsWith('sel:') || picked.startsWith('wp'))) return;
      const g = groundPick(e.position);
      if (!g) return;
      const wp = engine.addWaypoint(sel, g.x, g.y);
      ui.getState().select(sel, wp.id);
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // ---------------------------------------------------------- cameras
    let lastCam: CamMode | null = null;
    const flyTactical = (initial: boolean): void => {
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      const dest = Cesium.Cartesian3.fromDegrees(SITE_LON, SITE_LAT - 0.0145, 2000);
      const orientation = { heading: 0, pitch: Cesium.Math.toRadians(-52), roll: 0 };
      if (initial) viewer.camera.setView({ destination: dest, orientation });
      else viewer.camera.flyTo({ destination: dest, orientation, duration: 1.1 });
    };
    flyTactical(true);

    const updateCamera = (): void => {
      const state = ui.getState();
      const mode = state.camMode;
      if (mode !== lastCam) {
        if (mode === 1) flyTactical(false);
        if (mode === 4) viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        lastCam = mode;
      }
      if (mode === 2) {
        const scout = engine.getEntity(
          state.selectedId && state.selectedId !== 'drone-1' ? state.selectedId : 'A',
        );
        viewer.camera.lookAt(
          cart({ ...scout.pos, alt: scout.pos.alt + 2 }),
          new Cesium.HeadingPitchRange(scout.heading, Cesium.Math.toRadians(-32), 260),
        );
      } else if (mode === 3) {
        const d = engine.drone;
        viewer.camera.lookAt(
          cart(d.pos),
          new Cesium.HeadingPitchRange(d.heading, Cesium.Math.toRadians(-26), 380),
        );
      }
    };

    // --------------------------------------------------------- main loop
    let last = performance.now();
    const preUpdate = (): void => {
      const now = performance.now();
      engine.tick((now - last) / 1000);
      last = now;
      updateCamera();
    };
    viewer.scene.preUpdate.addEventListener(preUpdate);

    // ------------------------------------------------- automation hooks
    const worldToWindow =
      (Cesium.SceneTransforms as unknown as Record<string, unknown>).worldToWindowCoordinates ??
      (Cesium.SceneTransforms as unknown as Record<string, unknown>).wgs84ToWindowCoordinates;
    const api = {
      engine,
      ui,
      screenOfEntity(id: EntityId): { x: number; y: number } | null {
        const p = engine.getEntity(id).pos;
        const w = (worldToWindow as (s: Cesium.Scene, c: Cesium.Cartesian3) => Cesium.Cartesian2 | undefined)(
          viewer.scene,
          cart(p),
        );
        return w ? { x: w.x, y: w.y } : null;
      },
      screenOfWaypoint(owner: EntityId, wpId: string): { x: number; y: number } | null {
        const wp = engine.getEntity(owner).waypoints.find((q) => q.id === wpId);
        if (!wp) return null;
        const w = (worldToWindow as (s: Cesium.Scene, c: Cesium.Cartesian3) => Cesium.Cartesian2 | undefined)(
          viewer.scene,
          cartXY(wp.x, wp.y, wp.alt),
        );
        return w ? { x: w.x, y: w.y } : null;
      },
      screenOfGround(x: number, y: number): { x: number; y: number } | null {
        const w = (worldToWindow as (s: Cesium.Scene, c: Cesium.Cartesian3) => Cesium.Cartesian2 | undefined)(
          viewer.scene,
          cartXY(x, y, 0),
        );
        return w ? { x: w.x, y: w.y } : null;
      },
    };
    (window as unknown as Record<string, unknown>).__simApi = api;
    (window as unknown as Record<string, unknown>).__simReady = true;

    return () => {
      unsubStruct();
      viewer.scene.preUpdate.removeEventListener(preUpdate);
      handler.destroy();
      viewer.destroy();
      (window as unknown as Record<string, unknown>).__simReady = false;
    };
  }, []);

  return <div ref={divRef} className="cesium-host" />;
}
