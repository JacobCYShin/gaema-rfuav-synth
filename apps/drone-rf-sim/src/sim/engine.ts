import type {
  DroneState,
  EntityId,
  Estimate,
  FlightMode,
  FusionStatus,
  ReplayFrame,
  RfModel,
  ScenarioDoc,
  ScoutId,
  ScoutState,
  SimEvent,
  SimMode,
  Waypoint,
  WorldPos,
} from './types';
import { FLIGHT_MODE_KO, FUSION_STATUS_KO, SIM_MODE_KO } from '../labels';

let wpCounter = 1;

const SCOUT_IDS: ScoutId[] = ['A', 'B', 'C'];
const DRONE_CLIMB_RATE = 8; // m/s
const DRONE_AIRBORNE_ALT = 2; // meters above ground
const LOITER_RADIUS = 60;
const RECORD_STEP = 0.2;
const TRAIL_STEP = 4; // meters between trail samples

interface LiveSimulationSnapshot {
  mode: SimMode;
  simTime: number;
  drone: {
    pos: WorldPos;
    heading: number;
    nextWpId: string | null;
    flightMode: FlightMode;
    loiterCenter: WorldPos | null;
    loiterAngle: number;
  };
  scouts: {
    id: ScoutId;
    pos: WorldPos;
    heading: number;
    nextWpId: string | null;
    rssi: number | null;
    confidence: number;
    detecting: boolean;
  }[];
  estimate: Estimate;
  status: FusionStatus;
}

