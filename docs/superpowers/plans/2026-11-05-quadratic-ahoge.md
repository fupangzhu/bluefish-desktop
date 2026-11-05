# Quadratic ahoge outline

User requests changing the visible ahoge from degree three to degree two for a cleaner contour. Use a clamped degree-two B-spline with five controls and two interior knots. Preserve root position, root tangent and hooked tip; fit the remaining controls to the approved silhouette. Both boundaries and deformed outlines use the same quadratic basis, with C1 tangent continuity. Export exact SVG Q segments and a matching 2048 PNG.

- [x] Replace cubic basis/derivative/SVG export with the quadratic representation; adapt outline fitting to the reduced number of controls.
- [x] Check tangents, tip closure, material pin, elastic limits, noninverting mesh and release recovery.
- [x] Export matching SVG/PNG and inspect enlarged native contours during rest, pulling and left/right sweeps.
- [x] Synchronize local runtime/assets, reopen the editor and save the changes. No packaging or version bump.

Validation: 137 unit tests passed. Native left/right sweep and grab checks passed at 150/460; native touch regression passed with no renderer errors. Enlarged rest and pulled contours inspected. Exact six-Q SVG, matching 2048 PNG, rig bounds and reconstructed image exported. Live desktop and editor restarted; no packaging or version bump.
