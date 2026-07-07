# RFUAV Repo / 논문 / 데이터 분석 보고서

- 작성일: 2026-07-07
- 대상: [RFUAV GitHub repo](https://github.com/kitoweeknd/RFUAV) (commit `df72bea`, `external/RFUAV`에 shallow clone),
  논문 [RFUAV: A Benchmark Dataset for Unmanned Aerial Vehicle Detection and Identification (arXiv:2503.09033)](https://arxiv.org/abs/2503.09033),
  데이터 [Hugging Face `kitofrank/RFUAV`](https://huggingface.co/datasets/kitofrank/RFUAV)
- 목적: GAEMA-1 synthetic IQ/STFT 데이터 생성 하네스(`gaema-rfuav-synth`) 설계의 근거 자료

---

## 1. RFUAV repo 구조

```
RFUAV/
  train.py / inference.py / benchmark.py   # 학습/추론/벤치마크 엔트리포인트
  graphic/
    RawDataProcessor.py     # ★ raw IQ → STFT spectrogram 이미지 (Python 메인 파이프라인)
    waterfull.py            # waterfall (스크롤형) spectrogram
    Draw.m / Draw_Comprehension.m / stft3D.m   # MATLAB 이미지 생성 (공개 ImageSet은 이 경로로 생성)
  SNREstimation/
    SNR_estimation.py       # Welch PSD 기반 SNR 추정 (Python 레퍼런스)
    NoisyData.m + func/     # ★ 실제 벤치마크용 SNR 가변 데이터 생성 (MATLAB)
  tools/
    label_generate.py       # YOLO 라벨 생성 (고정 bbox)
    drone_mixing.py         # 두 드론 IQ 합성 augmentation
    rawdata_crop.m          # 대용량 raw를 0.3 s 단위 .iq로 분할
    random_seg.py           # train/valid 분할
  utils/
    trainer.py / benchmark.py / build.py   # 분류 모델 팩토리·학습·평가
    TwoStagesDetector.py    # YOLO 검출 → CNN 분류 2-stage 파이프라인
    DetModels/yolo/         # YOLOv5 (nc=5)
  configs/*.yaml            # 실험 설정 (ResNet/ViT/Swin/MobileNet, image_size 224/640)
  example/                  # 설정 예시만 있음. 데이터/weight 미포함
```

## 2. Raw IQ 데이터 포맷

| 항목 | 값 | 근거 |
|---|---|---|
| 파일 확장자 | `.iq`, `.dat`, `.bin` | `utils/benchmark.py:44`, `graphic/Draw.m:21-25` |
| dtype | `float32`, I/Q interleaved (`I,Q,I,Q,...`) | `RawDataProcessor.py:121-122` `data[::2] + 1j*data[1::2]` |
| 복소 샘플 크기 | 8 bytes (float32 × 2) | 동상 |
| 샘플레이트 | 100 MS/s 고정 (USRP X310) | 논문·repo 전역 기본값 |
| 중심주파수 | 드론별 2.41–5.80 GHz (RC 계열 ~2.44 GHz, DJI 영상 5.75–5.80 GHz) | 논문 Table 4 |
| 사이드카 | 팩별 `.xml` (CenterFrequency, SampleRate, IFBandwidth, ReferenceSNRLevel 등) | README §3.1 |

## 3. STFT / Spectrogram 파이프라인 (재현 목표)

### 3.1 Python 메인 파이프라인 (`graphic/RawDataProcessor.py`)

| 파라미터 | 값 | 근거 |
|---|---|---|
| 라이브러리 | `scipy.signal.stft` | `:5, :383` |
| nperseg / nfft | `stft_point` = **1024** (배치 변환 기본; show 계열은 2048) | `:98, :31` |
| window | **Hamming** (`windows.hamming(stft_point)`) | `:384` |
| noverlap | 미지정 → scipy 기본 **nperseg//2 (50%)** | `:383` |
| onesided | **False (two-sided)** + `fftshift` (주파수축 중앙 정렬) | `:129-131` |
| 스케일 | `10*log10(|Zxx|)` — vmin/vmax·min-max 정규화 없음 (matplotlib per-frame autoscale) | `:132` |
| colormap | **`jet`** (Python) / MATLAB `Draw.m`은 **parula** 기본, ablation은 parula·hsv·hot·autumn | `:136`, `Draw.m:45` |
| 프레임 길이 | `duration_time=0.1 s` → **10,000,000 복소샘플/이미지** @100 MS/s | `:120` |
| 저장 | axis off, 여백 0, dpi 300 PNG/JPG | `:136-142` |

### 3.2 파생 파이프라인

- **Waterfall** (`waterfull.py`, `TwoStagesDetector.py:125`): FFT 256, **Hann**, overlap 없음, `log10`(×10 아님), jet. 실시간 시각화/2-stage 데모용.
- **MATLAB `Draw.m`** (공개 ImageSet 생성 경로): MATLAB `stft`, FFTLength 1024, 기본 Hann·75% overlap, parula, 8×6 in @300 dpi. 공개 이미지 실측 **1710×1460 JPEG**, full-bleed(축 없음, 가장자리 tick만 미세하게 남음).
- 논문 ablation: STFT point 32–1024 중 **256이 최적**, colormap은 **hot이 최고** (ViT-L-16 OA 58.16%).

### 3.3 모델 입력 전처리

`Resize((image_size, image_size))` + `ToTensor()`만 사용 (mean/std 정규화 없음). image_size는 ResNet 계열 640, ViT/Swin 224 (`configs/*.yaml`, `utils/benchmark.py:288-291`).

## 4. Dataset / Label 포맷

- **분류**: torchvision `ImageFolder` — `Dataset/{train,valid}/<ClassName>/*.jpg`. 실험별 클래스 셋 상이(5/7/23/31종).
- **검출**: YOLO txt (`class cx cy w h`, normalized). 단, `tools/label_generate.py`는 모든 이미지에 **고정 bbox**(0.513, 0.505, 0.775, 0.770)를 재사용 — 신호가 화면의 거의 일정 영역을 차지한다는 가정. 우리 하네스는 synthetic 생성 시 **정확한 시간-주파수 bbox를 계산**해 저장하므로 이보다 개선된 라벨 제공 가능.
- **벤치마크 폴더 구조**: `source/<snr>/<colormap>/<class>/imgs` — SNR×colormap별 평가.
- **drone_mixing.py**: 두 드론 raw IQ를 복소 합산 후 동일 STFT → "동시 존재" 이미지 augmentation.

## 5. SNR 추정·가변 SNR 데이터 생성 (MATLAB이 실제 경로)

1. Welch PSD 기반 신호 대역 탐지 → 신호 대역/인접 잡음 대역 파워 분리
2. `SNR = 10*log10((P_sig − P_noise)/P_noise)` (noise-subtracted, 논문 Appendix D)
3. 목표 SNR(−20…+20 dB, 2 dB step)에 도달할 때까지 복소 AWGN `sqrt(P_n/2)*(randn+1j*randn)`을 이분법으로 보정하며 추가 → 파일 전체에 적용 후 float32 interleaved로 저장

즉, 벤치마크의 저 SNR 데이터 = **실측 고 SNR 원본 + 보정된 합성 AWGN**. 우리 하네스의 SNR 제어와 동일한 철학.

## 6. 논문 핵심 파라미터 (Table 4 요약)

정의: FHSS 제어 신호는 FHSBW(호핑 대역폭)·FHSDT(버스트 지속시간)·FHSDC(듀티 사이클 — **ms 단위 주기값**)·FHSPP(호핑 패턴 주기)로, 영상전송 신호는 VTSBW로 특성화.

전 기종 범위: **FHSBW 2.9–35.12 MHz / FHSDT 0.25–10.73 ms / FHSDC 1.86–30.1 ms / FHSPP ~5–480 ms(일부 무주기) / VTSBW 10–20 MHz(카메라 드론)**

| 드론 | FHSBW (MHz) | VTSBW (MHz) | FHSDT (ms) | FHSDC (ms) | FHSPP (ms) | MF (GHz) |
|---|---|---|---|---|---|---|
| DJI MAVIC3 PRO | 4.78 | 10 | 1.7 | 6 | 60 | 5.8 |
| DJI MINI4 PRO | 6.54 | 10 | 0.404 | 2.5 | 24.048 | 2.45 |
| DJI MINI3 | 3.5 | 10 | 0.56 | 5.96 | 40.01 | 2.47 |
| DJI AVATA2 | 7 | 10 | 0.41 | 2 | 20.6 | 5.77 |
| DJI FPV COMBO | 5 | 10 | 0.64 | 4 | 38.3 | 5.76 |
| FUTABA T14SG | 32 | — | 2.3 | 30.1 | 164.1 | 2.44 |
| Herelink HX4 | 2.96 | 19.136 | 0.52 | 5.16 | 10.09 | 2.42 |
| WFLY ET16S | 35.12 | — | 0.752 | 3.599 | 14.5 | 2.44 |
| SKYDROID H12 | 6.06 | — | 0.25 | 2.969 | 14.381 | 2.47 |
| JUMPER T14 | 8.09 | — | 10.73 | 20.14 | 480 | 2.44 |
| RadioMaster TX16S | 4.59 | — | 9.3 | 19.96 | 무주기 | 2.44 |

주의: 위 표는 arXiv HTML 추출본이므로 개별 셀을 외부 인용할 때는 원문 대조 필요.

벤치마크 요약: 37종(공개 subset 기준 35–37 클래스), −20…+20 dB 전 구간 OA는 50%대 (ViT-L-16 56.4%, hot+STFT256 시 58.16%). **SNR ≥ +10 dB에서 ~99.7%, SNR ≤ −10 dB에서 ~20%로 붕괴** — 승부처는 −10…+5 dB 구간.

## 7. 데이터 확보 방법

- **HF `kitofrank/RFUAV`** (Apache-2.0, 게이팅 없음, 파일 단위 다운로드 가능 확인됨):
  - `ImageSet-AllDrones-MatlabPipeline/{train,valid}/<드론>/` — 실측 spectrogram JPEG(1710×1460, 0.35–1.2 MB/장, 클래스당 400+장). **최소비용 실측 샘플 경로.**
    예: `https://huggingface.co/datasets/kitofrank/RFUAV/resolve/main/ImageSet-AllDrones-MatlabPipeline/train/DJI%20MINI3/DJI%20MINI30.jpg` (다운로드 검증 완료 → `docs/assets/real_sample_dji_mini3.jpg`)
  - 드론별 raw IQ `.rar` (repo 루트): 최소 **YUNZHUO H16.rar 1.216 GB** — raw IQ는 rar 단위로만 배포되어 이보다 작은 실측 IQ는 없음.
  - `ValidationSet_5Drones/`: SNR 등급별 검증셋 (13.6–43.2 GB/개) — V0에서는 제외.
  - 폴더 목록 API: `https://huggingface.co/api/datasets/kitofrank/RFUAV/tree/main/<path>`
- Roboflow 검출 subset: `https://app.roboflow.com/rui-shi/drone-signal-detect-few-shot/models`

## 8. 실측 샘플 관찰 (DJI MINI3, docs/assets/real_sample_dji_mini3.jpg)

- full-bleed parula 계열, x=시간(0.1 s), y=주파수(100 MHz span, fftshift 중앙 정렬)
- 중앙 대역에 규칙적 간격의 짧은 FHSS 제어 버스트 행 (좁은 대역폭 ≈ FHSBW 3.5 MHz ≈ 세로 3.5%)
- 산발적 광대역/협대역 간섭 blob (Wi-Fi/BT로 추정), 배경은 실측 잡음 텍스처
- 상·하단 가장자리에 어두운 밴드(수신기 필터 roll-off) — synthetic에서 재현할 가치 있는 임페어먼트

## 9. 관련 연구 요약 (설계 반영 포인트)

- **CageDroneRF (arXiv:2601.03302)**: IQ 단계 augmentation 툴킷(AWGN SNR 계층화, complex exponential 주파수 이동+bbox wrap-around 재계산, 간섭 IQ 혼합 α∈[0,1]) — 우리 augmentation 설계의 가장 좋은 레퍼런스. YOLOv11n, "whole-burst = one box, 시간 점유율 ≥10%" 라벨 정책.
- **WidebandSig53/TorchSig, 스펙트럼 감지 YOLO 계열**: bbox = (t_start,t_end)×(f_low,f_high)를 YOLO 정규화 좌표로 — 표준 관행.
- **CSRD2025 (arXiv:2508.19552)**: 합성 IQ에 **수신기 임페어먼트(DC offset, IQ imbalance, LNA 비선형)를 확률적으로 주입** — sim-to-real 격차 완화의 핵심.
- **Sim-to-real 경고**: 순수 synthetic만으로 실전 성능을 낸 주요 발표 사례 없음. 지배적 레시피 = 실측 + IQ-domain augmentation. 합성은 보강용(본 프로젝트 방침과 일치).
- **Colormap은 실질 하이퍼파라미터** (RFUAV ablation에서 hot 우세, colormap 편향 연구 존재) — train/deploy 간 colormap·dB 다이내믹레인지 고정 또는 randomize 필요.
- **정규화**: per-image min-max는 프레임 내 간섭에 민감. per-frequency z-score가 광대역 장면에서 더 강건(CageDroneRF).
- 짧은 분석 창(<hop 주기)은 FHSS 무음 구간에서 오탐 유발 — 프레임 길이는 hop 사이클을 덮도록(RFUAV의 0.1 s는 대부분 기종의 FHSPP를 포함).

## 10. 하네스 설계에 대한 시사점

1. **STFT 프리셋 2종**을 config로 노출: `rfuav_repo`(scipy stft·Hamming·1024·50%·two-sided·10log10·jet — 공개 코드 기본)와 `rfuav_paper_best`(256·hot). MATLAB ImageSet과의 육안 비교용으로 parula 렌더 옵션도 유지.
2. dB autoscale이 RFUAV 방식이지만, 학습 재현성을 위해 **고정 다이내믹레인지 옵션**을 병행 제공.
3. fs=100 MS/s·0.1 s 프레임을 기본 유지하되(실측과 픽셀-스케일 호환), IQ 저장 비용(80 MB/frame)을 감안해 **프레임 길이·저장 포맷은 config화**.
4. 수신기 임페어먼트 모듈(DC spike, IQ imbalance, CFO, 위상잡음, edge roll-off)을 channel 단계에 포함 — 실측 morphology 근접의 관건.
5. YOLO 라벨은 RFUAV의 고정 bbox 대신 **생성 파라미터 기반 정밀 bbox**(버스트별 t×f extent)를 계산·저장. 주파수 이동 augmentation 시 bbox 재계산(wrap-around 포함).
