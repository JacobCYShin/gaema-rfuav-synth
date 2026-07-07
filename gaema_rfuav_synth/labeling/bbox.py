"""SignalEvent -> YOLO bbox conversion.

Image convention (matches transform/spectrogram.render_png): x = time
(left->right), y = frequency with +fs/2 at the TOP of the image. YOLO labels
are `class cx cy w h`, normalized to [0,1], y measured downward from the top.

Frequency-shifted events can wrap around the band edge; wrapped events are
split into two boxes (cf. CageDroneRF's wrap-around handling).
"""
from __future__ import annotations

from .taxonomy import det_class_id
from ..signal.events import SignalEvent


def _wrap_split_freq(f_low: float, f_high: float, fs: float) -> list[tuple[float, float]]:
    """Split a frequency interval into pieces inside [-fs/2, fs/2)."""
    lo, hi = -fs / 2.0, fs / 2.0
    span = fs
    width = min(max(f_high - f_low, 0.0), span)
    f_low = ((f_low - lo) % span) + lo  # normalize start into band
    f_high = f_low + width
    if f_high <= hi:
        return [(f_low, f_high)]
    return [(f_low, hi), (lo, lo + (f_high - hi))]


def event_to_yolo(
    event: SignalEvent, duration_s: float, fs: float
) -> list[tuple[int, float, float, float, float]]:
    """Return one or two (class, cx, cy, w, h) rows for the event."""
    rows = []
    t0 = max(event.t_start, 0.0)
    t1 = min(event.t_end, duration_s)
    if t1 <= t0:
        return rows
    cx = (t0 + t1) / 2.0 / duration_s
    w = (t1 - t0) / duration_s
    cls = det_class_id(event.kind)
    for f_low, f_high in _wrap_split_freq(event.f_low, event.f_high, fs):
        f_low = max(f_low, -fs / 2.0)
        f_high = min(f_high, fs / 2.0)
        if f_high <= f_low:
            continue
        fc = (f_low + f_high) / 2.0
        cy = (fs / 2.0 - fc) / fs  # +f at image top
        h = (f_high - f_low) / fs
        rows.append((cls, cx, cy, w, h))
    return rows


def events_to_yolo_lines(events: list[SignalEvent], duration_s: float, fs: float) -> list[str]:
    lines = []
    for ev in events:
        for cls, cx, cy, w, h in event_to_yolo(ev, duration_s, fs):
            lines.append(f"{cls} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
    return lines


def write_yolo_labels(events: list[SignalEvent], duration_s: float, fs: float, path: str) -> None:
    with open(path, "w") as fh:
        fh.write("\n".join(events_to_yolo_lines(events, duration_s, fs)))
        fh.write("\n")
