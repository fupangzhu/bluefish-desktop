# Low ahoge sweep and subtle fringe interaction

Use the lower arc between unchanged endpoints: right 75 degrees, left 245 degrees. Keep the quadratic outline and root. The ahoge stays above every other character layer throughout the lower arc; the user explicitly requires it as the top layer. Add local fringe brushing (0.8% x / 0.3% y max) and pulling (1.8% x / 0.8% y max), pinned roots and damped release. Preserve face dragging and click-only sleep wake.

- [x] Change arc; verify middle stays below root while ahoge remains the last drawn layer.
- [x] Add shared fringe controller/deformation and accurate input in desktop/editor.
- [x] Add preview; verify roots, limits, release and actual pointer input.
- [x] Test, sync local runtime and open editor. No packaging/version bump.

Feature validation completed: 144 logic tests passed; native mouse input passed at 150/460 in docked/free modes, with pinned fringe roots, no window drag and release recovery. Both lower-arc directions passed with ahoge always last. Local runtime loaded the new module (HTTP 200) and top-layer renderer; desktop/editor are running. The user subsequently requested packaging, push and Release update after this feature phase.
