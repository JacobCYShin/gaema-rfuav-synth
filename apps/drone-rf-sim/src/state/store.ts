import { create } from 'zustand';
import { SimulationEngine } from '../sim/engine';
import { MockRfModel } from '../sim/rf';
import { defaultScenario } from '../sim/scenario';
import type { EntityId } from '../sim/types';

export type CamMode = 1 | 2 | 3 | 4; // tactical / scout follow / drone follow / free
export type RendererMode = 'playcanvas' | 'cesium';

/** the one engine instance shared by React UI, the Cesium layer and tests */
export const engine = new SimulationEngine(new MockRfModel(), defaultScenario());

interface UiState {
  /** bumped (throttled) on any engine change — UI reads engine directly */
  rev: number;
  /** bumped when entity/waypoint sets change — Cesium rebuilds those entities */
  structRev: number;
  selectedId: EntityId | null;
  selectedWpId: string | null;
  camMode: CamMode;
  renderer: RendererMode;
  showTrails: boolean;
  showUncertainty: boolean;
  showLabels: boolean;
  select(id: EntityId | null, wpId?: string | null): void;
  selectWaypoint(wpId: string | null): void;
  setCamMode(m: CamMode): void;
  setRenderer(renderer: RendererMode): void;
  toggle(key: 'showTrails' | 'showUncertainty' | 'showLabels'): void;
}

export const useUi = create<UiState>((set) => ({
  rev: 0,
  structRev: 0,
  selectedId: null,
  selectedWpId: null,
  camMode: 1,
  renderer: new URLSearchParams(window.location.search).get('renderer') === 'cesium' ? 'cesium' : 'playcanvas',
  showTrails: true,
  showUncertainty: true,
  showLabels: true,
  select: (id, wpId = null) => set({ selectedId: id, selectedWpId: wpId }),
  selectWaypoint: (wpId) => set({ selectedWpId: wpId }),
  setCamMode: (m) => set({ camMode: m }),
  setRenderer: (renderer) => {
    const url = new URL(window.location.href);
    if (renderer === 'cesium') url.searchParams.set('renderer', 'cesium');
    else url.searchParams.delete('renderer');
    window.history.replaceState(null, '', url);
    set({ renderer });
  },
  toggle: (key) => set((s) => ({ ...s, [key]: !s[key] })),
}));

// ---- engine → store bridge (change events throttled to ~10 Hz for React)
let dirty = false;
setInterval(() => {
  if (dirty) {
    dirty = false;
    useUi.setState((s) => ({ rev: s.rev + 1 }));
  }
}, 100);
engine.onChange(() => {
  dirty = true;
});
engine.onStructure(() => {
  const st = useUi.getState();
  // drop selection of a waypoint that no longer exists
  if (st.selectedId && st.selectedWpId) {
    const ent = engine.getEntity(st.selectedId);
    if (!ent.waypoints.some((w) => w.id === st.selectedWpId)) {
      useUi.setState({ selectedWpId: null });
    }
  }
  useUi.setState((s) => ({ rev: s.rev + 1, structRev: s.structRev + 1 }));
});
