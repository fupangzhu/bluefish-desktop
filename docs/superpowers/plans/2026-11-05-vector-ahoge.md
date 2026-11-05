# Vector Ahoge Implementation Plan

**Goal:** Replace the thin, distorted ahoge with a code-drawn, tapered curl and bounded elastic drag.

**Architecture:** Keep source-art coordinates and the existing WebGL/head projection. A focused ahoge module supplies a cubic centerline, width profile, SVG, triangle geometry and drag solve. The renderer samples procedural color; picking interpolates the original material coordinates directly.

**Tech Stack:** JavaScript modules, SVG, Canvas, WebGL, Electron.

**Spec:** docs/superpowers/specs/2026-11-05-vector-ahoge-design.md

## Global Constraints

- Preserve the root at (1143.222,503.018) in the 2048 source grid.
- Retain the existing 18% maximum extension and transparent window gutters.
- Keep process files, exports and installation on D:.

## Steps

- [x] Replace `src/ahoge.mjs` with smooth vector geometry and bounded, curl-preserving displacement. Verify root, grip, width, retained hook and release.
- [x] Update `src/renderer.mjs` to draw procedural geometry and use source-vertex interpolation for picking. Export matching SVG/PNG and update `assets/rig.json`.
- [x] Inspect native screenshots of all drag directions, saturation, return-to-rest and sleep. Run existing desktop interaction regressions and logical tests.
- [x] Build the next patch version, verify its packaged files and update the installed app with preferences preserved.

Final drawing contract: both sides use the same clamped cubic B-spline basis (six controls, two interior knots). Every deformed frame is fitted to that same basis with a fixed root/tangent and shared tip. Verify C2 continuity at the knots in both rest and drag poses, material pinning, and positive triangle orientation.

Completed: 107 logical tests, native 150/240/460 docked/free interaction regression and 288 extreme pull poses passed. Inspected the enlarged smooth SVG contour, upward pull and recovered curl; verified SVG/PNG/package consistency and SHA-256 checks. Installed v0.6.8 with saved preferences retained.