function dist2(a: WorldPos, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Single source of truth for the simulation. Pure TypeScript — no Cesium,
 * no React. Renderers read state each frame; UI mutates it only through
 * the command methods below. A future PlayCanvas field view consumes this
 * same engine so no renderer ever computes its own drone motion.
 */
export class SimulationEngine {
  drone!: DroneState;
  scouts!: ScoutState[];
  mode: SimMode = 'edit';
  simTime = 0;
  speedMult = 1;
  estimate: Estimate = { available: false, pos: { x: 0, y: 0, alt: 0 }, uncertainty: 0, confidence: 0, staleFor: 0 };
  status: FusionStatus = 'SEARCHING';
  /** receiver thermal-noise floor from the RF model, dBm (UI derives SNR) */
  rfNoiseFloor = -98;
  /** emergent detection radius at the drone's current frequency, m */
  detectionRange = 0;
  events: SimEvent[] = [];
  trails = new Map<EntityId | 'estimate', WorldPos[]>();

  recording: ReplayFrame[] = [];
  replayTime = 0;
  replayPlaying = false;

  private baseline!: ScenarioDoc;
  private replaySnapshot: LiveSimulationSnapshot | null = null;
  private recordAcc = 0;
  private prevDetecting: Record<ScoutId, boolean> = { A: false, B: false, C: false };
  private changeListeners = new Set<() => void>();
  private structureListeners = new Set<() => void>();

  constructor(
    private rf: RfModel,
    scenario: ScenarioDoc,
  ) {
    this.loadScenario(scenario);
  }

  // ------------------------------------------------------------ listeners
  onChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }
  onStructure(fn: () => void): () => void {
    this.structureListeners.add(fn);
    return () => this.structureListeners.delete(fn);
  }
  private emitChange(): void {
    this.changeListeners.forEach((f) => f());
  }
  private emitStructure(): void {
    this.structureListeners.forEach((f) => f());
    this.emitChange();
  }

  log(msg: string, kind: SimEvent['kind'] = 'info'): void {
    this.events.push({ t: this.simTime, msg, kind });
    if (this.events.length > 250) this.events.splice(0, this.events.length - 250);
  }

  // ------------------------------------------------------------- scenario
  loadScenario(doc: ScenarioDoc): void {
    this.baseline = JSON.parse(JSON.stringify(doc)) as ScenarioDoc;
    this.applyScenario(doc);
  }

  private applyScenario(doc: ScenarioDoc): void {
    this.drone = {
      id: 'drone-1',
      name: '드론-1',
      pos: { ...doc.drone.home },
      heading: 0,
      home: { ...doc.drone.home },
      waypoints: doc.drone.waypoints.map((w) => ({ ...w })),
      nextWpId: null,
      flightMode: 'IDLE',
      speedOverride: null,
      altOverride: null,
      loiterCenter: null,
      loiterAngle: 0,
      visible: true,
      freqHz: doc.drone.freqHz ?? 2.45e9,
    };
    this.scouts = doc.scouts.map((s) => ({
      id: s.id,
      name: `스카우트 ${s.id}`,
      pos: { ...s.pos },
      heading: 0,
      waypoints: s.waypoints.map((w) => ({ ...w })),
      nextWpId: null,
      receiverOn: s.receiverOn,
      visible: true,
      rssi: null,
      confidence: 0,
      detecting: false,
    }));
    this.simTime = 0;
    this.mode = 'edit';
    this.estimate = { available: false, pos: { x: 0, y: 0, alt: 0 }, uncertainty: 0, confidence: 0, staleFor: 0 };
    this.status = 'SEARCHING';
    this.events = [];
    this.trails = new Map();
    this.recording = [];
    this.recordAcc = 0;
    this.replayTime = 0;
    this.replayPlaying = false;
    this.replaySnapshot = null;
    this.prevDetecting = { A: false, B: false, C: false };
    this.rf.reset();
    this.primeRfReadouts();
    this.log('시나리오 로드됨');
    this.emitStructure();
  }

  serialize(): ScenarioDoc {
    return {
      version: 1,
      name: 'scenario',
      drone: {
        home: { ...this.drone.home },
        waypoints: this.drone.waypoints.map((w) => ({ ...w })),
        freqHz: this.drone.freqHz,
      },
      scouts: this.scouts.map((s) => ({
        id: s.id,
        pos: { ...s.pos },
        waypoints: s.waypoints.map((w) => ({ ...w })),
        receiverOn: s.receiverOn,
      })),
    };
  }

  reset(): void {
    this.applyScenario(this.baseline);
  }

  // ------------------------------------------------------------- commands
  setMode(mode: SimMode): void {
    if (mode === this.mode) return;
    if (mode === 'replay' && this.recording.length === 0) return;

    if (this.mode === 'replay') {
      this.restoreLiveSimulation();
    }

    if (mode === 'run' && this.mode !== 'pause') {
      // fresh run: launch the mission if the drone has a route
      if (this.drone.flightMode === 'IDLE' && this.drone.waypoints.length > 0) {
        this.drone.flightMode = 'MISSION';
        this.drone.nextWpId = this.drone.waypoints[0].id;
        this.log('임무 시작', 'info');
      }
    }
    if (mode === 'replay') this.snapshotLiveSimulation();
    this.mode = mode;
    if (mode === 'replay') {
      this.replayTime = 0;
      this.replayPlaying = true;
      this.applyReplayFrame(0);
    }
    this.log(`모드 → ${SIM_MODE_KO[mode]}`);
    this.emitStructure();
  }

  private snapshotLiveSimulation(): void {
    this.replaySnapshot = {
      mode: this.mode,
      simTime: this.simTime,
      drone: {
        pos: { ...this.drone.pos },
        heading: this.drone.heading,
        nextWpId: this.drone.nextWpId,
        flightMode: this.drone.flightMode,
        loiterCenter: this.drone.loiterCenter ? { ...this.drone.loiterCenter } : null,
        loiterAngle: this.drone.loiterAngle,
      },
      scouts: this.scouts.map((s) => ({
        id: s.id,
        pos: { ...s.pos },
        heading: s.heading,
        nextWpId: s.nextWpId,
        rssi: s.rssi,
        confidence: s.confidence,
        detecting: s.detecting,
      })),
      estimate: { ...this.estimate, pos: { ...this.estimate.pos } },
      status: this.status,
    };
  }

  private restoreLiveSimulation(): void {
    const snapshot = this.replaySnapshot;
    if (!snapshot) return;

    this.mode = snapshot.mode;
    this.simTime = snapshot.simTime;
    this.drone.pos = { ...snapshot.drone.pos };
    this.drone.heading = snapshot.drone.heading;
    this.drone.nextWpId = snapshot.drone.nextWpId;
    this.drone.flightMode = snapshot.drone.flightMode;
    this.drone.loiterCenter = snapshot.drone.loiterCenter ? { ...snapshot.drone.loiterCenter } : null;
    this.drone.loiterAngle = snapshot.drone.loiterAngle;
    for (const s of this.scouts) {
      const saved = snapshot.scouts.find((candidate) => candidate.id === s.id);
      if (!saved) continue;
      s.pos = { ...saved.pos };
      s.heading = saved.heading;
      s.nextWpId = saved.nextWpId;
      s.rssi = saved.rssi;
      s.confidence = saved.confidence;
      s.detecting = saved.detecting;
    }
    this.estimate = { ...snapshot.estimate, pos: { ...snapshot.estimate.pos } };
    this.status = snapshot.status;
    this.replayPlaying = false;
    this.replaySnapshot = null;
  }

  setSpeedMult(m: number): void {
    this.speedMult = m;
    this.emitChange();
  }

  stepOnce(): void {
    if (this.mode === 'edit' || this.mode === 'pause') {
      const prev = this.mode;
      this.mode = 'run';
      this.advance(0.1);
      this.mode = prev === 'edit' ? 'pause' : prev;
      this.emitChange();
    }
  }

  getEntity(id: EntityId): DroneState | ScoutState {
    if (id === 'drone-1') return this.drone;
    return this.scouts.find((s) => s.id === id)!;
  }

  private newWaypointId(): string {
    const used = new Set<string>();
    for (const entity of [this.drone, ...this.scouts]) {
      entity.waypoints.forEach((waypoint) => used.add(waypoint.id));
    }
    let candidate: string;
    do {
      candidate = `wp-${wpCounter++}`;
    } while (used.has(candidate));
    return candidate;
  }

  addWaypoint(id: EntityId, x: number, y: number, alt?: number, speed?: number): Waypoint {
    const ent = this.getEntity(id);
    const isDrone = id === 'drone-1';
    const last = ent.waypoints[ent.waypoints.length - 1];
    const wp: Waypoint = {
      id: this.newWaypointId(),
      x,
      y,
      alt: alt ?? last?.alt ?? (isDrone ? 60 : 0),
      speed: speed ?? last?.speed ?? (isDrone ? 15 : 2),
    };
    ent.waypoints.push(wp);
    // a running drone whose mission had finished resumes with the new leg
    if (isDrone && this.drone.flightMode === 'MISSION' && this.drone.nextWpId === null) {
      this.drone.nextWpId = wp.id;
    }
    if (!isDrone && ent.nextWpId === null) ent.nextWpId = wp.id;
    this.log(`${ent.name}: 경유지 ${ent.waypoints.length} 추가`);
    this.emitStructure();
    return wp;
  }

  moveWaypoint(id: EntityId, wpId: string, x: number, y: number): void {
    const wp = this.getEntity(id).waypoints.find((w) => w.id === wpId);
    if (!wp) return;
    wp.x = x;
    wp.y = y;
    this.emitChange();
  }

  updateWaypoint(id: EntityId, wpId: string, patch: { alt?: number; speed?: number }): void {
    const wp = this.getEntity(id).waypoints.find((w) => w.id === wpId);
    if (!wp) return;
    if (patch.alt !== undefined) wp.alt = Math.max(0, patch.alt);
    if (patch.speed !== undefined) wp.speed = Math.max(0.2, patch.speed);
    this.emitChange();
  }

  removeWaypoint(id: EntityId, wpId: string): void {
    const ent = this.getEntity(id);
    const idx = ent.waypoints.findIndex((w) => w.id === wpId);
    if (idx < 0) return;
    const wasNext = ent.nextWpId === wpId;
    ent.waypoints.splice(idx, 1);
    if (wasNext) ent.nextWpId = ent.waypoints[idx]?.id ?? ent.waypoints[0]?.id ?? null;
    this.log(`${ent.name}: 경유지 삭제`);
    this.emitStructure();
  }

  reorderWaypoint(id: EntityId, wpId: string, dir: -1 | 1): void {
    const ent = this.getEntity(id);
    const idx = ent.waypoints.findIndex((w) => w.id === wpId);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= ent.waypoints.length) return;
    const [wp] = ent.waypoints.splice(idx, 1);
    ent.waypoints.splice(j, 0, wp);
    this.emitStructure();
  }

  moveEntity(id: EntityId, x: number, y: number): void {
    const ent = this.getEntity(id);
    ent.pos.x = x;
    ent.pos.y = y;
    if (id === 'drone-1' && this.mode === 'edit' && this.drone.flightMode === 'IDLE') {
      this.drone.home = { ...this.drone.pos };
    }
    this.emitChange();
  }

  setFlightMode(mode: FlightMode): void {
    const d = this.drone;
    if (mode === d.flightMode) return;
    d.flightMode = mode;
    if (mode === 'LOITER') {
      d.loiterCenter = { ...d.pos };
      d.loiterAngle = 0;
    }
    if (mode === 'MISSION' && d.nextWpId === null && d.waypoints.length > 0) {
      // resume: fly to the nearest remaining waypoint
      let best: Waypoint | null = null;
      let bestD = Infinity;
      for (const w of d.waypoints) {
        const dd = dist2(d.pos, w);
        if (dd < bestD) {
          bestD = dd;
          best = w;
        }
      }
      d.nextWpId = best?.id ?? null;
    }
    this.log(`${this.drone.name}: ${FLIGHT_MODE_KO[mode]}`, mode === 'RTH' ? 'warn' : 'info');
    this.emitChange();
  }

  setOverrides(patch: { speed?: number | null; alt?: number | null }): void {
    if (patch.speed !== undefined) this.drone.speedOverride = patch.speed;
    if (patch.alt !== undefined) this.drone.altOverride = patch.alt;
    this.emitChange();
  }

  /** switch the drone's RF band; higher frequency ⇒ more path loss, shorter detection range */
  setDroneFrequency(freqHz: number): void {
    if (!Number.isFinite(freqHz) || freqHz <= 0 || this.drone.freqHz === freqHz) return;
    this.drone.freqHz = freqHz;
    if (this.mode !== 'run') this.primeRfReadouts();
    this.log(`드론 주파수 → ${(freqHz / 1e9).toFixed(2)} GHz`);
    this.emitChange();
  }

  toggleReceiver(id: ScoutId): void {
    const s = this.scouts.find((q) => q.id === id)!;
    s.receiverOn = !s.receiverOn;
    this.log(`${s.name}: 수신기 ${s.receiverOn ? 'ON' : 'OFF'}`, s.receiverOn ? 'info' : 'warn');
    this.emitChange();
  }

  setVisible(id: EntityId, v: boolean): void {
    this.getEntity(id).visible = v;
    this.emitChange();
  }

  clearWaypoints(id: EntityId): void {
    const ent = this.getEntity(id);
    ent.waypoints = [];
    ent.nextWpId = null;
    if (id === 'drone-1' && this.drone.flightMode === 'MISSION') this.drone.flightMode = 'HOLD';
    this.log(`${ent.name}: 경로 초기화`);
    this.emitStructure();
  }

  // ----------------------------------------------------------------- tick
  tick(dtReal: number): void {
    if (this.mode === 'run') {
      this.advance(Math.min(dtReal, 0.1) * this.speedMult);
      this.emitChange();
    } else if (this.mode === 'replay' && this.replayPlaying) {
      const dur = this.recordingDuration();
      this.replayTime = Math.min(dur, this.replayTime + dtReal * this.speedMult);
      this.applyReplayFrame(this.replayTime);
      if (this.replayTime >= dur) this.replayPlaying = false;
      this.emitChange();
    }
  }

  private advance(dt: number): void {
    this.simTime += dt;
    this.moveDrone(dt);
    for (const s of this.scouts) this.moveScout(s, dt);
    this.updateRf(dt);
    this.sampleTrails();
    this.record(dt);
  }

  private targetOf(ent: DroneState | ScoutState): Waypoint | null {
    if (!ent.nextWpId) return null;
    return ent.waypoints.find((w) => w.id === ent.nextWpId) ?? null;
  }

  private moveTowards(ent: DroneState | ScoutState, tx: number, ty: number, speed: number, dt: number): boolean {
    const dx = tx - ent.pos.x;
    const dy = ty - ent.pos.y;
    const d = Math.hypot(dx, dy);
    const step = speed * dt;
    if (d <= Math.max(1.5, step)) {
      ent.pos.x = tx;
      ent.pos.y = ty;
      return true;
    }
    ent.pos.x += (dx / d) * step;
    ent.pos.y += (dy / d) * step;
    const targetHeading = Math.atan2(dx, dy);
    let diff = targetHeading - ent.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    ent.heading += diff * Math.min(1, dt * 4);
    return false;
  }

  private climbTowards(ent: DroneState, targetAlt: number, dt: number): void {
    const diff = targetAlt - ent.pos.alt;
    const step = DRONE_CLIMB_RATE * dt;
    ent.pos.alt = Math.abs(diff) <= step ? targetAlt : ent.pos.alt + Math.sign(diff) * step;
  }

  private moveDrone(dt: number): void {
    const d = this.drone;
    const speed = d.speedOverride ?? this.targetOf(d)?.speed ?? 15;
    switch (d.flightMode) {
      case 'MISSION': {
        const wp = this.targetOf(d);
        if (!wp) {
          if (d.altOverride !== null) this.climbTowards(d, d.altOverride, dt);
          return;
        }
        const targetAlt = d.altOverride ?? wp.alt;
        this.climbTowards(d, targetAlt, dt);
        const horizontalArrived = this.moveTowards(d, wp.x, wp.y, d.speedOverride ?? wp.speed, dt);
        const altitudeArrived = Math.abs(d.pos.alt - targetAlt) < 0.01;
        if (horizontalArrived && altitudeArrived) {
          d.pos.alt = targetAlt;
          const idx = d.waypoints.findIndex((w) => w.id === wp.id);
          const next = d.waypoints[idx + 1];
          d.nextWpId = next?.id ?? null;
          if (!next) d.flightMode = 'HOLD';
          if (!next) this.log(`${d.name}: 구간 비행 완료 — 정지`, 'info');
        }
        break;
      }
      case 'HOLD':
        if (d.altOverride !== null) this.climbTowards(d, d.altOverride, dt);
        break;
      case 'LOITER': {
        const c = d.loiterCenter ?? d.pos;
        d.loiterAngle += (speed / LOITER_RADIUS) * dt;
        const tx = c.x + Math.cos(d.loiterAngle) * LOITER_RADIUS;
        const ty = c.y + Math.sin(d.loiterAngle) * LOITER_RADIUS;
        this.moveTowards(d, tx, ty, speed, dt);
        if (d.altOverride !== null) this.climbTowards(d, d.altOverride, dt);
        break;
      }
      case 'RTH': {
        this.climbTowards(d, Math.max(40, d.altOverride ?? 40), dt);
        const arrived = this.moveTowards(d, d.home.x, d.home.y, Math.max(speed, 12), dt);
        if (arrived) {
          d.flightMode = 'HOLD';
          this.log(`${d.name}: 복귀 완료 — 정지`, 'info');
        }
        break;
      }
      case 'IDLE':
        break;
    }
  }

  private moveScout(s: ScoutState, dt: number): void {
    if (s.waypoints.length === 0) return;
    if (!s.nextWpId) s.nextWpId = s.waypoints[0].id;
    const wp = this.targetOf(s);
    if (!wp) {
      s.nextWpId = s.waypoints[0]?.id ?? null;
      return;
    }
    const arrived = this.moveTowards(s, wp.x, wp.y, wp.speed, dt);
    if (arrived) {
      const idx = s.waypoints.findIndex((w) => w.id === wp.id);
      s.nextWpId = s.waypoints[(idx + 1) % s.waypoints.length].id; // patrol loop
    }
  }

  /**
   * Refresh the frequency-dependent RF readouts (noise floor, detection radius)
   * without advancing detection — a grounded, zero-dt probe. Lets the panels
   * show the detection range in EDIT mode and right after a band switch, before
   * the sim starts ticking.
   */
  private primeRfReadouts(): void {
    const out = this.rf.update({
      dronePos: this.drone.pos,
      droneAirborne: false,
      scouts: this.scouts.map((s) => ({ id: s.id, pos: s.pos, receiverOn: s.receiverOn })),
      dt: 0,
      time: this.simTime,
      frequencyHz: this.drone.freqHz,
    });
    this.rfNoiseFloor = out.noiseFloorDbm;
    this.detectionRange = out.detectionRangeM;
  }

  private updateRf(dt: number): void {
    const out = this.rf.update({
      dronePos: this.drone.pos,
      droneAirborne: this.drone.flightMode !== 'IDLE' && this.drone.pos.alt > DRONE_AIRBORNE_ALT,
      scouts: this.scouts.map((s) => ({ id: s.id, pos: s.pos, receiverOn: s.receiverOn })),
      dt,
      time: this.simTime,
      frequencyHz: this.drone.freqHz,
    });
    this.rfNoiseFloor = out.noiseFloorDbm;
    this.detectionRange = out.detectionRangeM;
    for (const s of this.scouts) {
      const r = out.perScout[s.id];
      s.rssi = r.rssi;
      s.confidence = r.confidence;
      s.detecting = r.detecting;
      if (r.detecting && !this.prevDetecting[s.id]) this.log(`${s.name}: 신호 탐지`, 'detect');
      if (!r.detecting && this.prevDetecting[s.id]) this.log(`${s.name}: 신호 상실`, 'warn');
      this.prevDetecting[s.id] = r.detecting;
    }
    if (out.status !== this.status) {
      this.log(`융합 상태 → ${FUSION_STATUS_KO[out.status]}`, out.status === 'TRACKING' ? 'detect' : out.status === 'LOST' ? 'warn' : 'info');
    }
    this.estimate = out.estimate;
    this.status = out.status;
  }

  private sampleTrails(): void {
    const push = (key: EntityId | 'estimate', pos: WorldPos): void => {
      let arr = this.trails.get(key);
      if (!arr) {
        arr = [];
        this.trails.set(key, arr);
      }
      const last = arr[arr.length - 1];
      if (!last || Math.hypot(pos.x - last.x, pos.y - last.y, pos.alt - last.alt) > TRAIL_STEP) {
        arr.push({ ...pos });
        if (arr.length > 500) arr.splice(0, arr.length - 500);
      }
    };
    if (this.drone.flightMode !== 'IDLE') push('drone-1', this.drone.pos);
    for (const s of this.scouts) push(s.id, s.pos);
    if (this.estimate.available) push('estimate', this.estimate.pos);
  }

  // --------------------------------------------------------------- replay
  private record(dt: number): void {
    this.recordAcc += dt;
    if (this.recordAcc < RECORD_STEP && this.recording.length > 0) return;
    this.recordAcc = 0;
    this.recording.push({
      t: this.simTime,
      drone: { pos: { ...this.drone.pos }, heading: this.drone.heading },
      scouts: this.scouts.map((s) => ({
        id: s.id,
        pos: { ...s.pos },
        heading: s.heading,
        rssi: s.rssi,
        confidence: s.confidence,
        detecting: s.detecting,
      })),
      estimate: { ...this.estimate, pos: { ...this.estimate.pos } },
      status: this.status,
    });
    if (this.recording.length > 9000) this.recording.splice(0, this.recording.length - 9000);
  }

  recordingDuration(): number {
    if (this.recording.length === 0) return 0;
    return this.recording[this.recording.length - 1].t - this.recording[0].t;
  }

  replaySeek(t: number): void {
    this.replayTime = Math.max(0, Math.min(this.recordingDuration(), t));
    this.applyReplayFrame(this.replayTime);
    this.emitChange();
  }

  setReplayPlaying(p: boolean): void {
    this.replayPlaying = p;
    this.emitChange();
  }

  private applyReplayFrame(t: number): void {
    if (this.recording.length === 0) return;
    const t0 = this.recording[0].t;
    const abs = t0 + t;
    let i = 0;
    while (i < this.recording.length - 2 && this.recording[i + 1].t <= abs) i++;
    const a = this.recording[i];
    const b = this.recording[Math.min(i + 1, this.recording.length - 1)];
    const span = Math.max(1e-6, b.t - a.t);
    const f = Math.max(0, Math.min(1, (abs - a.t) / span));
    const lerp = (p: WorldPos, q: WorldPos): WorldPos => ({
      x: p.x + (q.x - p.x) * f,
      y: p.y + (q.y - p.y) * f,
      alt: p.alt + (q.alt - p.alt) * f,
    });
    this.drone.pos = lerp(a.drone.pos, b.drone.pos);
    this.drone.heading = a.drone.heading;
    for (const s of this.scouts) {
      const sa = a.scouts.find((q) => q.id === s.id)!;
      const sb = b.scouts.find((q) => q.id === s.id)!;
      s.pos = lerp(sa.pos, sb.pos);
      s.heading = sa.heading;
      s.rssi = sa.rssi;
      s.confidence = sa.confidence;
      s.detecting = sa.detecting;
    }
    this.estimate = { ...a.estimate, pos: { ...a.estimate.pos } };
    this.status = a.status;
    this.simTime = abs;
  }
}
