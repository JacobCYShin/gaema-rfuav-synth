# Drone RF Detection Simulator

**Interactive Scenario Editor + Real-time Simulator** — 듀얼 렌더러 구조.

- 기본: **PlayCanvas** 스타일라이즈드 3D 현장뷰 (걷는 운용자, 쿼드콥터 기체, 시설 환경)
- `?renderer=cesium`: **Cesium** 지리좌표 지도뷰
- 두 렌더러 모두 동일한 시뮬레이션 엔진(`src/sim/engine.ts`)을 구독하며,
  이동 계산은 엔진에서만 수행됩니다. 좌측 패널 하단 링크로 전환할 수 있습니다.
사용자가 드론·Scout·경로를 직접 배치/편집하고, 실행 중에도 경로와 조건을
바꿀 수 있으며, Mock RF 모델이 거리 기반 RSSI / Confidence / 추정 위치 /
불확실성 반경을 실시간 갱신합니다. 외부 API 키·유료 에셋 없이 완전 오프라인으로 동작합니다.

## 실행

요구 환경: **Node.js 22 이상**, npm 10 이상. 영상 재생성에는 `ffmpeg`가 추가로 필요합니다.

```bash
npm ci
npx playwright install chromium  # 자동 검증/영상 녹화용 (최초 1회)
npm run dev      # http://localhost:5173
npm run build    # 타입체크 + 프로덕션 빌드
npm run preview  # 빌드 결과 서빙 (http://localhost:4180)
npm run verify   # 최신 빌드 + Playwright 25개 상호작용 검증 + 스크린샷
npm run record   # 78초 데모 시나리오를 media/simulation-demo.mp4로 녹화
```

상세한 조작·활용 방법은 **[USAGE.md](USAGE.md)** 를 참고하세요.
데모 영상: [media/simulation-demo.mp4](media/simulation-demo.mp4)

## 조작

| 조작 | 기능 |
|---|---|
| 아이콘 클릭 | 드론/Scout 선택 |
| 아이콘·핀 드래그 | 위치/Waypoint 이동 (실행 중에도 가능) |
| 빈 땅 드래그 (선택 상태) | 선택한 객체를 그 지점으로 이동 |
| 지면 더블클릭 | 선택 객체에 Waypoint 추가 |
| 우측 패널 | 고도·속도, HOLD/LOITER/RTH/RESUME, 오버라이드, 순서변경/삭제, Scout 스펙트럼 |
| `Del` / `Esc` | Waypoint 삭제 / 선택 해제 |
| `Space` / `R` | RUN↔PAUSE / RESET |
| `1`–`5` | Tactical / Scout Follow / Drone Follow / Free Camera / Scout 1인칭 |
| 하단 바 | EDIT·RUN·PAUSE·REPLAY, STEP, 배속, 분석 패널(차트+CSV), 간단/고급 모드 |
| 좌측 패널 | 객체 목록·표시 토글, 시나리오 Save/Load/Export/Import |

기본은 필수 컨트롤만 보이는 **간단 모드**이며, 하단 `고급 설정 ▸`으로 전체 UI를
켭니다. `분석` 버튼은 추정 오차·RSSI 시계열·실제 vs 추정 궤적 차트와
`sim_log.csv` 내보내기를 제공합니다 (0.2 s 리플레이 버퍼 재사용).

## 아키텍처

```
src/pc/        PlayCanvas 렌더러 (기본) — 3D 기체/인물 리그, 마커, 카메라 4종
src/site/      두 렌더러가 공유하는 지면 텍스처 페인터
src/sim/       엔진 (순수 TS, 렌더러 독립)
  engine.ts    단일 권위 시뮬레이션 상태 + 명령(command) API + 기록/리플레이
  rf.ts        RfModel 인터페이스 + MockRfModel (교체 가능 모듈)
  scenario.ts  기본 시나리오, localStorage/파일 직렬화
  geo.ts       로컬 ENU(m) ↔ 경위도 변환 (상태는 미터 단위)
src/state/     zustand 브리지 (UI는 명령으로만 상태 변경, 텔레메트리는 10Hz 스로틀)
src/cesium/    Cesium 렌더링 레이어 (엔진 상태를 CallbackProperty로 매 프레임 조회)
src/ui/        전술 HUD 패널 (React)
scripts/verify.mjs  Playwright 25개 상호작용 검증 + 스크린샷 8장
scripts/record.mjs  프레임 단위 결정적 캡처로 데모 mp4 녹화
```

설계 원칙: 시뮬레이션 상태(엔진)와 렌더링 분리, UI는 엔진 명령만 호출,
Mock RF는 `RfModel` 인터페이스 뒤에 격리. 이동 계산은 엔진에서만 수행하므로
PlayCanvas 현장뷰와 Cesium 지도뷰가 같은 엔진을 그대로 구독합니다.

## Mock RF 모델 v2

로그-거리 경로손실 → SNR 탐지(임계 14dB, 유효 반경 ≈770m) → RSSI 역산 거리 →
**가중 다변측량**으로 추정 위치를 계산하고, 거리 잔차 + 기하 패널티로
불확실성 반경을 산출합니다. 실제 물리 모델은 아니지만 실제 파이프라인과
동일한 구조라서 교체 시 시각화 변화가 없습니다.

## Python RF 서버 연결(향후)

`RfModel` 인터페이스( `reset()`, `update(RfInput) → RfOutput` )를 구현하는
`WebSocketRfModel`을 만들어 `src/state/store.ts`의 `new MockRfModel()` 한 줄만
교체하면 됩니다. RfInput/RfOutput은 JSON 직렬화 가능한 순수 데이터입니다.
[gaema-rfuav-synth](https://github.com/JacobCYShin/gaema-rfuav-synth) 같은
RFUAV 스타일 합성 IQ/스펙트로그램 파이프라인을 그대로 서버 뒤에 둘 수 있습니다.

## 참고 저장소

- CesiumGS/cesium-vite-example (Apache-2.0) — Vite에서 Cesium 정적 에셋 복사 및
  `CESIUM_BASE_URL` 설정 패턴만 차용 (vite.config.ts). 코드 복사는 설정 수준.
- sgofferj/tak-webview-cesium, Zguoxu/AeroMind, 0xhav0c/ARGUS — 전술 심볼·
  Polyline Glow·대시보드 구성의 시각적 참고만 하고 코드는 가져오지 않음.
