# Hybrid spectrum

Run these commands from the repository root to regenerate the web spectrum
profile and the deterministic IQ-to-STFT hero replay:

```bash
python scripts/export_signal_profile.py
python scripts/export_web_spectrogram.py
```

Both tracks consume
`apps/drone-rf-sim/public/assets/spectro/profile_DJI_MINI3.json`.

- `AUTO` starts with the validated hero replay.
- Drone, scout, receiver, or route edits switch the panel to the profile-driven
  live approximation.
- Six idle seconds return `AUTO` to the hero replay.
- `REAL CAPTURE` and `LIVE` select either source manually.
- Missing hero assets fall back to live; a live rendering error keeps the last
  valid row instead of breaking the application.
