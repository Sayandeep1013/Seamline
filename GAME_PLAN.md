# SEAMLINE — Game Plan & Handoff Document

> **Working title:** *Seamline* (a ball flows "seamlessly" through joins that only exist from where you're looking).
> **Status:** M0 prototype built (L1 playable in a browser). Waiting for the owner's sign-off on feel. This document is the single source of truth.
> **Last updated:** 2026-10-20
> **Purpose of this file:** Paste this whole document into any new AI chat (or hand it to a developer) and they'll have everything needed to continue: concept, rules, math, levels, tech stack, assets, milestones, and open decisions.

---

## 0. How to continue from this document

Paste this file into a new chat and add one of these:

- *"Read this plan. Start Milestone M0 and build the prototype in `D:\Projects\seamline`."*
- Feel, motion, atmosphere and audio research (with code snippets) lives in `research/FEEL_AND_ATMOSPHERE.md`.
- *"Read this plan. I want to change X; update the plan first, then continue."*
- *"Read this plan. We're at milestone Mx; here's what's done: …. Continue."*

Rules for whoever continues:
1. **This document wins.** If code and this plan disagree, fix one of them on purpose and record it in §16 (Decision Log).
2. **Don't add mechanics outside §4** unless the plan is updated first.
3. **Every level must pass the automated solver (§10.4)** before it counts as done.

---

## 1. Origin & context

- **Inspiration:** a YouTube Short, "When the indie game dev says 'I made something simple'" by @WorldGamexMe — https://youtube.com/shorts/Yqk0Lftql8k (25 s, no dialogue).
- **What it shows:** a minimalist 3D scene: mustard-yellow background, a yellow L-shaped structure (tall pillar + floor running off to the right), a small red ball, a release "hook" on top of the pillar and a few loose **star-shaped pieces** (a square with four concave quarter-circle faces). The ball rolls down the pillar and along the floor. The star pieces float near the structure and the ball passes through them **only when they line up with the structure on screen**, even though they aren't physically attached in 3D.
- **The core insight (agreed with the owner):** this is a **perspective puzzle** in the family of *Monument Valley* and *Viewfinder* (one of the owner's favourite games). **What you see is what's real.** If two pieces of track look joined from the camera, the ball treats them as joined. The player's job is to move, rotate and look at pieces until an "impossible" path exists, and then let the ball flow through it.

---

## 2. Evaluation

### 2.1 Verdict
**Promising. About 7.5/10 as an indie premium puzzle concept.** Perspective joins are one of the most loved puzzle mechanics. They create a strong "aha", they look great in 10-second video clips (cheap marketing) and the art can be simple, which keeps the scope manageable.

### 2.2 Comparable games (know them; differentiate from them)
| Game | Year / platform | What it does | Relevance |
|---|---|---|---|
| **echochrome** | 2008, PSP/PS3 | Rotate the camera; paths that overlap on screen are connected. Formal "perspective laws". | **Closest precedent** for the rules. |
| **Monument Valley 1/2/3** | 2014+, mobile | Fixed isometric camera, rotating/sliding parts join impossible paths. Premium, pastel art. | Gold standard for feel, art and pricing. |
| **Hocus** | 2015, mobile | Guide a red cube around impossible figures. | Close visually (red object, impossible geometry). |
| **Viewfinder** | 2023, PC/console | Photos become 3D space; perspective as a tool. | Owner's favourite. Tone and "aha" reference. |
| **Superliminal** | 2019, PC/console | Forced perspective changes object size. | Perspective as mechanic. |
| **Fez** | 2012 | Rotating a 3D world seen as 2D joins platforms. | Camera rotation creating joins. |

### 2.3 Our differentiator
1. **Moving the pieces is the main verb.** Most of these games rotate the camera or the whole level. In Seamline you **pick up loose pieces** (sliders, elbows, the Star) and place them until they line up, exactly like the video.
2. **A ball that rolls on its own.** You set up the path and the ball runs through it. Every solve ends as a satisfying replay you can share.
3. **Strict, fair rules** (§4.3). Every join is exact and on a grid, so the solver can check it and players can learn it. No pixel hunting.

### 2.4 Risks
| Risk | Severity | Mitigation |
|---|---|---|
| Too close to echochrome / Hocus / Monument Valley | Medium | Lead with piece manipulation and the Star. Own art direction (§7). |
| Level design is the real product; making 10+ great levels takes months | High | Fixed grid rules + automated solver (§10.4) + level editor JSON. Start with 10 levels, playtest, then expand. |
| "Aha" turns into "huh?" (players don't understand why the ball crossed) | High | Strong join feedback: glow seam, chime, haptic, slow-mo on the first crossing. Tutorial-first levels 1–3. |
| Ball rendering crosses depth and looks like it clips through geometry | Medium | Render the ball in its own pass on top of the world while crossing a perceptual join (§9.5). |
| Hyper-casual ad monetization damages the mood | Medium | Premium or free-demo + one-time unlock (§12). |
| Cloud build pipeline misconfigured (signing, SDK versions) | Low | **All native builds run in the cloud** (§10.5), never on the owner's PC. Set up CI in M4 with a debug build first, then signing. |

---

## 3. Game pillars
1. **Calm, not twitchy.** No timers and no lives. Failure is a soft rewind.
2. **One "aha" per level.** Every level teaches or twists exactly one idea.
3. **Readable at a glance.** Minimal shapes, three tones per face and a red ball that's always visible.
4. **Fair rules.** If it looks connected and the arrows agree, it is connected. Always.
5. **Every solve is a short film.** The ball's final run is satisfying to watch and easy to share.

---

## 4. Core rules (the "laws" of Seamline)

### 4.1 World
- The world is built on an **integer 3D grid**: `x` right-back, `y` up, `z` left-back.
- The camera is **orthographic, true isometric** (view direction parallel to `(1,1,1)`), never perspective. This is what makes joins exact.
- The camera can be in **4 views** (rotated 90° around `y`) in levels that allow it. View vectors:
  - `v0 = (1,1,1)`, `v1 = (1,1,-1)`, `v2 = (-1,1,-1)`, `v3 = (-1,1,1)`

### 4.2 Track
- **Track segments** describe the **path of the ball's centre**. Geometry is built underneath, offset against the surface normal.
- Segment types:
  - **Straight:** between two grid points along one axis.
  - **Quarter-pipe arc:** radius 1, in an axis plane, turning between two axis directions. The ball rides the **concave** side.
- Every segment **endpoint** has:
  - `p`: position (integer or half-integer grid point)
  - `t`: tangent leaving the segment (unit axis vector)
  - `n`: surface normal, i.e. which side the ball rides on (unit axis vector, perpendicular to `t`)
- Straights are internally split into **unit edges** with nodes at every integer step, so pieces can intercept mid-track (§4.4).
- **No diagonal ramps.** "Downhill" is built from **steps and drops**: vertical (`±y`) straights joined to horizontal ones by arcs, like stairs. Diagonals would break the join rule, because two different 3D diagonals can project to the same screen direction (e.g. `(1,−1,0)` and `(0,−2,−1)` differ by `v0`). Impossible loops still work: a loop whose segments net to `k·v` (e.g. one step each of `−x`, `−y`, `−z` = `−v0`) closes perceptually.

### 4.3 Joins: the central rule
Two endpoints `A` (exit of segment 1) and `B` (entry of segment 2) are **joined** if **all three** hold:
1. **Position:** `A.p − B.p = k · v` for some integer `k`, where `v` is the current view vector.
   - `k = 0` → **physical join** (really touching).
   - `k ≠ 0` → **perceptual join** (only touching on screen).
2. **Direction:** `A.t == B.t` (3D axis vectors equal).
3. **Surface side:** `A.n == B.n`.

**No hidden seams.** A perceptual join must be visible on screen in the view where it's used. Levels may never place geometry that covers a seam that's used. The solver (§9.4) reports any used join whose screen-space seam is covered as a **level error**. This keeps "what you see is real" literally true. (Covered seams as a mechanic are kept for Chapter 2, §13.)

**Why 3D equality works for 2 and 3:** in true isometric projection the six axis directions `±x, ±y, ±z` project to six *distinct* screen directions (a hexagon). So "same direction on screen" ⇔ "same axis in 3D". Joins are pure integer maths and need no screen-space tolerance.

Screen projection for view `v0` (for rendering and debugging only; rules use the integer test above):
```
sx = (x − z) / √2
sy = (2y − x − z) / √6
```
For other views, rotate the world point around `y` by −90°·n first.

### 4.4 Ball movement
- The ball **follows the track graph** at a set speed, eased by direction (faster on `−y` segments, slower on `+y`, but it never stops). It is **not** a rigid-body physics simulation. This keeps it deterministic and solvable.
- **At each node** the ball asks: is there a joined continuation? Priority:
  1. A **movable piece** whose entry tip is joined here (pieces intercept through-track, which is how the Star in the video catches the ball mid-pillar).
  2. A physical continuation.
  3. A perceptual continuation.
- **Crossing a perceptual join** teleports the ball in 3D by `k·v`, so on screen it moves continuously. It's rendered on top while crossing (§9.5).
- **Dead end** (no join, capped end) → the ball bumps softly and **rolls back** the way it came. If it gets back to the start it waits there. No failure screen.
- **Drop end** (open end, marked with a lip; from level 8) → the ball falls straight down **on screen** and lands on the first track surface beneath it on screen (**perspective landing**, §4.6). If there's nothing below, it fades out and respawns at the last rest point.
- **Rest pads** (cradles; from level 6): the ball stops and waits. Tap the ball to continue.
- **Goal:** a **chime bowl**. When the ball reaches it, the level is complete.

### 4.5 Player verbs
| Verb | Input | Applies to | Introduced |
|---|---|---|---|
| **Release** | Tap the hook / ball | Start socket, rest pads | L1 |
| **Slide** | Drag along a dotted rail; snaps to integer stops | Sliders, Stars, platforms | L1 |
| **Rotate** | Tap the piece → 90° about its axis (animated, snaps) | Elbows, half-stars | L2 |
| **Turn the world** | Swipe empty space horizontally → 90° view change (animated) | Levels with `views > 1` | L7 |
| **Undo / Restart / Hint** | HUD buttons | All | L1 |

Locks and safety:
- A piece the ball is **currently on** cannot be moved or rotated (it shakes gently).
- Joins are evaluated **when the ball reaches a node**, so moving things mid-run is allowed and sometimes needed.
- View rotation is blocked while the ball is mid-crossing a perceptual join (crossing is instant, so this is just a guard).

### 4.6 Perspective landing (from L8)
When the ball leaves a drop end at point `P`, it falls along `−y`. It lands on the first track node `S` (scanning downward in screen space) where `S.p = P − d·ŷ + k·v` for some `d > 0`, integer `k`, and `S.n == +y`. Ties go to the node nearest the camera (largest `x+y+z` in view 0).

### 4.7 Piece families
| Piece | Geometry | Behaviour |
|---|---|---|
| **Beam** | Straight block | Fixed or slider. |
| **Elbow** | One quarter-pipe face | Rotatable (4 orientations) and/or slider. |
| **Star** *(signature piece, from the video)* | Square with **four concave quarter-pipe faces**, extruded along one axis | Has 4 tips (N/E/S/W), and each face links two adjacent tips. 4-fold symmetric, so it's **slide-only**. The face used is the one whose normal at the entry tip matches the ball's incoming normal (the ball "stays on its side"). |
| **Half-Star** | Two adjacent concave faces | Rotatable. Gives 4 distinct orientations. |
| **Rest pad** | Cradle on track | Ball stops and waits for a tap. |
| **Hook (start)** | Small lever on top of the start pillar | Tap to release the ball. |
| **Chime bowl (goal)** | Shallow bowl + bell | Win state. |

Star face geometry, with the star centred at the origin and tips at N(0,1), E(1,0), S(0,−1), W(−1,0) in its local plane: face NE is an arc centred at (1,1), radius 1. Entering at N moving −y with normal +x, it exits at E moving +x with normal +y. The other faces mirror this.

---

## 5. Experience flow
1. **Splash** → **Title**: the video-style mustard scene idles, the ball loops through a Star, and "Tap to begin".
2. **Level Select**: Chapter 1 "Mustard" with 10 tiles. Each shows a silhouette when locked and the structure when solved, plus moves vs par.
3. **Level**: the scene fills the screen. HUD: pause, undo, restart and hint (bottom corners, low contrast).
4. **Solve**: the final run plays in slow-mo for the last join, the chime bowl rings, and the structure does a small "unfold" flourish. Then the result card (moves, par, Next).
5. **Settings**: sound, music, haptics, reduce motion, left-handed HUD.
6. **Save**: progress, best moves per level and settings stored on the device.

**Hints**: level 1 shows a pulsing ghost of the correct slide immediately. From level 2, the hint button appears after 45 s idle, and each tap reveals one move of the minimal solution (from the solver).

---

## 6. The first 10 levels (Chapter 1: "Mustard")

Teaching arc: **slide → rotate → Star → multiple pieces → loops → rest pads → camera → landing → combination → finale.**
Each level teaches or twists exactly **one** idea. Par = minimum moves (slides, rotations, view turns and releases after the first), to be confirmed by the solver.

> **About coordinates:** Level 1 is fully specified below as the reference example of the format and maths. Levels 2–10 are specified as design intent: layout, pieces, critical joins, solution, decoys and par. Exact coordinates are authored in M2 in the level editor and **must pass the solver** (§10.4), which also confirms par and checks that there are no unintended shortcuts.

### L1 — "First Sight" *(teaches: slide + perceptual join)*
- **Scene:** a short floor beam with the ball on the start socket. Floating to the right is a second beam carrying the chime bowl, higher up and set back.
- **Pieces:** Beam B (slider on a rail along `z`, 4 stops).
- **Exact data:**
  - Start socket at `(0,0,0)`. Fixed Beam A: `(0,0,0) → (3,0,0)`, `t=+x`, `n=+y`.
  - Slider Beam B: `(4,1,z) → (7,1,z)`, `t=+x`, `n=+y`, rail `z ∈ {−1,0,1,2}`, starts at `z=−1`. Goal bowl at B's far end.
  - Solution `z=1`: `A.end − B.start = (3,0,0) − (4,1,1) = (−1,−1,−1) = −1·v0` ✔, with direction and normal equal ✔.
- **Solution:** drag B to the glowing stop → tap the hook. **Par 1.**
- **Aha:** "It's not touching… but it worked."
- **Feedback:** the seam flashes white when aligned, plus a chime and haptic tick. The first crossing ever plays at 0.4× speed.

### L2 — "Turn" *(teaches: rotate)*
- **Scene:** the ball steps down a short stair onto an Elbow sitting at a corner. Three of its four orientations dump the ball onto dead-end caps, so it rolls back. One orientation turns it onto a beam that perceptually joins the goal ledge (reusing L1's idea).
- **Pieces:** 1 Elbow (rotate only), starting 2 turns away from correct.
- **Solution:** rotate ×2 → release. **Par 2.**
- **Decoy:** one wrong orientation leads onto a long beam that *almost* lines up with the goal but is off by one stop. This teaches that a near miss isn't a join.

### L3 — "The Star" *(teaches: the Star intercepting a falling ball; homage to the video)*
- **Scene:** exactly the video: mustard background, a tall yellow pillar with the hook on top, and a floor running right. The floor visibly starts **too high and too far back** to ever be reached. A Star sits on a vertical rail alongside the pillar.
- **Pieces:** 1 Star (slider, vertical rail, 6 stops).
- **Critical join:** the ball descends the pillar (`t=−y`, `n=+x`). At the stop where the Star's N tip is on the pillar line, it intercepts, the NE face turns the ball to `t=+x, n=+y`, and the E tip **perceptually joins** the high floor (`E.p − floor.start = k·v0`). Only one stop satisfies both.
- **Decoy:** a lower floor that physically connects at the pillar foot leads to a dead end under a ledge.
- **Solution:** slide Star to the correct height → release. **Par 1.**
- **Aha:** the impossible floor was the right one.

### L4 — "Two Sights" *(teaches: chaining multiple pieces; alignment isn't always correct)*
- **Scene:** a zig-zag structure. Start → Slider 1 → fixed mid-ledge → Slider 2 → goal.
- **Pieces:** 2 sliders. Slider 1 has **two** positions that make valid joins: one leads to the mid-ledge, the other to a dead-end loop-back.
- **Solution:** Slider 1 to the *correct* join, Slider 2 aligned → release. **Par 2.**
- **Aha:** "It lit up, but where does it lead?" Players learn to trace the whole path.

### L5 — "Up Is Down" *(teaches: impossible loops; loops are safe)*
- **Scene:** a Penrose-staircase loop of four descending stair flights (steps and drops, §4.2) that perceptually close back on themselves. The ball rolls downhill forever around the loop. The goal sits on a platform that looks *above* the loop.
- **Pieces:** 1 Half-Star in the loop (rotatable). In 3 of its 4 orientations it continues the loop; in 1 it exits the loop onto a ramp that perceptually joins the high goal platform.
- **Solution:** release → while the ball circles, rotate the Half-Star to the exit orientation (no timing pressure; the loop is endless). **Par 2.**
- **Aha:** "It went down the whole time and ended up higher."
- **Note:** this is the first time pieces are changed while the ball runs. The HUD shows a one-time tip: "You can move pieces while the ball rolls."

### L6 — "Hold" *(teaches: rest pads; reusing a piece)*
- **Scene:** the start is on the left, a rest pad in the middle and the goal on the right. One slider must serve **two different joins**: position A carries the ball from start to the rest pad, position B from the rest pad to the goal.
- **Pieces:** 1 slider, 1 rest pad.
- **Solution:** slide to A → release → ball waits on the pad → slide to B → tap ball. **Par 3.**
- **Aha:** one piece, two jobs.

### L7 — "Another Angle" *(teaches: turning the world)*
- **Scene:** looks broken from view 0, with an obvious gap. No movable pieces at first glance. A subtle hint arrow on the background suggests swiping.
- **Mechanic:** the gap is a perceptual join **only in view 1** (`A − B = k·v1`). After crossing, the ball reaches a slider whose correct alignment only works in **view 2**.
- **Solution:** turn to view 1 → release → ball crosses and stops on rest pad → turn to view 2 → slide → tap ball. **Par 4.**
- **Aha:** "The camera is a piece."

### L8 — "Falling Into Place" *(teaches: perspective landing)*
- **Scene:** the ball runs off a lipped drop end into empty space. Far below and far back is a platform on a slider that *can* appear right under the drop point on screen.
- **Mechanic:** §4.6. The ball falls on screen and lands on whatever appears beneath it.
- **Solution:** slide platform under the drop point → release → falls, lands, rolls on → a second drop needs a view turn to line up a fixed platform. **Par 3.**
- **Aha:** "Gravity follows what I see."
- **Safety:** if nothing is beneath, the ball fades and respawns at start (no penalty).

### L9 — "Echo" *(twist: the same piece makes different joins in different views)*
- **Scene:** a compact tower. The ball must pass the **same Star twice**, on different faces.
- **Mechanic:** in view 0 the Star's E tip joins Route A. After a rest pad, a view change makes the *same* Star position join Route B through a different tip. One Half-Star rotation reroutes the second pass.
- **Solution (indicative):** slide Star → release → (ball on pad) rotate Half-Star → turn view → tap ball. **Par 4.**
- **Aha:** a single placement satisfies two realities.

### L10 — "Monument" *(finale: combines everything in three acts)*
- **Scene:** the tallest structure, a mustard tower with a large chime bell at the top. Three visual "floors".
  - **Act 1:** Star intercepts the falling ball (callback to L3) into a Penrose loop (L5).
  - **Act 2:** exit the loop with a Half-Star, then the ball falls and lands perceptually (L8) on a slider platform. Rest pad.
  - **Act 3:** turn the world (L7) so the final ramp perceptually joins the bell platform **above** the start.
- **Pieces:** 1 Star, 1 Half-Star, 1 slider platform, 1 rest pad, views 0–1.
- **Par:** ≈ 6 (solver-confirmed).
- **Ending:** the bell rings, the whole tower rotates slowly through all four views, the background shifts to the next chapter's palette, and "Chapter 2 — coming soon".

### Difficulty curve
| Lvl | New idea | Pieces | Views | Par | Target solve time |
|---|---|---|---|---|---|
| 1 | Slide + perceptual join | 1 | 1 | 1 | < 30 s |
| 2 | Rotate | 1 | 1 | 2 | < 45 s |
| 3 | Star intercept | 1 | 1 | 1 | ~1 min |
| 4 | Chaining / decoy join | 2 | 1 | 2 | ~1.5 min |
| 5 | Impossible loop | 1 | 1 | 2 | ~1.5 min |
| 6 | Rest pad / reuse | 1 + pad | 1 | 3 | ~2 min |
| 7 | Turn the world | 1 + pad | 3 | 4 | ~2.5 min |
| 8 | Perspective landing | 1 | 2 | 3 | ~3 min |
| 9 | Dual-view piece | 2 + pad | 2 | 4 | ~4 min |
| 10 | Finale combo | 3 + pad | 2 | ~6 | ~5 min |

Total first-chapter playtime: about 20–25 minutes.

---

## 7. Art direction

- **Look:** the video's look, refined. Flat, clean, toy-like shapes with soft bevels. No textures.
- **Shading:** custom **three-tone flat shading by face normal**: top face light, left face mid, right face dark. This is what makes isometric read crisply, and it's done in a tiny shader with no real-time lighting cost. Optional soft contact shadow under the ball.
- **Chapter 1 palette ("Mustard")**, from the video:
  - Background `#E3DC4E` → vertical gradient to `#D9CF3A`
  - Structure tones: top `#F7EE5C`, left `#E2CF2A`, right `#BFA81E`
  - Ball `#D3261E` with a specular dot `#FF8A7A`, plus a lighter band or mark in the ball's own geometry so rolling is visible (a fixed specular dot alone doesn't show rotation)
  - Accent / seam glow `#FFFFFF`, rails dotted `#8C7A12` at 50%
  - Chime bowl: off-white `#F4F1E6` with gold rim `#C9A227`
- **Future chapter palettes** (one per chapter, like Monument Valley): "Coral", "Mint", "Dusk".
- **Pieces you can move** get a subtle handle nub and a dotted rail line, so they never look fixed.
- **Typography:** a geometric sans (e.g. *Outfit* or *Manrope*), bundled locally for offline use.
- **Motion:** eased slides (cubic-out, 180 ms per stop), 90° rotations in 250 ms, view turns in 600 ms ease-in-out. **No overshoot or bounce anywhere.** Snaps are critically damped and settle smoothly; view turns end exactly on the isometric angle, with no roll. Puzzle geometry never idles; only decorative elements move (dust motes, background drift, the ball's breathing). "Reduce motion" turns view turns into a 250 ms cross-fade and removes motes and parallax. Full motion, atmosphere and audio spec: `research/FEEL_AND_ATMOSPHERE.md`.

---

## 8. Assets list (all generated by us; no third-party licensing)

| Asset | How it's made | Notes |
|---|---|---|
| Beams, arcs, Star, Half-Star, Elbow, pads, hook, chime bowl | **Procedural geometry in code** (Three.js `ExtrudeGeometry` / `LatheGeometry` from 2D shapes) | Crisp at any resolution, tiny download, editable by parameters. |
| Ball | Sphere + toon shading + specular dot | |
| Three-tone face shader | Custom GLSL | Colours per chapter from the palette. |
| Seam glow, particles on solve | Shader / sprite particles | |
| UI icons (pause, undo, restart, hint, settings, sound) | Hand-written SVG | |
| App icon + splash | SVG → PNG at all required sizes (script) | Red ball crossing a Star on mustard. |
| Sound effects: snap chime, rotate click, roll hum, bump, fall whoosh, bell | **Synthesized with Web Audio** (oscillators, filtered noise, envelopes) | Each snap plays the next note of a pentatonic scale, so solving sounds musical. |
| Music | Generative ambient pad (Web Audio), per chapter key | Optional upgrade later: commissioned or AI-generated track. |
| Store screenshots / trailer | Captured from the game's replay mode | M5. |

---

## 9. Technical design

### 9.1 Stack (recommended)
| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** | Safety for the rule engine and solver. |
| Rendering | **Three.js** with orthographic camera | Exact isometric, procedural geometry, small and fast. |
| Build | **Vite** | Fast dev server; easy to test in a browser. |
| Mobile wrapper | **Capacitor** (Android first, iOS later) | Same code ships as a native app; plugins for haptics, preferences, status bar and splash. |
| Native builds | **GitHub Actions** (cloud). No Android SDK/Java/Xcode on the owner's PC. | Owner's requirement: keep the local system clean. See §10.5. |
| Tests | **Vitest** (rules, solver) + **Playwright** (browser end-to-end) + **Maestro** on a real Android device | Everything can be verified automatically. |
| Storage | Capacitor Preferences (falls back to `localStorage` on web) | Progress and settings. |

**Do we need a game engine?** No. The game needs an orthographic 3D renderer, simple procedural shapes, one custom shader, touch input and deterministic logic. There's **no physics engine, no rigged animation and no imported 3D models**. Three.js provides exactly that rendering layer, and our own `core/` code is the "engine".

**Alternatives considered:**
| Option | Verdict | Why |
|---|---|---|
| **Three.js + Capacitor** | ✅ **Chosen** | One TypeScript codebase for Android + iOS + web. Developed entirely in a browser with Node, so nothing heavy is installed locally. Cloud builds via GitHub Actions. |
| Unity | ❌ | Overkill for this game. Multi-GB editor install (against the owner's no-clutter rule), GUI-driven, hard to automate. |
| Godot 4 | ⚠️ Viable backup | Small and good, but still a local editor. Pick it if WebView performance ever becomes a real problem. |
| Flutter (+ Flame) | ❌ | Built for 2D UI and games. Its 3D support is immature, and the smooth 90° view turns need a real 3D camera. |
| React Native / Expo | ⚠️ Only for EAS | Has no 3D of its own. You'd run Three.js inside it anyway (expo-gl, or the WebView shell in the EAS note below). Use only if EAS is a must. |
| Kotlin + Swift (native) | ❌ | Two codebases with two renderers (OpenGL/Filament + Metal/SceneKit), double the work. Needs Android Studio/Xcode locally. |

The rule engine (§4) is engine-independent pure TypeScript, so porting later is realistic.

**About EAS (Expo Application Services):** EAS Build is made for Expo / React Native projects and doesn't officially build Capacitor apps. With the recommended stack, **GitHub Actions is the build pipeline**. If EAS becomes a must (for example, the owner already uses it for other apps), the fallback is an **Expo app that hosts the same Three.js game bundle in a full-screen WebView** (`react-native-webview`, bundled offline). The game code stays identical, and only the thin native shell changes. Record that switch in §16 if it happens.

### 9.2 Architecture
```
seamline/
  GAME_PLAN.md            ← this file
  package.json, vite.config.ts, capacitor.config.ts
  src/
    core/                 ← pure TS, no rendering (unit-tested)
      grid.ts             vectors, axis enums, view vectors
      track.ts            segments, endpoints, unit-edge graph
      joins.ts            join rule (§4.3) + perspective landing (§4.6)
      ball.ts             deterministic path follower, state machine
      level.ts            level schema, loader, validation
      solver.ts           BFS over piece states → solvable?, par, solution
    render/
      scene.ts            camera, views, view-turn animation
      geometry.ts         procedural meshes for each piece family
      shading.ts          three-tone shader, seam glow
      ballRenderer.ts     ball, overlay pass while crossing
    input/                drag-along-rail, tap-rotate, swipe-to-turn
    audio/                Web Audio synth: sfx + generative music
    ui/                   title, level select, HUD, result card, settings
    app/                  state, save/load, routing
  levels/                 L01.json … L10.json
  tools/
    solve-all.ts          CI check: every level solvable, par matches
    editor/               (M2) in-browser level editor
  tests/                  vitest + playwright
  android/                generated by Capacitor (M4), committed; built only in CI
  .github/workflows/
    ci.yml                every push: lint, unit tests, solve-all, web build
    android.yml           build APK (debug) / AAB (release, signed) → artifacts
```

### 9.3 Level data format (JSON)
```jsonc
{
  "id": "L01",
  "name": "First Sight",
  "palette": "mustard",
  "views": [0],                 // allowed views; [0,1,2,3] means full rotation
  "startView": 0,
  "start": { "p": [0,0,0], "t": "+x", "n": "+y" },
  "goal":  { "pieceId": "B", "end": "far" },
  "fixed": [
    { "id": "A", "type": "straight", "from": [0,0,0], "to": [3,0,0], "n": "+y", "ends": ["start","open"] }
  ],
  "pieces": [
    { "id": "B", "type": "straight", "from": [4,1,0], "to": [7,1,0], "n": "+y",
      "move": { "kind": "slide", "axis": "z", "stops": [-1,0,1,2], "initial": -1 } }
  ],
  "restPads": [],
  "par": 1,
  "hint": [ { "piece": "B", "slideTo": 1 } ]
}
```
Piece movement kinds: `slide` (axis + stops), `rotate` (axis + 4 orientations + initial), or both. Endpoint flags: `open` (joinable), `cap` (dead end, bounce back), `drop` (perspective landing).

### 9.4 Determinism & solver
- Ball simulation is a **pure function** of `(level, piece states, view, ball rest node)` → `outcome` (goal | restPad X | stuck | fell).
- **Solver** = BFS over `(piece states, view, ball rest node)`. Moves are single slides by one stop, rotations, view turns and releases. Outputs: solvable?, minimal move count (par), solution sequence (used for hints), and **all** distinct solutions (to detect unintended shortcuts).
- `npm run solve-all` must pass for every level (runs in CI and before any level counts as done).

### 9.5 Rendering details
- Orthographic camera at distance along `v`; zoom fits the level's bounding box to the screen in portrait.
- **Ball overlay pass:** during a perceptual crossing and while falling, the ball is drawn after the world with depth testing off, so it never appears to clip into geometry. It fades back to the normal pass on reaching its new segment.
- Target **60 fps on mid-range Android (2021+)**, bundle < 5 MB, fully offline, no network permissions.

### 9.6 Input details
- **Slide:** project the drag onto the rail's screen direction, snap to the nearest stop while dragging (with a magnet near stops), and commit on release.
- **Rotate:** tap within the piece's screen footprint; ignore taps that become drags (> 8 px).
- **Turn the world:** horizontal swipe on empty space, > 60 px or a flick.
- Hit areas at least 48 dp. Optional left-handed HUD.

---

## 10. Build, test & environment

### 10.1 Environment (checked 2026-10-20 on the owner's Windows 11 machine)
| Tool | Status |
|---|---|
| Node.js | ✅ v22.19.0 (npm 10.9.3) |
| Git | ✅ 2.51 |
| adb | ✅ at `D:\adb\platform-tools-latest-windows\platform-tools` (lightweight; used only to install CI-built APKs on a phone) |
| Java JDK / Android SDK / Android Studio | 🚫 **Not installed, on purpose. Do not install.** Native builds run in the cloud (§10.5). |
| Mac + Xcode | 🚫 Not needed. iOS builds (later) run on GitHub's macOS runners. |

**Owner's rule:** keep the local PC light. Locally we only need Node + a browser (development and tests) and adb (installing test builds).

### 10.2 Commands (once scaffolded)
```
npm install
npm run dev          # browser dev server
npm test             # vitest: rules + solver
npm run solve-all    # every level solvable, par matches
npm run e2e          # playwright: solve each level via debug API
npm run build && npx cap sync android   # updates the android/ project; no local native build
git push                                # GitHub Actions builds the APK/AAB
adb install -r seamline-debug.apk       # after downloading the CI artifact
```

### 10.3 Testing strategy
1. **Unit:** join rule truth tables (every axis/normal/k combination), Star face selection, landing scan, ball state machine.
2. **Solver:** all levels solvable, par matches the JSON, and no shortcut solutions shorter than intended.
3. **End-to-end (Playwright):** load each level, apply the solver's solution through real input events, and assert the win screen. Screenshot every level for visual review.
4. **Device (Maestro + adb):** install the APK, play L1–L3, check frame rate, haptics and save/resume.
5. **Playtest:** 3–5 people who haven't seen the game. Record where they get stuck. Target: ≥ 80% finish L1–L5 without hints.

### 10.4 Definition of done (per level)
- Passes the solver with the documented par.
- Has no unintended shorter solutions.
- No used perceptual join is covered on screen (§4.3).
- Readable at phone size: joins visible, rails visible, ball never hidden for > 0.3 s.
- Hint sequence works.
- Playtested at least once.

### 10.5 Cloud builds (GitHub Actions; nothing native on the local PC)
- **`ci.yml`** (every push / PR, `ubuntu-latest`): `npm ci` → lint → `npm test` → `npm run solve-all` → `npm run build` → Playwright e2e (headless). Uploads level screenshots as artifacts.
- **`android.yml`** (push to `main`, tags `v*`, manual dispatch, `ubuntu-latest`):
  1. `actions/setup-java` (Temurin 17+) and the runner's preinstalled Android SDK (`android-actions/setup-android` if versions need pinning).
  2. `npm ci && npm run build && npx cap sync android`
  3. `./gradlew assembleDebug` → upload **`seamline-debug.apk`** artifact.
  4. On tags: `./gradlew bundleRelease`, signed with a keystore from **GitHub Secrets** (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) → upload the **AAB**. Later this can publish to the Play Console internal track automatically.
- **iOS (later):** `ios.yml` on `macos-latest` builds and signs with App Store Connect API keys stored in Secrets, and uploads to TestFlight.
- **Testing a build on a phone:** download the APK artifact → `adb install -r` → Maestro smoke flows can run from the PC (Maestro is a small CLI) or in CI on an emulator.
- **Cost note:** GitHub Actions is free for public repos. Private repos on the free plan get a monthly minutes allowance, and macOS minutes count at a higher rate. Android builds take a few minutes each, so cost is fine. Keep iOS builds to tags only.
- **Keystore safety:** the release keystore is generated once, backed up offline by the owner, and only ever stored base64-encoded in GitHub Secrets. Losing it means you can't update the Play Store app.

---

## 11. Milestones
| # | Milestone | Deliverables | Exit check |
|---|---|---|---|
| **M0** | Prototype | Vite + Three.js scaffold, orthographic iso scene, three-tone shader, Beam + slider, join rule, ball follower, **L1 playable in a browser** | The L1 crossing *feels* magical. Owner signs off on feel. |
| **M1** | All mechanics | Elbow / Star / Half-Star, rotate, rest pads, view turns, perspective landing, caps/drops, solver, unit tests | Truth-table tests green; a sandbox level shows each mechanic. |
| **M2** | Ten levels | Level editor, L1–L10 authored as JSON, `solve-all` green, hints | All levels meet the definition of done (§10.4). |
| **M3** | Polish | Title, level select, HUD, result card, settings, save, Web Audio sfx + music, solve flourish, haptics (web fallback) | Full chapter playable start to finish in a browser. |
| **M4** | Android app (cloud-built) | Capacitor Android project, icons/splash, haptics, status bar, back button, **GitHub Actions workflows** (`ci.yml`, `android.yml`), signed AAB via Secrets | APK from CI installs via adb and runs on the owner's phone at 60 fps; Maestro smoke test passes. **No native toolchain installed locally.** |
| **M5** | Store prep | Store listing copy, screenshots and trailer from replay mode, privacy policy (no data collected), Play Console internal testing | Internal test track live. |

---

## 12. Monetization (decision pending; see §15)
- **Option A — Premium:** one price (e.g. $2.99–$4.99), no ads. Fits the genre (Monument Valley precedent) and the calm tone.
- **Option B — Free + unlock (recommended for launch):** Chapter 1 (these 10 levels) free, with a one-time purchase for the rest. Lower barrier, no ads, honest.
- **Option C — Ads:** **not recommended.** They break the mood and the genre's audience dislikes them.
- **Marketing:** post short clips of impossible crossings like the original video. The replay mode in M5 exports them.

---

## 13. Scope guardrails
- **In scope for v1:** Chapter 1 (10 levels), Android, offline, English.
- **Out of scope for v1:** iOS (possible later via GitHub macOS runners, no Mac needed), level sharing, user-generated levels, leaderboards, accounts, analytics SDKs, localisation.
- **Next after v1:** Chapter 2 (new mechanic idea: *perspective absence*, where a gap hidden behind a pillar on screen counts as solid), iOS, and a public level editor.

---

## 14. Glossary
- **Perceptual join:** two track ends that touch on screen (`A−B = k·v`, `k≠0`) with matching direction and surface side.
- **Physical join:** the ends really touch (`k = 0`).
- **View:** one of four 90° camera orientations.
- **Stop:** a snap position on a slider's rail.
- **Rest pad:** a cradle where the ball waits for a tap.
- **Drop end / cap end:** a track end that lets the ball fall / bounces it back.
- **Par:** the minimum number of moves to solve a level (from the solver).

---

## 15. Open decisions (defaults in **bold**; the owner can override)
1. **Name:** **Seamline** (working). Alternatives: *Parallax Run*, *Trompe*, *Sightjoin*. (Note: "Sightline" is already used by an existing VR game.)
2. **Engine:** **TypeScript + Three.js + Capacitor**, or Godot 4.
3. **First platform:** **Android**, or iOS (needs a Mac).
4. **Monetization:** **B (free Chapter 1 + one-time unlock)**, A or C.
5. **Art:** **mustard palette from the video**, or a fresh palette.
6. **Music:** **generative Web Audio**, or a composed/AI-generated track.
7. **Can pieces be moved while the ball rolls?** **Yes** (L5/L6 depend on it).
8. **Build pipeline:** **GitHub Actions + Capacitor**, or EAS (requires the Expo WebView shell, §9.1). Either way, **no local native builds**.
9. **Repo visibility:** **private GitHub repo** (uses the free monthly Actions minutes), or public (unlimited free minutes, but the code is visible).

---

## 16. Decision log
| Date | Decision | Reason |
|---|---|---|
| 2026-10-20 | Concept = perspective-join ball puzzle (Monument Valley / Viewfinder lineage), from the video above. | Owner's vision; strong "aha" + short-video friendly. |
| 2026-10-20 | Orthographic true isometric + integer join rule (§4.3). | Makes joins exact, learnable and solver-checkable. |
| 2026-10-20 | Ball follows a path graph instead of rigid-body physics. | Determinism → solver, hints, fair puzzles. |
| 2026-10-20 | Plan written before any code; build starts at M0 after owner review. | Owner's request. |
| 2026-10-20 | **No Java / Android SDK / Xcode on the local PC.** All native builds in the cloud: GitHub Actions primary, EAS acceptable via the Expo WebView shell. | Owner doesn't want the system clogged up. |
| 2026-10-20 | No diagonal ramps; descent is built from steps and drops (§4.2). L2/L5 reworded. | Diagonals can project to the same screen direction, which would break the fair join rule. |
| 2026-10-20 | Covered seams are banned in v1 levels; the solver flags them (§4.3, §10.4). | Keeps "what you see is real" literally true. |
| 2026-10-20 | No overshoot/bounce in any motion; snaps critically damped (§7). | Owner chose calm; research shows bounce works against it. |
| 2026-10-20 | Project lives in `D:\Projects\seamline` (§0). | Owner's choice. |
| 2026-10-20 | A slide counts as **one move per drag**, whatever the distance. (The solver may still search one stop at a time, but it reports par in drags.) | L1's par of 1 needs a two-stop slide. |
| 2026-10-20 | The end faces of open beam ends are hidden while that end is joined. The ball is drawn on top (no depth test) for about 0.8 tiles either side of a perceptual crossing. | Makes the join look seamless whichever piece is nearer the camera, and stops the ball clipping. |
| 2026-10-20 | M0 built: Vite 8 + TypeScript 7 + three 0.186, core rules with 103 unit tests, L1 playable, seam glow, slow-mo first crossing, synthesised audio, dust motes, hint ghost. | Milestone M0. |
