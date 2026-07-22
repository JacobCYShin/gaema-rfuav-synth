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
import { FLIGHT_MODE_KO, FUSION_STATUS_KO } from '../labels';
import { SpectrumPanel } from './spectrum';

const SCOUT_IDS: ScoutId[] = ['A', 'B', 'C'];

// dark-enough variants to stay readable on the light panel background
const STATUS_COLORS: Record<string, string> = {
  SEARCHING: '#54687c',
  DETECTED: '#1f9d55',
  TRACKING: '#0d6fb8',
  'LOW CONFIDENCE': '#b57717',
  LOST: '#d43f3f',
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
        드론 RF 탐지 <span>시뮬레이터 · 인터랙티브 시나리오</span>
      </div>
      <div className="top-right">
        <span className="time">T+ {fmtTime(engine.simTime)}</span>
        <span className="badge" style={{ color: STATUS_COLORS[status], borderColor: STATUS_COLORS[status] }}>
          {FUSION_STATUS_KO[status]}
        </span>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- LeftPanel
export function LeftPanel(): JSX.Element {
  useUi((s) => s.rev);
  const { selectedId, select, showTrails, showUncertainty, showLabels, toggle, renderer, setRenderer, simpleMode } = useUi();

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
      <div className="section">객체</div>
      {row('drone-1', engine.drone.name, COLORS.drone, FLIGHT_MODE_KO[d.flightMode], d.visible)}
      {engine.scouts.map((s) =>
        row(s.id, s.name, COLORS[s.id], s.receiverOn ? (s.rssi !== null ? `${s.rssi} dBm` : '수신 ON') : '수신 OFF', s.visible),
      )}
      {!simpleMode && (
        <>
          <div className="section">표시</div>
          <label className="chk">
            <input type="checkbox" checked={showTrails} onChange={() => toggle('showTrails')} /> 궤적
          </label>
          <label className="chk">
            <input type="checkbox" checked={showUncertainty} onChange={() => toggle('showUncertainty')} /> 불확실성
          </label>
          <label className="chk">
            <input type="checkbox" checked={showLabels} onChange={() => toggle('showLabels')} /> 라벨
          </label>
          <div className="section">시나리오</div>
          <div className="btn-row">
            <button className="hbtn" data-testid="btn-save" onClick={() => saveScenarioToStorage(engine.serialize())}>
              저장
            </button>
            <button
              className="hbtn"
              data-testid="btn-load"
              onClick={() => {
                const doc = loadScenarioFromStorage();
                if (doc) engine.loadScenario(doc);
              }}
            >
              불러오기
            </button>
          </div>
          <div className="btn-row">
            <button className="hbtn" onClick={() => exportScenarioFile(engine.serialize())}>
              내보내기
            </button>
            <button
              className="hbtn"
              onClick={() => {
                void importScenarioFile().then((doc) => doc && engine.loadScenario(doc));
              }}
            >
              가져오기
            </button>
          </div>
        </>
      )}
      <div className="hint">
        클릭: 선택 · 드래그: 이동
        <br />
        객체 선택 후 빈 땅 드래그: 그 자리로 이동
        <br />
        지면 더블클릭: 경유지 추가
        <br />
        Del: 경유지 삭제 · Esc: 선택 해제
        <br />
        {renderer === 'cesium' ? (
          <button className="view-link" data-testid="renderer-playcanvas" onClick={() => setRenderer('playcanvas')}>
            → 3D 현장뷰 (PlayCanvas)
          </button>
        ) : (
          <button className="view-link" data-testid="renderer-cesium" onClick={() => setRenderer('cesium')}>
            → 지도뷰 (Cesium)
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
      {ent.waypoints.length === 0 && <div className="hint">지도를 더블클릭하여 경유지를 추가하세요.</div>}
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
      <div className="section">경유지 {idx}</div>
      {owner === 'drone-1' && (
        <label className="field">
          고도 (m)
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
        속도 (m/s)
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
  const { selectedId, simpleMode } = useUi();
  const est = engine.estimate;

  let body: JSX.Element;
  if (!selectedId) {
    body = <div className="hint">지도나 객체 목록에서 드론 또는 스카우트를 선택하세요.</div>;
  } else if (selectedId === 'drone-1') {
    const d: DroneState = engine.drone;
    body = (
      <>
        <div className="section">{d.name}</div>
        {!simpleMode && (
          <>
            <div className="kv"><span>위치</span><span data-testid="drone-pos">{d.pos.x.toFixed(0)}, {d.pos.y.toFixed(0)}</span></div>
            <div className="kv"><span>기수</span><span>{((((d.heading * 180) / Math.PI) % 360 + 360) % 360).toFixed(0)}°</span></div>
          </>
        )}
        <div className="kv"><span>고도</span><span>{d.pos.alt.toFixed(0)} m</span></div>
        <div className="kv"><span>모드</span><span className="mode-badge">{FLIGHT_MODE_KO[d.flightMode]}</span></div>
        <div className="btn-row">
          <button className="hbtn" data-testid="btn-mission" onClick={() => engine.setFlightMode('MISSION')}>재개</button>
          <button className="hbtn" data-testid="btn-hold" onClick={() => engine.setFlightMode('HOLD')}>정지</button>
        </div>
        <div className="btn-row">
          <button className="hbtn" onClick={() => engine.setFlightMode('LOITER')}>선회</button>
          <button className="hbtn warn" data-testid="btn-rth" onClick={() => engine.setFlightMode('RTH')}>복귀</button>
        </div>
        {!simpleMode && (
          <>
            <label className="field">
              속도 오버라이드 (m/s)
              <span className="field-inline">
                <input
                  data-testid="ovr-speed"
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={d.speedOverride ?? ''}
                  placeholder="자동"
                  onChange={(e) => engine.setOverrides({ speed: e.target.value === '' ? null : Number(e.target.value) })}
                />
                <button className="mini" onClick={() => engine.setOverrides({ speed: null })}>자동</button>
              </span>
            </label>
            <label className="field">
              고도 오버라이드 (m)
              <span className="field-inline">
                <input
                  data-testid="ovr-alt"
                  type="number"
                  min={5}
                  max={500}
                  step={5}
                  value={d.altOverride ?? ''}
                  placeholder="자동"
                  onChange={(e) => engine.setOverrides({ alt: e.target.value === '' ? null : Number(e.target.value) })}
                />
                <button className="mini" onClick={() => engine.setOverrides({ alt: null })}>자동</button>
              </span>
            </label>
          </>
        )}
        <div className="section-row">
          <div className="section">경로 ({d.waypoints.length})</div>
          <button className="mini danger" onClick={() => engine.clearWaypoints('drone-1')}>초기화</button>
        </div>
        <WaypointList owner="drone-1" />
        <WaypointEditor owner="drone-1" />
      </>
    );
  } else {
    const s = engine.getEntity(selectedId) as ScoutState;
    const rssiPct = s.rssi === null ? 0 : Math.max(0, Math.min(100, ((s.rssi + 96) / 60) * 100));
    const snr = s.rssi === null ? null : s.rssi - engine.rfNoiseFloor;
    const snrPct = snr === null ? 0 : Math.max(0, Math.min(100, (snr / 40) * 100));
    body = (
      <>
        <div className="section">{s.name}</div>
        {!simpleMode && (
          <div className="kv"><span>위치</span><span data-testid="scout-pos">{s.pos.x.toFixed(0)}, {s.pos.y.toFixed(0)}</span></div>
        )}
        <div className="kv"><span>상태</span><span style={{ color: s.detecting ? '#1f9d55' : '#54687c' }}>{s.detecting ? '탐지 중' : s.receiverOn ? '탐색 중' : '수신 OFF'}</span></div>
        <label className="chk">
          <input type="checkbox" data-testid="rx-toggle" checked={s.receiverOn} onChange={() => engine.toggleReceiver(s.id)} />
          RF 수신기 켜기
        </label>
        <div className="meter-row">
          <span className="meter-label">RSSI</span>
          <div className="meter"><div className="meter-fill" style={{ width: `${rssiPct}%`, background: '#4db8ff' }} /></div>
          <span className="meter-val" data-testid="scout-rssi">{s.rssi === null ? '---' : `${s.rssi.toFixed(1)} dBm`}</span>
        </div>
        <div className="meter-row">
          <span className="meter-label">신뢰도</span>
          <div className="meter"><div className="meter-fill" style={{ width: `${(s.confidence * 100).toFixed(0)}%`, background: COLORS[s.id] }} /></div>
          <span className="meter-val">{(s.confidence * 100).toFixed(0)}%</span>
        </div>
        <SpectrumPanel scoutId={s.id} />
        {!simpleMode && (
          <>
            <div className="section-row">
              <div className="section">순찰 경로 ({s.waypoints.length})</div>
              <button className="mini danger" onClick={() => engine.clearWaypoints(s.id)}>초기화</button>
            </div>
            <WaypointList owner={s.id} />
            <WaypointEditor owner={s.id} />
          </>
        )}
      </>
    );
  }

  return (
    <div className="panel right-panel">
      {body}
      <div className="section">RF 융합</div>
      <div className="kv"><span>상태</span><span style={{ color: STATUS_COLORS[engine.status] }}>{FUSION_STATUS_KO[engine.status]}</span></div>
      <div className="kv">
        <span>활성 스카우트</span>
        <span>{engine.scouts.filter((s) => s.detecting).length} 탐지 · {engine.scouts.filter((s) => s.receiverOn).length}/{engine.scouts.length} 수신</span>
      </div>
      {!simpleMode && (
        <div className="kv"><span>추정 위치</span><span data-testid="est-pos">{est.available ? `${est.pos.x.toFixed(0)}, ${est.pos.y.toFixed(0)} · ${est.pos.alt.toFixed(0)}m` : '--'}</span></div>
      )}
      <div className="kv"><span>오차</span><span data-testid="est-unc">{est.available ? `± ${est.uncertainty} m` : '--'}</span></div>
      <div className="kv">
        <span>실제 오차</span>
        <span>{est.available ? `${Math.hypot(engine.drone.pos.x - est.pos.x, engine.drone.pos.y - est.pos.y).toFixed(0)} m` : '--'}</span>
      </div>
      <div className="kv"><span>신뢰도</span><span>{est.available ? `${(est.confidence * 100).toFixed(0)}%` : '--'}</span></div>
    </div>
  );
}

// --------------------------------------------------------------- BottomBar
export function BottomBar(): JSX.Element {
  useUi((s) => s.rev);
  const { camMode, setCamMode, simpleMode, showAnalytics, toggle } = useUi();
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

  if (simpleMode) {
    return (
      <div className="panel bottom-bar">
        {modeBtn('run', '실행', 'btn-run')}
        {modeBtn('pause', '일시정지', 'btn-pause')}
        <button className="hbtn warn" data-testid="btn-reset" onClick={() => engine.reset()}>리셋</button>
        <span className="sep" />
        {[1, 2, 4].map((m) => (
          <button
            key={m}
            className={`hbtn speed ${engine.speedMult === m ? 'active' : ''}`}
            onClick={() => engine.setSpeedMult(m)}
          >
            {m}×
          </button>
        ))}
        <span className="sep" />
        <button
          className={`hbtn ${showAnalytics ? 'active' : ''}`}
          data-testid="btn-analytics"
          onClick={() => toggle('showAnalytics')}
        >
          분석
        </button>
        <button className="hbtn" data-testid="btn-advanced" onClick={() => toggle('simpleMode')}>
          고급 설정 ▸
        </button>
      </div>
    );
  }

  return (
    <div className="panel bottom-bar">
      {modeBtn('edit', '편집', 'btn-edit')}
      {modeBtn('run', '실행', 'btn-run')}
      {modeBtn('pause', '일시정지', 'btn-pause')}
      {modeBtn('replay', '리플레이', 'btn-replay')}
      <button className="hbtn" data-testid="btn-step" onClick={() => engine.stepOnce()}>스텝</button>
      <button className="hbtn warn" data-testid="btn-reset" onClick={() => engine.reset()}>리셋</button>
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
          녹화 {fmtTime(recDur)}
        </span>
      )}
      <span className="sep" />
      {([1, 2, 3, 4, 5] as const).map((m) => (
        <button
          key={m}
          className={`hbtn cam ${camMode === m ? 'active' : ''}`}
          data-testid={`cam-${m}`}
          title={['', '전술 부감', '스카우트 추적', '드론 추적', '자유 시점', '스카우트 1인칭'][m]}
          onClick={() => setCamMode(m)}
        >
          {['', '전술', '정찰', '드론', '자유', '1인칭'][m]}
        </button>
      ))}
      <span className="sep" />
      <button
        className={`hbtn ${showAnalytics ? 'active' : ''}`}
        data-testid="btn-analytics"
        onClick={() => toggle('showAnalytics')}
      >
        분석
      </button>
      <button className="hbtn" data-testid="btn-advanced" onClick={() => toggle('simpleMode')}>
        ◂ 간단히
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- EventLog
export function EventLog(): JSX.Element | null {
  useUi((s) => s.rev);
  const simpleMode = useUi((s) => s.simpleMode);
  const ref = useRef<HTMLDivElement>(null);
  const events = engine.events.slice(-40);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  });
  if (simpleMode) return null;
  return (
    <div className="panel event-log">
      <div className="section">이벤트 로그</div>
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

// ----------------------------------------------------------------- CamHint
/** key guide shown while the free / first-person cameras are active */
export function CamHint(): JSX.Element | null {
  const camMode = useUi((s) => s.camMode);
  if (camMode !== 4 && camMode !== 5) return null;
  return (
    <div className="panel cam-hint">
      {camMode === 4 ? (
        <>
          <div><span className="key">W A S D</span> 이동 · <span className="key">Q</span><span className="key">E</span> 상/하</div>
          <div>마우스 드래그: 시점 회전 · 휠: 이동 속도</div>
        </>
      ) : (
        <div>스카우트 1인칭 시점 · 객체 목록에서 스카우트 선택 · <span className="key">1</span>~<span className="key">5</span> 시점 전환</div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Legend
export function Legend(): JSX.Element {
  return (
    <div className="panel legend">
      <div className="lg"><span className="dot" style={{ background: COLORS.drone }} />드론 (실제)</div>
      <div className="lg"><span className="dot diamond" style={{ background: COLORS.estimate }} />추정 위치</div>
      <div className="lg"><span className="dot ring" style={{ borderColor: COLORS.estimate }} />불확실성</div>
      <div className="lg"><span className="dot" style={{ background: COLORS.A }} />스카우트 A</div>
      <div className="lg"><span className="dot" style={{ background: COLORS.B }} />스카우트 B</div>
      <div className="lg"><span className="dot" style={{ background: COLORS.C }} />스카우트 C</div>
      <div className="lg"><span className="dot" style={{ background: '#4db8ff' }} />계획 경로</div>
      <div className="lg"><span className="dot" style={{ background: COLORS.disabled }} />수신 OFF / 상실</div>
    </div>
  );
}
