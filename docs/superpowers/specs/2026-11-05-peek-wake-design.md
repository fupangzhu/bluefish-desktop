# Three wake outcomes

Clicking the sleeping character selects one outcome once: 60% normal waking (the existing gentle/stretch/look presets), 25% rub eyes then wake, 15% a brief screen-left ear/eye peek followed by continued sleep. Hovering still cannot wake the pet.

The peek keeps the logical sleep state and body depth unchanged. Only the viewer-left ear rises and viewer-left eye opens slightly; both return to their sleeping pose in about 2.4 seconds. Suppress unrelated ear flicks during that short action. Both desktop and console use the shared Motion pipeline.

A second click during the peek or within 15 seconds after it finishes must choose a real wake (normal or rub eyes), never another peek. Measure the guard using the Attention wall clock. Preserve the choice through animation, clear it on explicit reset, and avoid changing the existing spline hair.

Verify distribution, one draw per click, left/right isolation, uninterrupted sleep, guard boundaries/expiry, repeat clicks during the action, reduced motion, normal wake ordering, and native visual input in docked/free modes. Ship locally as v0.6.9, leaving published v0.6.8 immutable.

User steering: sleep micro-motions were effectively imperceptible at 150px. Use wall time for sleep timers; first single-ear impulse after 20–40 seconds, later 150–300 seconds, 120ms event with an initial visible impulse for slow frames. Keep 20–28-second breathing but target 0.3–1px amplitude across supported sizes. First hair-side bias after 35–65 seconds; later 80–240 seconds. Keep visible pet rendering unthrottled, allow throttling while hidden.
