"""Colormap resolution, including a parula-like map for visual comparison
with RFUAV's published MATLAB-pipeline ImageSet (which uses parula).

The parula-like map is built from hand-picked anchor colors (not MATLAB's
table) - close enough for side-by-side morphology inspection.
"""
from __future__ import annotations

from matplotlib.colors import Colormap, LinearSegmentedColormap
import matplotlib.pyplot as plt

_PARULA_LIKE_ANCHORS = [
    (0.00, (0.208, 0.166, 0.529)),
    (0.25, (0.060, 0.417, 0.867)),
    (0.50, (0.100, 0.678, 0.717)),
    (0.75, (0.660, 0.743, 0.324)),
    (1.00, (0.976, 0.929, 0.196)),
]

_parula_like = LinearSegmentedColormap.from_list("parula_like", _PARULA_LIKE_ANCHORS)


def resolve_colormap(name: str) -> Colormap:
    if name in ("parula", "parula_like"):
        return _parula_like
    return plt.get_cmap(name)
