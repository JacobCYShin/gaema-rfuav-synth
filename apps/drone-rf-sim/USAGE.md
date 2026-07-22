# 사용 설명서 (Usage Guide)

드론 RF 탐지 시뮬레이터의 설치·조작·활용 방법입니다.

## 1. 설치와 실행

```bash
npm ci
npx playwright install chromium   # 자동 검증/영상 녹화용 (최초 1회)
npm run dev                       # 개발 서버 → http://localhost:5173
```

`npm run record`는 시스템에 **ffmpeg**이 설치되어 있어야 합니다
(`sudo apt install ffmpeg` 등).

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 (기본: PlayCanvas 3D 현장뷰) |
| `npm run build` | 타입체크 + 프로덕션 빌드 (`dist/`) |
| `npm run preview` | 빌드 결과 서빙 (http://localhost:4180) |
| `npm run verify` | 최신 빌드 + Playwright 상호작용 검증 25항목 + 스크린샷 8장 |
| `npm run record` | 78초 데모 시나리오를 `media/simulation-demo.mp4`로 녹화 |

뷰 전환: 기본 주소는 **PlayCanvas 3D 현장뷰**, `?renderer=cesium`을 붙이면
**Cesium 지도뷰**입니다. 좌측 패널 하단 버튼으로 페이지 재로딩 없이 전환하며,
Waypoint·선택 상태·임무 진행 상황과 리플레이 기록이 그대로 유지됩니다.

## 2. 화면 구성

```
┌────────────────────────────────────────────────────────┐
│                [상단] 시나리오 시간 · 융합 상태 배지     │
│ [좌측]                                        [우측]    │
│ 객체 목록/선택            3D 지도             선택 객체  │
│ 표시 토글                (드론·Scout·경로·     상세 정보 │
│ 시나리오 저장/로드         추정·불확실성)      Waypoint  │
│                                               RF 융합   │
│ [이벤트 로그]                                 [범례]    │
│        [하단] EDIT·RUN·PAUSE·REPLAY · 배속 · 카메라     │
└────────────────────────────────────────────────────────┘
```

## 3. 마우스 조작

| 조작 | 기능 |
|---|---|
| 아이콘 **클릭** | 드론 / Scout 선택 (우측 패널에 상세 표시) |
| 아이콘 **드래그** | 드론·Scout 위치 이동 — **실행 중에도 가능** |
| 지면 **더블클릭** | 선택된 객체의 경로에 Waypoint 추가 |
| Waypoint 핀 **클릭** | Waypoint 선택 — 편집 패널 열림 (드론: 고도+속도, Scout: 속도) |
| Waypoint 핀 **드래그** | Waypoint 위치 이동 — **실행 중에도 즉시 반영** |
| **휠** | 줌 (자유 카메라에서는 이동 속도) |
| **드래그** (자유 카메라) | 시점 회전 |

## 4. 키보드 조작

| 키 | 기능 |
|---|---|
| `Space` | RUN ↔ PAUSE |
| `R` | 시나리오 리셋 |
| `1` | Tactical Overview (관제 부감) |
| `2` | Scout Follow (선택된 운용자 추적) |
| `3` | Drone Follow (드론 시네마틱) |
| `4` | Free Camera (`WASD` 이동, `Q/E` 승강, 드래그 회전, 휠 속도) |
| `Del` / `Backspace` | 선택된 Waypoint 삭제 |
| `Esc` | 선택 해제 |
| `T` / `U` | 이동 궤적 / 불확실성 표시 토글 |

## 5. 기본 워크플로

1. **배치**: 드론 아이콘을 드래그해 시작 위치(홈)를 정합니다.
   EDIT 모드에서 드론이 IDLE일 때는 홈 마커가 함께 이동합니다.
2. **경로 작성**: 드론을 선택하고 지면을 더블클릭해 Waypoint를 찍습니다.
   우측 패널에서 Waypoint별 **고도(m)·속도(m/s)** 를 입력하고 ↑↓로 순서 변경,
   ✕로 삭제합니다.
3. **실행**: 하단 `RUN`. 드론이 경로를 따라 비행하며 Mock RF가
   RSSI → SNR → 탐지 → 다변측량 추정 → 불확실성 순으로 갱신됩니다.
4. **실행 중 개입**: Waypoint를 끌어 즉시 재경로, `HOLD`(정지 호버) /
   `LOITER`(선회) / `RTH`(홈 복귀) / `RESUME`(임무 재개), 속도·고도 오버라이드,
   Scout 드래그 재배치, Scout별 수신기 On/Off.
5. **기록·리플레이**: RUN 중 자동 기록(REC)됩니다. `PAUSE` 후 `REPLAY`를 누르면
   타임라인 스크럽/재생으로 지난 실행을 검토할 수 있습니다.
6. **저장/로드**: 좌측 `Save/Load`(브라우저 localStorage),
   `Export/Import`(scenario.json 파일).

## 6. 화면 기호 (범례)

| 색 | 의미 |
|---|---|
| 주황 | 드론 실제 위치·궤적·홈 |
| 자주색 다이아몬드 | RF 융합 **추정** 위치 |
| 자주색 반투명 원 | 불확실성 반경 (±m) |
| 주황 점선 | 실제↔추정 오차 벡터 |
| 녹/청/황 | Scout A/B/C (탐지 중이면 지상 펄스 링) |
| 하늘색 실선/핀 | 계획 경로와 Waypoint |
| 회색 | 수신기 Off / 신호 상실 |

융합 상태: `SEARCHING → DETECTED → TRACKING`(2명 이상·고신뢰) /
`LOW CONFIDENCE`(신뢰 저하) / `LOST`(신호 두절 후 추정 노화).

## 7. Mock RF 모델 (v2)

실제 물리 모델의 **자리표시자**이지만 실제 파이프라인과 같은 구조로 계산합니다.

1. 로그-거리 경로손실: `RSSI = -38 − 22·log10(d/10m) + 셰도잉 노이즈`
2. `SNR = RSSI − (-95dBm)`, SNR 14dB(±1.5dB 히스테리시스) + 신뢰도 램프를
   지나면 탐지 확정 → 유효 탐지 반경 ≈ 770m
3. RSSI를 역산해 Scout별 거리 추정
4. 탐지 Scout 수에 따라: 3+ → **가중 최소제곱 다변측량**, 2 → 원 교점(이전 추정에 가까운 해), 1 → 거리 링 위의 점
5. 불확실성 = 거리 잔차 + 기하 패널티(Scout 수) + 신뢰도 항

파라미터는 [src/sim/rf.ts](src/sim/rf.ts) 상단 상수로 모여 있습니다.

## 8. Python RF 모델 연결 (향후)

렌더러·엔진은 `RfModel` 인터페이스만 사용합니다:

```ts
interface RfModel {
  reset(): void;
  update(input: RfInput): RfOutput; // 순수 JSON 데이터
}
```

[gaema-rfuav-synth](https://github.com/JacobCYShin/gaema-rfuav-synth)류의
RFUAV 스타일 합성 신호 파이프라인(IQ → STFT 스펙트로그램 → 탐지)을 Python
서버로 감싸고, `RfInput`(드론/Scout 기하) → `RfOutput`(Scout별 RSSI/신뢰도/탐지 +
융합 추정) 계약으로 WebSocket 응답하게 만들면
[src/state/store.ts](src/state/store.ts)의 `new MockRfModel()` 한 줄 교체로
연결됩니다. SNR 증강(-20~+20dB) 실험도 같은 인터페이스 위에서 가능합니다.

## 9. 데모 영상 재생성

```bash
npm run record
```

`scripts/record.mjs`의 `EVENTS` 배열(스토리보드)과 시나리오 설정을 수정하면
다른 연출의 영상을 만들 수 있습니다. 프레임 단위 결정적 캡처라 느린 환경에서도
결과물은 항상 동일한 실시간 속도(24fps)로 재생됩니다.
