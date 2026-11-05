# Editor and Runtime Implementation Plan

**Goal:** Clean eye transitions, one-hand rubbing, convenient animation previews and a runtime-only Windows package.

**Architecture:** Repair source backing and alpha with a reproducible asset tool; share curved eyelid geometry between shader and export settings. Wake owns a stable rubbing hand; hands share the same binding helper. A source-only preview controller drives existing Motion. Runtime main/menu and distribution use a strict manifest, with a separate source editor entry.

**Tech Stack:** Python/Pillow/NumPy, JavaScript, Canvas/WebGL, Electron.

**Spec:** docs/superpowers/specs/2026-11-05-editor-runtime-design.md

- [x] Repair inferred face/eye backing; replace hard clipping and sprite swapping with a continuous curved lid; inspect the entire closure range.
- [x] Bind a single rubbing hand per wake and verify the other hand remains at rest.
- [x] Add deterministic, scrubbable previews to the source editor and open it for the user.
- [x] Remove runtime menu animations/editor, restrict served routes and package only runtime files.
- [x] Run unit/native/editor/runtime-file checks, update the installed runtime directly without stale editor files or lost settings. No packaging or version bump, per the latest user instruction.

Validation: 132 logic tests passed. Native eye closure sampled from 1 to 0; source editor timeline, one-hand rubbing in docked/free modes, 150/460 geometry, taskbar/hit testing, tray and reduced runtime menu passed. Runtime routes return 404 for the editor, while the independent source editor returns 200. Local runtime synchronized directly; preferences retained. No EXE/ZIP generated, no version bump.
