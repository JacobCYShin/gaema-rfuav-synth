# gaema-rfuav-synth

GAEMA-1 드론 RF 탐지 프로젝트의 **RFUAV-like synthetic IQ/STFT 데이터 생성 하네스** (V0).

[RFUAV 논문](https://arxiv.org/abs/2503.09033)([공식 repo](https://github.com/kitoweeknd/RFUAV), [HF 데이터셋](https://huggingface.co/datasets/kitofrank/RFUAV))의 실측 드론 RF spectrogram morphology를 분석하고, 그 파라미터(FHSBW/FHSDT/FHSDC/FHSPP/VTSBW)를 반영한 **complex IQ 신호를 먼저 생성한 뒤 RFUAV와 동일 계열의 STFT 파이프라인으로 변환**해, 향후 YOLO detection / ResNet·ViT classification 학습에 쓸 수 있는 보강 데이터셋을 만든다.

## 원칙

- Spectrogram 이미지를 직접 그리지 않는다 — 항상 IQ → STFT 경로만 사용.
- Synthetic은 RFUAV 실측의 **대체가 아니라 보강**이다 (sim-to-real gap 유의).
- 모든 샘플은 `(label, drone, snr_db, random_seed)` + configs로 재현 가능.
- 프로토콜 디코딩(OcuSync/DroneID/ELRS 등)·조종자 위치 추정·확정 판정 라벨은 다루지 않는다. 모든 클래스는 `*_like` morphology 클래스다.

## 설치 및 실행

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest tests/ -q                      # 테스트
.venv/bin/python scripts/download_rfuav_sample.py         # 실측 subset (~50MB)
.venv/bin/python scripts/extract_real_features.py         # 실측 morphology 추정
.venv/bin/python scripts/generate_synthetic_iq.py         # synthetic 데이터셋 생성
.venv/bin/python scripts/compare_real_synthetic.py        # real vs synthetic preview + 수치 비교
.venv/bin/python scripts/preview_synthetic_dataset.py     # grid + bbox overlay preview
# 임의 IQ 파일(RFUAV raw 포함) → spectrogram:
.venv/bin/python scripts/make_spectrogram.py path/to/file.iq --fs 100e6
# Fig.8-style STFT sensitivity (real raw IQ / synthetic IQ):
.venv/bin/python scripts/stft_sensitivity.py --iq outputs/raw/xxx.dat --out outputs/stft_sensitivity_real.png
.venv/bin/python scripts/stft_sensitivity.py --synthetic-drone DJI_MINI3 --out outputs/stft_sensitivity_synthetic.png
# specs.json에서 IQ 재생성 (IQ 저장은 기본 off — seed+config로 byte-identical 복원):
.venv/bin/python scripts/regenerate_iq.py <sample_id>
```

개발용 경량 프레임: `--frame-preset dev_light` (25 MS/s, 0.05 s — 기본 `rfuav_full`=100 MS/s, 0.1 s 대비 16배 가벼움).

## 구조

```
configs/               # stft(프리셋 3종)·synthetic(생성 계획)·rfuav(실측 접근)·dataset
gaema_rfuav_synth/
  rfuav/               # 논문 Table 4 파라미터, HF 샘플 로더, 이미지 기반 feature 추정
  signal/              # FHSS/video/interference 생성기, noise, SNR, channel, impairments
  transform/           # RFUAV 재현 STFT, spectrogram 내보내기(PNG/NPY), colormap
  labeling/            # SignalEvent → YOLO bbox(wrap-around 분할), 클래스 taxonomy
  dataset/             # metadata/feature_params 스키마, exporter, ImageFolder splitter
  viz/                 # real-vs-synth 비교, grid preview, bbox overlay
scripts/               # 위 실행 스크립트
tests/                 # pytest
docs/rfuav_repo_analysis.md   # RFUAV repo/논문/데이터 분석 보고서
outputs/               # (gitignore) real_samples/, synthetic_samples/, preview PNG
external/RFUAV         # (gitignore) 참고용 shallow clone
```

## Synthetic 클래스 (7종)

`noise_only(0)`, `rfuav_fhss_like(1)`, `rfuav_video_like(2)`, `rfuav_fhss_video_like(3)`, `wifi_like(4)`, `lora_iot_like(5)`, `mixed_interference(6)`

검출 박스 클래스: `fhss_burst(0)`, `video_signal(1)`, `wifi_burst(2)`, `lora_chirp(3)` — 생성 파라미터에서 버스트별 정밀 time-freq bbox를 계산해 YOLO 포맷으로 저장 (RFUAV 원본의 고정 bbox 방식보다 정밀).

## STFT 프리셋 (configs/stft_config.yaml)

| 프리셋 | 근거 | 설정 |
|---|---|---|
| `rfuav_repo` | 공식 repo `RawDataProcessor.py` 기본 | 1024pt, Hamming, 50% overlap, jet, autoscale |
| `rfuav_paper_best` | 논문 ablation 최적 (기본값) | 256pt, Hamming, 50%, hot, fixed 70dB range |
| `rfuav_matlab_like` | 공개 ImageSet 생성 경로 (비교용) | 1024pt, Hann, 75%, parula-like |

공통: two-sided + fftshift, `10*log10(|Zxx|)`, fs=100 MS/s, 프레임 0.1 s.

## Augmentation

AWGN SNR 제어(-20…+20 dB, 2 dB step), frequency shift(bbox wrap-around 재계산 포함), amplitude fading, burst timing jitter, burst dropout, interference injection(wifi/lora/mixed) + 수신기 임페어먼트(DC spike, IQ imbalance, CFO, phase noise, band-edge roll-off).

## FHSBW 해석 (중요)

논문 Table 4의 FHSBW는 **호핑 전체 span**으로 해석한다. 근거: FUTABA T14SG 실측 이미지의 개별 버스트 폭은 3–4 MHz인데 FHSBW는 32 MHz이고, DJI MINI3의 버스트들은 3.5 MHz(=FHSBW) 안에 머문다. 개별 버스트 폭은 `max(FHSBW/burst_bw_divisor, min(FHSBW, burst_bw_floor_mhz))`로 근사하며 (configs/synthetic_config.yaml), V1에서 실측 feature 추정으로 보정 예정.

## 비교 게이트 (V0)

real-vs-synthetic 비교는 `compare_drones: [DJI_MINI3, FUTABA_T14SG]` 2종으로 먼저 통과시키고, 이후 MINI4 PRO / AVATA2 / MAVIC3 PRO로 확장한다. 산출물: `preview_real_vs_synthetic.png`(육안), `real_vs_synthetic_metrics.csv`(bandwidth/burst duration/hopping interval, paper vs real-est vs synth-est), `real_vs_synthetic_energy_hist.png`(intensity 분포), `stft_sensitivity_{real,synthetic}.png`(Fig.8-style).

## Raw IQ 검증 (완료)

HF의 `FUTABA T14SG.rar`(2.65 GB)를 받아 검증 완료. rar 내부는 1초 단위 `.iq`(800 MB = 100 MS/s × 8 bytes, **interleaved float32**) + `.xml` 사이드카(USRP X310, fs=100 MHz, fc=2.44 GHz, ReferenceSNRLevel 24 dB) — 분석 문서의 포맷 가정과 정확히 일치. `load_raw_iq`/`load_sidecar_xml` → `make_spectrogram.py` → `stft_sensitivity.py`까지 실데이터로 통과. **압축 해제는 `unar` 필요** (`brew install unar`; p7zip은 이 RAR5 방식 미지원).

## Real-informed 파라미터 보정

논문 Table 4 추출값이 실측 morphology와 모순되면 실측이 우선한다 (`rfuav/paper_params.py`의 `REAL_INFORMED_OVERRIDES`). 현재: FUTABA T14SG — 실측은 ~0.3–0.5 ms 버스트가 ~1–2 ms 간격으로 ~80 MHz에 걸쳐 호핑 (추출값 FHSDT 2.3 ms / FHSDC 30.1 ms / FHSBW 32 MHz와 불일치).

## 알려진 V0 한계

- 이미지 기반 feature 추정은 threshold 연결영역 방식이라 저대비 버스트가 조각나 burst duration/bandwidth를 과소추정할 수 있음 (real/synthetic에 동일 적용되므로 상대 비교는 유효).
- 실측 JPEG에서의 SNR 추정치는 intensity-ratio **proxy**임 (colormap+JPEG는 파워 선형이 아님).
- 논문 Table 4 수치는 arXiv HTML 추출본 — 외부 인용 전 원문 대조 필요 (FUTABA 행은 실측과 모순 확인됨).
- synthetic 버스트는 실측 대비 내부 텍스처가 균일하고 배경 잡음 텍스처가 매끈함 — V1에서 실측 배경 mixing으로 개선 예정.
