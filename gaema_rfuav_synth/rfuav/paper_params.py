"""Per-drone RF fingerprint parameters from the RFUAV paper (Table 4).

Extracted from the arXiv HTML (2503.09033v2). Values are the paper's
measurements; individual cells should be cross-checked against the PDF before
external publication. FHSDC is a period in ms (not a percentage).

Units: fhsbw/vtsbw MHz, fhsdt/fhsdc/fhspp ms, mf GHz. vtsbw/fhspp may be None
(no video link / no clear pattern period).
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DroneProfile:
    name: str
    fhsbw_mhz: float
    fhsdt_ms: float
    fhsdc_ms: float
    fhspp_ms: float | None
    vtsbw_mhz: float | None
    mf_ghz: float


DRONE_PROFILES: dict[str, DroneProfile] = {
    p.name: p
    for p in [
        DroneProfile("DJI_MAVIC3_PRO", 4.78, 1.7, 6.0, 60.0, 10.0, 5.8),
        DroneProfile("DJI_MINI4_PRO", 6.54, 0.404, 2.5, 24.048, 10.0, 2.45),
        DroneProfile("DJI_MINI3", 3.5, 0.56, 5.96, 40.01, 10.0, 2.47),
        DroneProfile("DJI_AVATA2", 7.0, 0.41, 2.0, 20.6, 10.0, 5.77),
        DroneProfile("DJI_FPV_COMBO", 5.0, 0.64, 4.0, 38.3, 10.0, 5.76),
        DroneProfile("FUTABA_T14SG", 32.0, 2.3, 30.1, 164.1, None, 2.44),
        DroneProfile("HERELINK_HX4", 2.96, 0.52, 5.16, 10.09, 19.136, 2.42),
        DroneProfile("WFLY_ET16S", 35.12, 0.752, 3.599, 14.5, None, 2.44),
        DroneProfile("SKYDROID_H12", 6.06, 0.25, 2.969, 14.381, None, 2.47),
        DroneProfile("JUMPER_T14", 8.09, 10.73, 20.14, 480.0, None, 2.44),
        DroneProfile("RADIOMASTER_TX16S", 4.59, 9.3, 19.96, None, None, 2.44),
    ]
}

# Morphology corrections observed on the real ImageSet frames (V0 estimates).
# The published FUTABA-T14SG frames show short (~0.3-0.5 ms) bursts every
# ~1-2 ms hopping across roughly 80 MHz, which contradicts the arXiv-HTML
# extraction of Table 4 (FHSDT 2.3 / FHSDC 30.1 / FHSBW 32). Where the real
# data disagrees with the extracted table, the real observation wins.
# keys: fhsdt_ms, fhsdc_ms, hop_span_mhz (hop span; burst bw still derives
# from the paper FHSBW).
REAL_INFORMED_OVERRIDES: dict[str, dict] = {
    "FUTABA_T14SG": {"fhsdt_ms": 0.4, "fhsdc_ms": 1.6, "hop_span_mhz": 80.0},
}

# drones used for the V0 real-vs-synthetic comparison; keys of DRONE_PROFILES
V0_COMPARE_DRONES = [
    "DJI_MINI3",
    "DJI_MINI4_PRO",
    "DJI_AVATA2",
    "DJI_MAVIC3_PRO",
    "FUTABA_T14SG",
]

# folder names on the Hugging Face dataset (ImageSet-AllDrones-MatlabPipeline/train/<name>)
HF_FOLDER_NAMES: dict[str, str] = {
    "DJI_MINI3": "DJI MINI3",
    "DJI_MINI4_PRO": "DJI MINI4 PRO",
    "DJI_AVATA2": "DJI AVATA2",
    "DJI_MAVIC3_PRO": "DJI MAVIC3 PRO",
    "DJI_FPV_COMBO": "DJI FPV COMBO",
    "FUTABA_T14SG": "FUTABA-T14SG",
    "HERELINK_HX4": "Herelink-Hx4",
    "WFLY_ET16S": "WFLY ET16S",
    "SKYDROID_H12": "SKYDROID-H12",
    "JUMPER_T14": "JUMPER-T14",
    "RADIOMASTER_TX16S": "RadioMaster TX16S",
}
