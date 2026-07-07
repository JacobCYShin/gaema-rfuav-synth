"""Signal event records emitted by generators, used for bbox labeling."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class SignalEvent:
    """One time-frequency region occupied by a signal component.

    Times are seconds from frame start; frequencies are baseband Hz
    (frame spans [-fs/2, +fs/2) after fftshift).
    """

    t_start: float
    t_end: float
    f_low: float
    f_high: float
    kind: str  # e.g. "fhss_burst", "video_signal", "wifi_burst", "lora_chirp"

    @property
    def duration(self) -> float:
        return self.t_end - self.t_start

    @property
    def bandwidth(self) -> float:
        return self.f_high - self.f_low

    @property
    def f_center(self) -> float:
        return 0.5 * (self.f_low + self.f_high)

    def shifted(self, df: float) -> "SignalEvent":
        return SignalEvent(self.t_start, self.t_end, self.f_low + df, self.f_high + df, self.kind)
