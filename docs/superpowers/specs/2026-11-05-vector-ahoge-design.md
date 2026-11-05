# Vector ahoge redesign

The user explicitly requested a code/SVG redraw after the PNG-based hair still became a thin rod. Replace that component with a smooth tapered vector hook, preserving its existing source-grid root and blue palette. Use the same mathematical silhouette for the editable SVG, PNG export, WebGL geometry and picking.

The root stays fixed. Drag displacement is distributed with a smooth zero-slope envelope, retains the free-tip hook, and meets resistance before the strand exceeds 18% extension or develops a sharp fold. Thickness remains stable instead of squeezing into a filament. Release recovers the original curl with the existing damped bounce. Existing sleep/wake, gaze, dock position and transparent gutters remain functional.

Verify actual resting, upward/sideways/downward pulls, extreme limits, release and sleep poses. A numerical pin or bounding-box check alone is insufficient; inspect the rendered contour. Build a new version and update the installed app while preserving preferences.

Refinement requested after preview: draw both outer boundaries as clamped cubic B-splines with six controls and two internal knots. Each side must be C2 continuous. Export each side as three exact cubic Bezier segments; remove the multi-knot width interpolation that created undulations. Smooth the deformed material frame with cubic interpolation. Inspect enlarged boundary views as well as small desktop views.
