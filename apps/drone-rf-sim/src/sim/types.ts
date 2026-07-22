export type ScoutId = 'A' | 'B' | 'C';
export type EntityId = 'drone-1' | ScoutId;

/** local ENU meters from the site origin (x east, y north, alt up) */
export interface WorldPos {
  x: number;
  y: number;
  alt: number;
}

export interface Waypoint {
  id: string;
  x: number;
  y: number;
  alt: number;
  /** m/s along the leg towards this waypoint */
  speed: number;
}

export type FlightMode = 'IDLE' | 'MISSION' | 'HOLD' | 'LOITER' | 'RTH';
export type SimMode = 'edit' | 'run' | 'pause' | 'replay';
export type FusionStatus =
  | 'SEARCHING'
  | 'DETECTED'
  | 'TRACKING'
  | 'LOW CONFIDENCE'
  | 'LOST';

export interface DroneState {
  id: 'drone-1';
  name: string;
  pos: WorldPos;
  heading: number;
  home: WorldPos;
  waypoints: Waypoint[];
  /** id of the waypoint currently being flown to (null = none / mission done) */
  nextWpId: string | null;
  flightMode: FlightMode;
  speedOverride: number | null;
  altOverride: number | null;
  loiterCenter: WorldPos | null;
  loiterAngle: number;
  visible: boolean;
  /** operating carrier frequency of the drone's RF link, Hz (2.45e9 / 5.8e9) */
  freqHz: number;
}

export interface ScoutState {
  id: ScoutId;
  name: string;
  pos: WorldPos;
  heading: number;
  waypoints: Waypoint[];
  nextWpId: string | null;
  receiverOn: boolean;
  visible: boolean;
  // RF telemetry (written by the RF model each tick)
  rssi: number | null;
  confidence: number;
  detecting: boolean;
}

export interface Estimate {
  available: boolean;
  pos: WorldPos;
  uncertainty: number;
  confidence: number;
  /** seconds since the last scout measurement */
  staleFor: number;
}

export interface SimEvent {
  t: number;
  msg: string;
  kind: 'info' | 'detect' | 'warn';
}

export interface ReplayFrame {
  t: number;
  drone: { pos: WorldPos; heading: number };
  scouts: { id: ScoutId; pos: WorldPos; heading: number; rssi: number | null; confidence: number; detecting: boolean }[];
  estimate: Estimate;
  status: FusionStatus;
}

// ---------------------------------------------------------------- RF model
export interface RfScoutInput {
  id: ScoutId;
  pos: WorldPos;
  receiverOn: boolean;
}

export interface RfInput {
  dronePos: WorldPos;
  droneAirborne: boolean;
  scouts: RfScoutInput[];
  dt: number;
  time: number;
  /** drone RF carrier frequency, Hz — sets the path loss (higher = more loss) */
  frequencyHz: number;
}

export interface RfScoutOutput {
  rssi: number | null;
  confidence: number;
  detecting: boolean;
}

export interface RfOutput {
  perScout: Record<ScoutId, RfScoutOutput>;
  estimate: Estimate;
  status: FusionStatus;
  /** receiver thermal-noise floor, dBm — lets the UI derive SNR = RSSI − N */
  noiseFloorDbm: number;
  /** emergent detection radius at the current frequency, m (SNR = threshold) */
  detectionRangeM: number;
}

/**
 * Swappable RF model boundary. MockRfModel implements it today;
 * a WebSocket bridge to a Python RF server can implement the same
 * interface later without touching the engine or any rendering code.
 */
export interface RfModel {
  reset(): void;
  update(input: RfInput): RfOutput;
}

// ------------------------------------------------------------- scenario doc
export interface ScenarioDoc {
  version: 1;
  name: string;
  drone: {
    home: WorldPos;
    waypoints: Waypoint[];
    /** operating frequency, Hz; optional for backward-compat (defaults 2.45e9) */
    freqHz?: number;
  };
  scouts: {
    id: ScoutId;
    pos: WorldPos;
    waypoints: Waypoint[];
    receiverOn: boolean;
  }[];
}
