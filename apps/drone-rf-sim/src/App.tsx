import { lazy, Suspense, useEffect } from 'react';
import { BottomBar, EventLog, LeftPanel, Legend, RightPanel, TopBar } from './ui/panels';
import { engine, useUi } from './state/store';

// renderer is chosen at load time and code-split so only one engine ships:
//   default            → PlayCanvas stylized 3D field view
//   ?renderer=cesium   → Cesium geographic map view (same simulation engine)
const PcView = lazy(() => import('./pc/PlayCanvasView').then((m) => ({ default: m.PlayCanvasView })));
const CesiumViewLazy = lazy(() => import('./cesium/CesiumView').then((m) => ({ default: m.CesiumView })));

export function App(): JSX.Element {
  const renderer = useUi((state) => state.renderer);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const ui = useUi.getState();
      const k = e.key.toLowerCase();
      if (k === ' ') {
        e.preventDefault();
        engine.setMode(engine.mode === 'run' ? 'pause' : 'run');
      } else if (k === '1' || k === '2' || k === '3' || k === '4') {
        ui.setCamMode(Number(k) as 1 | 2 | 3 | 4);
      } else if (k === 'r') {
        engine.reset();
      } else if (k === 'delete' || k === 'backspace') {
        if (ui.selectedId && ui.selectedWpId) engine.removeWaypoint(ui.selectedId, ui.selectedWpId);
      } else if (k === 'escape') {
        ui.select(null);
      } else if (k === 't') {
        ui.toggle('showTrails');
      } else if (k === 'u') {
        ui.toggle('showUncertainty');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const View = renderer === 'cesium' ? CesiumViewLazy : PcView;

  return (
    <div className="app-shell">
      <Suspense fallback={null}>
        <View />
      </Suspense>
      <TopBar />
      <LeftPanel />
      <RightPanel />
      <BottomBar />
      <EventLog />
      <Legend />
    </div>
  );
}
