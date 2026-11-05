# Animation editor, runtime-only distribution and clean eyelids

User requirements: a single hand rubs one eye while the other rests; developer editor can preview small animations directly; future Windows installation/portable packages exclude the editor; right-click removes expression buttons and editor entry, retaining size/follow/idle/dock plus hide/quit. Preserve keyboard reset-position.

New visual bug: face.png contains striped row-interpolated skin under both eye cutouts. Repair that inferred backing continuously without changing its alpha or source coordinates. Remove skin matte from eye cutout fringes. Render all eyelid openness values with one curved mask and one continuously moving lid stroke, keeping the iris in place. Do not swap open/closed textures at a threshold. Inspect full head and isolated eye frames, not only controller values.

Use one random draw per wake; derive a stable left/right rubbing hand from it. Editor offers deterministic normal wake, left/right rub, peek/resleep, sleep, ear twitches, hair drift, and breath with playback/seek/speed. It uses the shared motion engine.

Runtime packaging uses an explicit file manifest and a server mode that denies editor routes even after upgrading an old install. Editor runs from source as a separate development window. The installed directory is reconciled against the runtime payload so old editor files do not survive. Keep settings and process artifacts on D:. Latest user instruction: no packaging or version bump this iteration; synchronize the runtime files directly.
