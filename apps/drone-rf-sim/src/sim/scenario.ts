import type { ScenarioDoc } from './types';

const LS_KEY = 'drone-rf-sim.scenario.v1';
const MAX_WAYPOINTS = 200;
const MAX_IMPORT_BYTES = 2_000_000;

let seq = 1000;
const wid = (): string => `wp-d${seq++}`;

/** starter scenario: 3 scouts with small patrol loops around the facility,
 *  drone parked outside the perimeter with an empty route (user builds it) */
export function defaultScenario(): ScenarioDoc {
  return {
    version: 1,
    name: 'default',
    drone: {
      home: { x: -600, y: -520, alt: 0 },
      waypoints: [],
    },
    scouts: [
      {
        id: 'A',
        pos: { x: -180, y: 40, alt: 0 },
        receiverOn: true,
        waypoints: [
          { id: wid(), x: -180, y: 40, alt: 0, speed: 2 },
          { id: wid(), x: -120, y: 180, alt: 0, speed: 2 },
          { id: wid(), x: -260, y: 150, alt: 0, speed: 2 },
        ],
      },
      {
        id: 'B',
        pos: { x: 170, y: -60, alt: 0 },
        receiverOn: true,
        waypoints: [
          { id: wid(), x: 170, y: -60, alt: 0, speed: 2 },
          { id: wid(), x: 280, y: 60, alt: 0, speed: 2 },
          { id: wid(), x: 120, y: 140, alt: 0, speed: 2 },
        ],
      },
      {
        id: 'C',
        pos: { x: 40, y: -220, alt: 0 },
        receiverOn: true,
        waypoints: [
          { id: wid(), x: 40, y: -220, alt: 0, speed: 2 },
          { id: wid(), x: -140, y: -170, alt: 0, speed: 2 },
          { id: wid(), x: -40, y: -320, alt: 0, speed: 2 },
        ],
      },
    ],
  };
}

export function saveScenarioToStorage(doc: ScenarioDoc): boolean {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function isWorldPos(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.alt) && value.alt >= 0;
}

function isWaypoint(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.alt) &&
    value.alt >= 0 &&
    isFiniteNumber(value.speed) &&
    value.speed > 0
  );
}

function isRoute(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > MAX_WAYPOINTS || !value.every(isWaypoint)) return false;
  const ids = value.map((waypoint) => (waypoint as { id: string }).id);
  return new Set(ids).size === ids.length;
}

export function parseScenarioDoc(value: unknown): ScenarioDoc | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.name !== 'string') return null;
  if (!isRecord(value.drone) || !isWorldPos(value.drone.home) || !isRoute(value.drone.waypoints)) return null;
  if (!Array.isArray(value.scouts) || value.scouts.length !== 3) return null;

  const scoutIds = new Set<string>();
  for (const scout of value.scouts) {
    if (!isRecord(scout) || !['A', 'B', 'C'].includes(String(scout.id))) return null;
    if (scoutIds.has(String(scout.id)) || !isWorldPos(scout.pos) || !isRoute(scout.waypoints)) return null;
    if (typeof scout.receiverOn !== 'boolean') return null;
    scoutIds.add(String(scout.id));
  }
  if (!['A', 'B', 'C'].every((id) => scoutIds.has(id))) return null;

  return value as unknown as ScenarioDoc;
}

export function loadScenarioFromStorage(): ScenarioDoc | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? parseScenarioDoc(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function exportScenarioFile(doc: ScenarioDoc): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'scenario.json';
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function importScenarioFile(): Promise<ScenarioDoc | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      if (file.size > MAX_IMPORT_BYTES) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(parseScenarioDoc(JSON.parse(String(reader.result))));
        } catch {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}
