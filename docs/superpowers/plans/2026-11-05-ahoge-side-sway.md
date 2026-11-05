# Ahoge left/right sweep

User direction: the ahoge should swing visibly from left to right or right to left. Keep its root fixed and the smooth spline outline intact; rotate the bound strand through the upright position rather than reflecting or squashing the artwork. Keep current low-frequency sleep deadlines and no packaging.

Use a separate normalized side pose from Doze. The original tiny wag remains a secondary motion. Blend side pose through Motion, then rotate around the same root used for rendering, dragging and picking. At full droop the two sides are -115 and +75 degrees, passing smoothly over the head. Preserve the latest side during waking so there is no sudden snap. Add two deterministic 7.2-second editor previews; retain the old hair preview name as an alias.

- [x] Add smooth side pose to Doze and Motion, and apply a shared root-angle helper in Renderer.
- [x] Add left→right/right→left previews and verify both endpoints, continuity, fixed root and no clipping.
- [x] Run relevant unit and native tests, synchronize runtime, reopen editor at the new preview. No packaging.

Validation: the full 135-test suite passed, followed by the added wake-continuity test. Native 150/460 previews verified both directions, fixed root, unclipped outline, grab alignment and stretch limits; source editor and docked/free one-hand rubbing passed. Updated local runtime and opened editor at hair_ltr; no packaging or version bump.
