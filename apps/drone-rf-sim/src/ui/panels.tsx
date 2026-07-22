import { useRef, useEffect } from 'react';
import { engine, useUi } from '../state/store';
import type { DroneState, EntityId, ScoutId, ScoutState, Waypoint } from '../sim/types';
import {
  exportScenarioFile,
  importScenarioFile,
  loadScenarioFromStorage,
  saveScenarioToStorage,
} from '../sim/scenario';
import { COLORS } from '../cesium/icons';

const SCOUT_IDS: ScoutId[] = ['A', 'B', 'C'];

const STATUS_COLORS: Record<string, string> = {
  SEARCHING: '#8fa3b8',
  DETECTED: '#57d98a',
  TRACKING: '#4db8ff',
  'LOW CONFIDENCE': '#ffb84d',
  LOST: '#ff5f5f',
};

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  return `${String(m).padStart(2, '0')}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
}

// ------------------------------------------------------------------ TopBar
export function TopBar(): JSX.Element {
  useUi((s) => s.rev);
  const status = engine.status;
  return (
    <div className="panel top-bar">
      <div className="title">
        DRONE RF DETECTION <span>SIMULATOR · INTERACTIVE SCENARIO</span>
      </div>
      <div className="top-right">
        <span className="time">T+ {fmtTime(engine.simTime)}</span>
        <span className="badge" style={{ color: STATUS_COLORS[status], borderColor: STATUS_COLORS[status] }}>
          {status}
        </span>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- LeftPanel
export function LeftPanel(): JSX.Element {
  useUi((s) => s.rev);
  const { selectedId, select, showTrails, showUncertainty, showLabels, toggle, renderer, setRenderer } = useUi();

  const row = (id: EntityId, name: string, color: string, sub: string, visible: boolean) => (
    <div
      key={id}
      className={`obj-row ${selectedId === id ? 'selected' : ''}`}
      onClick={() => select(id)}
      data-testid={`obj-${id}`}
    >
      <span className="dot" style={{ background: color }} />
      <span className="obj-name">{name}</span>
      <span className="obj-sub">{sub}</span>
      <button
        className="mini"
        title="show / hide"
        onClick={(e) => {
          e.stopPropagation();
          engine.setVisible(id, !visible);
        }}
      >
        {visible ? '◉' : '○'}
      </button>
    </div>
  );

  const d = engine.drone;
  return (
    <div className="panel left-panel">
      <div className="section">OBJECTS</div>
      {row('drone-1', 'DRONE-1', COLORS.drone, d.flightMode, d.visible)}
      {engine.scouts.map((s) =>
        row(s.id, s.name, COLORS[s.id], s.receiverOn ? (s.rssi !== null ? `${s.rssi} dBm` : 'RX ON') : 'RX OFF', s.visible),
      )}
      <div className="section">DISPLAY</div>
      <label className="chk">
        <input type="checkbox" checked={showTrails} onChange={() => toggle('showTrails')} /> Trails
      </label>
      <label className="chk">
        <input type="checkbox" checked={showUncertainty} onChange={() => toggle('showUncertainty')} /> Uncertainty
      </label>
      <label className="chk">
        <input type="checkbox" checked={showLabels} onChange={() => toggle('showLabels')} /> Labels
      </label>
      <div className="section">SCENARIO</div>
      <div className="btn-row">
        <button className="hbtn" data-testid="btn-save" onClick={() => saveScenarioToStorage(engine.serialize())}>
          Save
        </button>
        <button
          className="hbtn"
          data-testid="btn-load"
          onClick={() => {
            const doc = loadScenarioFromStorage();
            if (doc) engine.loadScenario(doc);
          }}
        >
          Load
        </button>
      </div>
      <div className="btn-row">
        <button className="hbtn" onClick={() => exportScenarioFile(engine.serialize())}>
          Export
        </button>
        <button
          className="hbtn"
          onClick={() => {
            void importScenarioFile().then((doc) => doc && engine.loadScenario(doc));
          }}
        >
          Import
        </button>
      </div>
      <div className="hint">
        Click: select · Drag icon/pin: move
        <br />
        Double-click ground: add waypoint
        <br />
        Del: remove waypoint · Esc: deselect
        <br />
        {renderer === 'cesium' ? (
          <button className="view-link" data-testid="renderer-playcanvas" onClick={() => setRenderer('playcanvas')}>
            → 3D field view (PlayCanvas)
          </button>
        ) : (
          <button className="view-link" data-testid="renderer-cesium" onClick={() => setRenderer('cesium')}>
            → Map view (Cesium)
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------- waypoint list rows
function WaypointList({ owner }: { owner: EntityId }): JSX.Element {
  const { selectedWpId, select } = useUi();
  const ent = engine.getEntity(owner);
  const isDrone = owner === 'drone-1';
  return (
    <div className="wp-list" data-testid="wp-list">
      {ent.waypoints.length === 0 && <div className="hint">Double-click on the map to add waypoints.</div>}
      {ent.waypoints.map((w: Waypoint, i: number) => (
        <div
          key={w.id}
          className={`wp-row ${selectedWpId === w.id ? 'selected' : ''} ${ent.nextWpId === w.id ? 'active' : ''}`}
          onClick={() => select(owner, w.id)}
        >
          <span className="wp-num">{i + 1}</span>
          {isDrone && <span className="wp-meta">{w.alt.toFixed(0)}m</span>}
          <span className="wp-meta">{w.speed.toFixed(1)}m/s</span>
          <span className="wp-spacer" />
          <button className="mini" onClick={(e) => { e.stopPropagation(); engine.reorderWaypoint(owner, w.id, -1); }}>↑</button>
          <button className="mini" onClick={(e) => { e.stopPropagation(); engine.reorderWaypoint(owner, w.id, 1); }}>↓</button>
          <button className="mini danger" data-testid={`wp-del-${i}`} onClick={(e) => { e.stopPropagation(); engine.removeWaypoint(owner, w.id); }}>✕</button>
        </div>
      ))}
    </div>
  );
}

function WaypointEditor({ owner }: { owner: EntityId }): JSX.Element | null {
  const { selectedWpId } = useUi();
  const ent = engine.getEntity(owner);
  const wp = ent.waypoints.find((w) => w.id === selectedWpId);
  if (!wp) return null;
  const idx = ent.waypoints.indexOf(wp) + 1;
  return (
    <div className="wp-editor">
      <div className="section">WAYPOINT {idx}</div>
      {owner === 'drone-1' && (
        <label className="field">
          ALT (m)
          <input
            data-testid="wp-alt"
            type="number"
            min={5}
            max={500}
            step={5}
            value={Math.round(wp.alt)}
            onChange={(e) => engine.updateWaypoint(owner, wp.id, { alt: Number(e.target.value) })}
          />
        </label>
      )}
      <label className="field">
        SPEED (m/s)
        <input
          data-testid="wp-speed"
          type="number"
          min={0.5}
          max={60}
          step={0.5}
          value={wp.speed}
          onChange={(e) => engine.updateWaypoint(owner, wp.id, { speed: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}

// -------------------------------------------------------------- RightPanel
export function RightPanel(): JSX.Element {
  useUi((s) => s.rev);
  const { selectedId } = useUi();
  const est = engine.estimate;

  let body: JSX.Element;
  if (!selectedId) {
    body = <div className="hint">Select the drone or a scout on the map / object list.</div>;
  } else if (selectedId === 'drone-1') {
    const d: DroneState = engine.drone;
    body = (
      <>
        <div className="section">DRONE-1</div>
        <div className="kv"><span>POS</span><span data-testid="drone-pos">{d.pos.x.toFixed(0)}, {d.pos.y.toFixed(0)}</span></div>
        <div className="kv"><span>ALT</span><span>{d.pos.alt.toFixed(0)} m</span></div>
        <div className="kv"><span>HDG</span><span>{((((d.heading * 180) / Math.PI) % 360 + 360) % 360).toFixed(0)}°</span></div>
        <div className="kv"><span>MODE</span><span className="mode-badge">{d.flightMode}</span></div>
        <div className="btn-row">
          <button className="hbtn" data-testid="btn-mission" onClick={() => engine.setFlightMode('MISSION')}>RESUME</button>
          <button className="hbtn" data-testid="btn-hold" onClick={() => engine.setFlightMode('HOLD')}>HOLD</button>
        </div>
        <div className="btn-row">
          <button className="hbtn" onClick={() => engine.setFlightMode('LOITER')}>LOITER</button>
          <button className="hbtn warn" data-testid="btn-rth" onClick={() => engine.setFlightMode('RTH')}>RTH</button>
        </div>
        <label className="field">
          SPEED OVERRIDE (m/s)
          <span className="field-inline">
            <input
              data-testid="ovr-speed"
              type="number"
              min={1}
              max={60}
              step={1}
              value={d.speedOverride ?? ''}
              placeholder="auto"
              onChange={(e) => engine.setOverrides({ speed: e.target.value === '' ? null : Number(e.target.value) })}
            />
            <button className="mini" onClick={() => engine.setOverrides({ speed: null })}>auto</button>
          </span>
        </label>
        <label className="field">
          ALT OVERRIDE (m)
          <span className="field-inline">
            <input
              data-testid="ovr-alt"
              type="number"
              min={5}
              max={500}
              step={5}
              value={d.altOverride ?? ''}
              placeholder="auto"
              onChange={(e) => engine.setOverrides({ alt: e.target.value === '' ? null : Number(e.target.value) })}
            />
            <button className="mini" onClick={() => engine.setOverrides({ alt: null })}>auto</button>
          </span>
        </label>
        <div className="section-row">
          <div className="section">ROUTE ({d.waypoints.length})</div>
          <button className="mini danger" onClick={() => engine.clearWaypoints('drone-1')}>clear</button>
        </div>
        <WaypointList owner="drone-1" />
        <WaypointEditor owner="drone-1" />
      </>
    );
  } else {
    const s = engine.getEntity(selectedId) as ScoutState;
    const rssiPct = s.rssi === null ? 0 : Math.max(0, Math.min(100, ((s.rssi + 96) / 60) * 100));
    body = (
      <>
        <div className="section">SCOUT {s.id}</div>
        <div className="kv"><span>POS</span><span data-testid="scout-pos">{s.pos.x.toFixed(0)}, {s.pos.y.toFixed(0)}</span></div>
        <div className="kv"><span>STATE</span><span style={{ color: s.detecting ? '#57d98a' : '#8fa3b8' }}>{s.detecting ? 'DETECTING' : s.receiverOn ? 'SEARCHING' : 'RX OFF'}</span></div>
        <label className="chk">
          <input type="checkbox" data-testid="rx-toggle" checked={s.receiverOn} onChange={() => engine.toggleReceiver(s.id)} />
          RF receiver on
        </label>
        <div className="meter-row">
          <span className="meter-label">RSSI</span>
          <div className="meter"><div className="meter-fill" style={{ width: `${rssiPct}%`, background: '#4db8ff' }} /></div>
          <span className="meter-val" data-testid="scout-rssi">{s.rssi === null ? '---' : `${s.rssi.toFixed(1)} dBm`}</span>
        </div>
        <div className="meter-row">
          <span className="meter-label">CONF</span>
          <div className="meter"><div className="meter-fill" style={{ width: `${(s.confidence * 100).toFixed(0)}%`, background: COLORS[s.id] }} /></div>
          <span className="meter-val">{(s.confidence * 100).toFixed(0)}%</span>
        </div>
        <div className="section-row">
          <div className="section">PATROL ({s.waypoints.length})</div>
          <button className="mini danger" onClick={() => engine.clearWaypoints(s.id)}>clear</button>
        </div>
        <WaypointList owner={s.id} />
        <WaypointEditor owner={s.id} />
      </>
    );
  }

  return (
    <div className="panel right-panel">
      {body}
      <div className="section">RF FUSION</div>
      <div className="kv"><span>STATUS</span><span style={{ color: STATUS_COLORS[engine.status] }}>{engine.status}</span></div>
      <div className="kv"><span>EST POS</span><span data-testid="est-pos">{est.available ? `${est.pos.x.toFixed(0)}, ${est.pos.y.toFixed(0)} · ${est.pos.alt.toFixed(0)}m` : '--'}</span></div>
      <div className="kv"><span>UNCERT</span><span data-testid="est-unc">{est.available ? `± ${est.uncertainty} m` : '--'}</span></div>
      <div className="kv"><span>CONF</span><span>{est.available ? `${(est.confidence * 100).toFixed(0)}%` : '--'}</span></div>
    </div>
  );
}

// --------------------------------------------------------------- BottomBar
export function BottomBar(): JSX.Element {
  useUi((s) => s.rev);
  const { camMode, setCamMode } = useUi();
  const mode = engine.mode;
  const recDur = engine.recordingDuration();

  const modeBtn = (m: 'edit' | 'run' | 'pause' | 'replay', label: string, testid: string) => (
    <button
      className={`hbtn mode-btn ${mode === m ? 'active' : ''}`}
      data-testid={testid}
      disabled={m === 'replay' && engine.recording.length === 0}
      onClick={() => engine.setMode(m)}
    >
      {label}
    </button>
  );

  return (
    <div className="panel bottom-bar">
      {modeBtn('edit', 'EDIT', 'btn-edit')}
      {modeBtn('run', 'RUN', 'btn-run')}
      {modeBtn('pause', 'PAUSE', 'btn-pause')}
      {modeBtn('replay', 'REPLAY', 'btn-replay')}
      <button className="hbtn" data-testid="btn-step" onClick={() => engine.stepOnce()}>STEP</button>
      <button className="hbtn warn" data-testid="btn-reset" onClick={() => engine.reset()}>RESET</button>
      <span className="sep" />
      {[0.5, 1, 2, 4].map((m) => (
        <button
          key={m}
          className={`hbtn speed ${engine.speedMult === m ? 'active' : ''}`}
          onClick={() => engine.setSpeedMult(m)}
        >
          {m}×
        </button>
      ))}
      <span className="sep" />
      {mode === 'replay' ? (
        <>
          <button className="hbtn" onClick={() => engine.setReplayPlaying(!engine.replayPlaying)}>
            {engine.replayPlaying ? '▮▮' : '▶'}
          </button>
          <input
            className="timeline"
            type="range"
            min={0}
            max={Math.max(0.1, recDur)}
            step={0.1}
            value={engine.replayTime}
            onChange={(e) => engine.replaySeek(Number(e.target.value))}
          />
          <span className="time small">{fmtTime(engine.replayTime)} / {fmtTime(recDur)}</span>
        </>
      ) : (
        <span className="rec-info">
          {mode === 'run' ? <span className="rec-dot" /> : null}
          REC {fmtTime(recDur)}
        </span>
      )}
      <span className="sep" />
      {([1, 2, 3, 4] as const).map((m) => (
        <button
          key={m}
          className={`hbtn cam ${camMode === m ? 'active' : ''}`}
          data-testid={`cam-${m}`}
          title={['', 'Tactical', 'Scout follow', 'Drone follow', 'Free'][m]}
          onClick={() => setCamMode(m)}
        >
          {['', 'TAC', 'SCT', 'DRN', 'FREE'][m]}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- EventLog
export function EventLog(): JSX.Element {
  useUi((s) => s.rev);
  const ref = useRef<HTMLDivElement>(null);
  const events = engine.events.slice(-40);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  });
  return (
    <div className="panel event-log">
      <div className="section">EVENT LOG</div>
      <div className="log-scroll" ref={ref}>
        {events.map((e, i) => (
          <div key={i} className={`log-row ${e.kind}`}>
            <span className="log-t">{fmtTime(e.t)}</span> {e.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Legend
export function Legend(): JSX.Element {
  return (
    <div className="panel legend">
      <div className="lg"><span className="dot" style={{ background: COLORS.drone }} />Drone (truth)</div>
      <div className="lg"><span className="dot diamond" style={{ background: COLORS.estimate }} />Estimated position</div>
      <div className="lg"><span className="dot ring" style={{ borderColor: COLORS.estimate }} />Uncertainty</div>
      <div className="lg"><span className="dot" style={{ background: COLORS.A }} />Scout A</div>
      <div className="lg"><span className="dot" style={{ background: COLORS.B }} />Scout B</div>
      <div className="lg"><span className="dot" style={{ background: COLORS.C }} />Scout C</div>
      <div className="lg"><span className="dot" style={{ background: '#4db8ff' }} />Planned route</div>
      <div className="lg"><span className="dot" style={{ background: COLORS.disabled }} />RX off / lost</div>
    </div>
  );
}
