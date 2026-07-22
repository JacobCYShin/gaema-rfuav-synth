// Korean display labels. Internal state values (FlightMode / FusionStatus /
// SimMode) stay in English so engine logic and serialized scenarios are
// unaffected; these maps are used only when rendering text to the user.
import type { FlightMode, FusionStatus, SimMode } from './sim/types';

export const FLIGHT_MODE_KO: Record<FlightMode, string> = {
  IDLE: '대기',
  MISSION: '임무',
  HOLD: '정지',
  LOITER: '선회',
  RTH: '복귀',
};

export const FUSION_STATUS_KO: Record<FusionStatus, string> = {
  SEARCHING: '탐색 중',
  DETECTED: '탐지됨',
  TRACKING: '추적 중',
  'LOW CONFIDENCE': '신뢰도 낮음',
  LOST: '신호 상실',
};

export const SIM_MODE_KO: Record<SimMode, string> = {
  edit: '편집',
  run: '실행',
  pause: '일시정지',
  replay: '리플레이',
};
