# 물리 전파 모델 (Physical RF Propagation Model)

시뮬레이터의 스카우트별 수신 신호세기(RSSI)와 SNR은 더 이상 임의 상수가 아니라
**링크버짓 기반 물리 모델**([`src/sim/propagation.ts`](../src/sim/propagation.ts))에서
계산됩니다. 이 문서는 각 수식의 근거와 상수 출처, 검증 방법, 그리고
gaema-rfuav-synth 신호 파이프라인과의 접합 계약을 정리합니다.

## 이전(더미) vs 현재(물리)

| | 이전 Mock v2 | 현재 물리 모델 |
|---|---|---|
| 경로손실 | `RSSI = −38 − 22·log10(d/10)` (임의 상수) | Friis + 로그거리 경로손실 |
| 잡음 바닥 | `−95 dBm` (임의) | `−174 dBm/Hz + 10log10(B) + NF` (kTB) |
| 주파수 의존성 | 없음 | 2.45 / 5.8 GHz 반영 |
| 탐지 반경 | `≈770 m` 하드코딩 | 물리에서 **창발** (2.45GHz≈1.3km) |
| 상수 근거 | 없음 | 아래 표 |

## 계산 체인 (모두 dB / dBm)

```
거리 d, 주파수 f
  │
  ├─ 1. 자유공간 경로손실 (Friis)   FSPL = 20·log10(4π·d·f/c)
  ├─ 2. 로그거리 경로손실           PL   = FSPL(d0) + 10·n·log10(d/d0) + Xσ
  ├─ 3. 링크버짓 → RSSI             RSSI = Ptx + Gtx + Grx − PL
  ├─ 4. 열잡음 바닥                 N    = −174 dBm/Hz + 10·log10(B) + NF
  └─ 5. SNR                         SNR  = RSSI − N   ──→ 탐지·다변측량·gaema 입력
```

### 1. 자유공간 경로손실 — Friis 전송식 (1946)
`FSPL(dB) = 20·log10(4π·d·f/c) = 20·log10(d) + 20·log10(f) − 147.55`
전자기파가 거리 제곱에 반비례해 퍼지는 근본 손실. 교과서 축약형
`32.44 + 20log10(d_km) + 20log10(f_MHz)`와 0.01 dB 이내로 일치(검증됨).

### 2. 로그거리 경로손실 — Rappaport §4.9
기준거리 d0까지는 자유공간 손실, 그 이후 10·n dB/decade로 감쇠.
`n`=경로손실지수: 2.0=이상적 자유공간, 2.0~2.7=근-LOS 공대지(드론이 상공에
있어 대부분 가시선), 3~5=도시 NLOS. `Xσ`=로그정규 섀도잉(σ≈4~6dB).

### 3~5. 링크버짓 상수와 출처

| 상수 | 기본값 | 근거 |
|---|---|---|
| Ptx (송신출력) | 20 dBm (100 mW) | DJI OcuSync CE EIRP 상한 |
| Gtx (드론 안테나) | 2 dBi | 근-무지향 whip |
| Grx (스카우트 안테나) | 3 dBi | 핸드헬드 패널/무지향 |
| n (경로손실지수) | 2.2 | 근-LOS 공대지, 경미한 클러터 |
| σ (섀도잉) | 5 dB | Rappaport §4.9.1 전형값 |
| NF (수신 잡음지수) | 6 dB | 소비자 SDR 프런트엔드 |
| B (수신 대역폭) | 10 MHz | OcuSync 채널 점유 |
| f (주파수) | 2.45 / 5.8 GHz | RFUAV Table 4 실측 (paper_params.py) |
| −174 dBm/Hz | 열잡음 PSD | Johnson–Nyquist, kT₀ @ 290 K |

모든 상수는 [`propagation.ts`](../src/sim/propagation.ts)의 `DEFAULT_LINK_BUDGET`에
명명되어 모여 있고 스카우트/드론별로 교체 가능합니다.

## 대표 수치 (2.45 GHz, 평균, 섀도잉 제외)

| 거리 | 경로손실 | RSSI | SNR | 탐지 |
|---:|---:|---:|---:|:--:|
| 100 m | 84.2 dB | −59.2 dBm | 38.7 dB | ✅ |
| 500 m | 99.6 dB | −74.6 dBm | 23.4 dB | ✅ |
| 1000 m | 106.2 dB | −81.2 dBm | 16.7 dB | ✅ |
| 1333 m | 109.0 dB | −84.0 dBm | 14.0 dB | ✅ 경계 |
| 2000 m | 112.9 dB | −87.9 dBm | 10.1 dB | ❌ |

**주파수 대역 효과**: 5.8 GHz는 2.45 GHz보다 `20log10(5.8/2.45)=7.48 dB` 더 손실 →
탐지 반경이 `10^(7.48/22)=2.19배` 축소(1333 m → 609 m). 이론과 수치 일치(검증됨).

## 검증

```bash
npm run verify:propagation   # 물리 코어 16개 수치 검증 (손계산 Friis 대조)
npm run verify:rf            # RF 모델이 링크버짓을 실제로 사용하는지 통합 검증
```

- **verify:propagation** — FSPL·잡음바닥·RSSI·SNR·역변환·탐지반경을
  독립적으로 손계산한 값과 ±0.05 dB 이내 대조.
- **verify:rf** — 알려진 기하에서 `MockRfModel.update()`가 산출한 스카우트별
  RSSI가 `linkBudget(거리)` 예측과 정확히 일치(Δ=0.000 dB)함을 확인.

## gaema-rfuav-synth 접합 계약 (향후 브릿지)

이 모델의 5단계 산출물 **SNR**은 gaema-rfuav-synth의
`add_awgn_at_snr(signal, target_snr_db)` 입력과 정확히 같은 물리량입니다.
따라서 향후 통합 시:

```
드론/스카우트 기하 ──[이 전파 모델]──> 스카우트별 SNR
                                           │
                        ┌──────────────────┘
                        ▼
   gaema add_awgn_at_snr(FHSS 신호, SNR) ──> 현실적 스펙트로그램
                        │
                        ▼
        탐지기(YOLO/ResNet) ──> 스카우트별 탐지·신뢰도
                        │
                        ▼
        [시뮬레이터 다변측량] ──> 위치 추정
```

즉 이 전파 모델은 **"기하 → SNR"** 이라는, gaema에 없던 빠진 조각을 채워
gaema의 **"SNR → 신호형태 → 탐지"** 와 연결하는 물리적 접합부입니다.
`RfModel` 인터페이스(`update(RfInput)→RfOutput`)는 그대로이므로,
[`src/state/store.ts`](../src/state/store.ts)의 `new MockRfModel()`를
`WebSocketRfModel`로 교체하면 Python gaema 서버 뒤에 둘 수 있습니다.
