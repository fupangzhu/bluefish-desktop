# Reluctant Wake Implementation Plan

**Goal:** Add a rare dismissive glance on recovery from awake drooping, with deterministic previews.

**Architecture:** Attention owns Reluctance; Motion blends gaze/lids/head shift; Renderer projects the shared pose. Source preview drives production state, while runtime excludes editor files.

**Tech Stack:** JavaScript, WebGL, Electron, Node tests.

**Spec:** docs/superpowers/specs/2026-11-05-reluctant-wake-design.md

## Global Constraints

- No packaging, release or version bump for this iteration.
- Sleeping still requires clicking; existing wake probabilities and retry protection stay intact.
- Use the continuous repaired eyelid shader with no skin cover sprites.

## Tasks

- [x] Add `src/reluctance.mjs` with `update(dt,{droop,active,eligible,enabled,hx,innerSide})` and a pure timeline `sample()`. Chance 0.30, duration 3.6s, cooldown 30s, arm at droop >= 0.85. Return `{active,mix,gx,yaw,roll,shiftX,eyeCap}`.
- [x] Integrate Attention and Motion; freeze ordinary taskbar travel while active, prioritize touch/reduced motion, and project shift through the same rendered/hit-tested vertices.
- [x] Add `snub_l`/`snub_r` preview setup and editor buttons; deterministic pause/seek must reproduce actual runtime poses.
- [x] Verify probability boundaries, fixed direction, suppression while sleeping/dragging, cooldown, both directions, frame-rate consistency and native rendered eye/shift output.
- [x] Finish previous eye/editor checks, update source documentation, synchronize local runtime directly and open the source editor. Do not build release assets.

Validation: probability threshold and one-roll behavior, cooldown, locked direction, frame-rate consistency, sleeping/dragging/follow/reduced exclusions and deterministic seeking passed. Native renderer verified both directions at 150/460 in docked/free modes (8 combinations), plus both editor previews. Live installed runtime and source editor verified independently; settings unchanged. No release packaging.
