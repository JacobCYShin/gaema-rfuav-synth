import pytest

from gaema_rfuav_synth.labeling.bbox import event_to_yolo, events_to_yolo_lines
from gaema_rfuav_synth.signal.events import SignalEvent

FS = 100e6
DUR = 0.1


def test_bbox_normalized_and_oriented():
    # burst in the second half of the frame, in the upper (+f) half of the band
    ev = SignalEvent(0.06, 0.08, 20e6, 25e6, "fhss_burst")
    rows = event_to_yolo(ev, DUR, FS)
    assert len(rows) == 1
    cls, cx, cy, w, h = rows[0]
    assert cls == 0
    assert cx == pytest.approx(0.7)
    assert w == pytest.approx(0.2)
    assert h == pytest.approx(0.05)
    assert cy == pytest.approx((50e6 - 22.5e6) / 100e6)  # +f near top -> small cy
    assert 0 <= cy <= 0.5


def test_bbox_clipped_to_frame():
    ev = SignalEvent(-0.01, 0.02, -1e6, 1e6, "video_signal")
    ((cls, cx, cy, w, h),) = event_to_yolo(ev, DUR, FS)
    assert cls == 1
    assert cx == pytest.approx(0.1) and w == pytest.approx(0.2)


def test_bbox_wraps_after_freq_shift():
    ev = SignalEvent(0.0, 0.05, 45e6, 55e6, "wifi_burst")  # crosses +fs/2
    rows = event_to_yolo(ev, DUR, FS)
    assert len(rows) == 2
    total_h = sum(r[4] for r in rows)
    assert total_h == pytest.approx(0.1)


def test_yolo_lines_format():
    ev = SignalEvent(0.0, 0.01, 0.0, 5e6, "lora_chirp")
    (line,) = events_to_yolo_lines([ev], DUR, FS)
    parts = line.split()
    assert parts[0] == "3" and len(parts) == 5
    assert all(0.0 <= float(p) <= 1.0 for p in parts[1:])
