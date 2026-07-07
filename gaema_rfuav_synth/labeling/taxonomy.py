"""Class taxonomy for classification labels and detection box classes.

Deliberately no "drone_confirmed"-style labels: everything is *_like, i.e.
morphology classes, per project policy.
"""
from __future__ import annotations

# frame-level classification classes (folder-per-class, ImageFolder-compatible)
CLASS_NAMES: dict[str, int] = {
    "noise_only": 0,
    "rfuav_fhss_like": 1,
    "rfuav_video_like": 2,
    "rfuav_fhss_video_like": 3,
    "wifi_like": 4,
    "lora_iot_like": 5,
    "mixed_interference": 6,
}

# detection (YOLO) box classes, keyed by SignalEvent.kind
DET_CLASSES: dict[str, int] = {
    "fhss_burst": 0,
    "video_signal": 1,
    "wifi_burst": 2,
    "lora_chirp": 3,
}


def class_id(name: str) -> int:
    return CLASS_NAMES[name]


def det_class_id(kind: str) -> int:
    return DET_CLASSES[kind]
