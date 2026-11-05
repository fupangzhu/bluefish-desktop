# Side-glance eye refinement

User-approved direction: use a highlight-free ellipse cut flat by the upper lid for both side glances; make every eyelid/closed-eye stroke 1.5 times its previous width. No packaging or version bump.

The previous side glance combined a narrowed iris PNG with a parabolic lens mask. Its two curved boundaries made a triangular fragment. Keep the normal continuous closure, but blend the side expression toward an analytic half ellipse with a blue gradient and no white highlight. Keep its entire width beneath the fixed upper lid, move it horizontally, and taper only with the ellipse's own rounded boundary. Bind the same result in editor and desktop.

- [x] Replace the side-glance iris/lower boundary with the analytic clipped ellipse; keep normal eyes unchanged.
- [x] Increase standard strokes 10 → 15 and pain strokes 18 → 27; regenerate half/closed PNG strokes on the original 2048 grid.
- [x] Inspect both glance directions, transitional frames and closed-eye lines in native Electron.
- [x] Synchronize local runtime and reopen the editor at the corrected side-glance preview. No EXE/ZIP build.

Validation: 12 targeted logic tests passed; native rendering passed both sides/directions in 150/460 docked/free modes. Four isolated eye/direction combinations contained no white highlight pixels, kept rounded interior samples opaque and exterior samples transparent. Full closure and transitional frames passed inspection. Local desktop and source editor restarted with updated runtime/assets; no packaging.
