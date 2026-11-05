# Sleep and hair implementation plan

Goal: refine sleep, add occasional eye rubbing, repair hair topology and clipping.

Spec: docs/superpowers/specs/2026-11-05-sleep-hair-design.md

- [x] Add a separate long-interval sleep motion controller and tests.
- [x] Add the rare eye-rub preset, hand targets and slow eyelid timeline, with preview support.
- [x] Replace the ahoge rectangular mesh with alpha-derived ribbon geometry and repin the lower root.
- [x] Add transparent render and native-window gutters without changing visible size or dock baseline.
- [x] Run focused geometry/state tests and native visual/interaction regression.
- [x] Build and update the installed desktop pet; retain preferences.

Validated: 103 unit tests; native interaction/wake/petting regressions; 192 extreme pull combinations; alpha coverage 99.86%; native head hit / transparent gutter pass-through; packaged source and SHA-256 checks. Installed locally with the saved size and position preserved.
