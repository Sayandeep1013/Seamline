# Seamline: Level Design Guide

Every level is checked against this guide before it ships, and re-checked whenever it changes. A level is
done only when every box in the checklist (§8) is ticked, by the tools and by a person playing it on a phone.

The guide comes from three places: the rules of the game (GAME_PLAN §4), what the owner found playing each
build on a real phone, and what makes the best perspective puzzles (Monument Valley, Fez, Captain Toad,
Viewfinder) feel fair and satisfying.

---

## 1. The promise

> **What you see is what happens.** If it looks solid, the ball can't pass through it. If it looks joined,
> the ball rolls across. If it looks like the answer, it is the answer, and the wrong answers look wrong.

Everything below serves this promise. A level that breaks it, even for one frame, is broken, however clever
the puzzle.

---

## 2. Laws (checked by the tools, no exceptions)

| # | Law | Checked by |
|---|---|---|
| L1 | **Nothing passes through anything.** The ball's sphere never overlaps a solid, measured against the exact triangles that are drawn. | `npm test` (audit) |
| L2 | **The ball is never hidden.** No part of the ball, as drawn, is covered by anything except its own track going round a corner. Knobs, hubs and handles count. | audit |
| L3 | **Every frame is checked:** every release from every reachable state, at 60 fps, including falls. | audit |
| L4 | **Pieces are solid too.** A piece can't be dragged or turned through track, other pieces or the ball, and can't be slid across the ball on screen. The world won't turn to a view that would hide the ball. | `Solidity`, `inView` |
| L5 | **Solvable at par, with a unique shortest solution.** No shortcut the designer didn't intend. | solver (`npm run solve`) |
| L6 | **No climbing.** The ball only goes up on momentum it actually has. Nothing rolls uphill from rest. | momentum model |
| L7 | **No hidden seams.** A join the solution uses is visible on screen in the view where it is used. | audit + review |
| L8 | **Not already solved at the start**, and no position loops forever. | tests |

If the audit fails, the level is not "nearly done": the geometry is lying to the player. Fix the level, not
the audit.

---

## 3. The look test (a person, on a phone)

The tools prove the ball does what the geometry says. Only a person can tell whether the geometry *reads* the
way it behaves. For every level:

1. **The answer looks like the answer.** Put the pieces in the solved arrangement and take a screenshot,
   with no ball run. Show it to someone who hasn't seen the level. They should be able to trace the route
   with a finger, start to bowl, without hesitating at any join. Every join they trace must be a real join:
   the same face, the same direction, the same width, edges meeting edges.
2. **Wrong looks wrong.** Put each piece at every other stop and orientation. Each one should look broken
   before the ball is released (a visible step, gap or misalignment), and fail legibly when it is (the
   ball knocks against the piece, or rolls off and falls away). A wrong position that looks right is a bug.
3. **Watch the ball, frame by frame.** Record the solution and at least two wrong attempts (screen record
   on the phone, or the browser recorder) and step through the frames. The ball never clips, flickers,
   vanishes behind something, or pops from behind to in front.
4. **No hunting.** A player who understands the level's idea should be able to form the right hypothesis by
   looking, then confirm it with one or two tries. If the solution is only found by trying every stop,
   the level is a lock, not a puzzle.

---

## 4. Pieces belong to the place

The owner's rule: a movable piece must never look like a prop that exists only to be dragged. When it's in
place, the player should think *"of course, that's where it goes"*, and then *"oh, that was good"*.

### 4.1 Every piece is part of the building

- **A displaced part, not an extra.** Each movable piece is a recognisable part of the structure's own
  grammar that has been pushed out of place: the missing step of a staircase, the lower half of a broken
  pillar, the corner of a frame, a section of a bridge. Seen at the start, the structure looks incomplete
  in a way the eye wants to fix.
- **Same family.** Pieces share the fixed track's proportions (same width, same slab depth, same curve
  radius) and material. Only the handle cue (handle nub, hub, rail) marks them as movable. A piece that is
  thinner, oddly shaped or a different style reads as foreign.
- **Anchored.** A piece is visibly held by the structure: it slides in a rail fixed to a wall or a column, or
  turns on a hub carried by an arm. A piece floating in empty space with only a dotted line under it is not
  anchored. (Rails and arms are solids: they go through the audit like everything else.)
- **Every visible part has a job.** If a piece has a blade, face or arm the ball never uses and that blocks
  nothing, cut it or give it a job. Ornament that isn't doing anything reads as clutter or as a red
  herring the player didn't deserve.

### 4.2 Every piece does at least two things

A piece earns its place by doing more than "be dragged to the one right spot". At least one of these, as
well as completing the solution:

- **Its start position matters.** It visibly blocks the tempting wrong route, catches the ball somewhere
  useful, or is obviously the broken part of the silhouette.
- **It's used twice.** One piece, two jobs at two different moments (L5 *Hold*: the same beam bridges the
  ball out, then carries it home).
- **Its wrong positions teach.** Each wrong stop leads somewhere legible (a decoy ledge, a knock against a
  wall) that tells the player something true about the level.
- **It changes what else is possible.** Moving it opens one route and closes another, so the order of moves
  matters.

The single exception is a level's very first introduction of a verb (L1 teaches *slide*, L2 *rotate*). Even
there, the solved shape must look complete and intentional.

### 4.3 The solved structure is an object

The solved arrangement should read as one intentional thing: a staircase, an arch, a loop, a tower. It is
symmetric, closed, or completes a silhouette the player could almost see. The "oh" moment is the
structure snapping into that shape and the ball confirming it.

---

## 5. The idea

- **One new idea per level.** Each level teaches or twists exactly one thing (GAME_PLAN §6). Everything in
  the level serves that idea. Remove anything that doesn't.
- **The impossible route is the right one, at least once per chapter.** The signature of Seamline is
  the floor that "can't be reached" being exactly where the ball goes.
- **Decoys are fair.** A decoy is a route a thoughtful player would genuinely consider, and it fails
  visibly. It never looks *more* joined than the real answer.
- **Introduce safely, then twist.** A mechanic first appears where nothing can go wrong; the next level
  uses it in a way that surprises.
- **Par is the elegant solution.** The shortest solution is the one that feels best. If the solver's
  shortest route is ugly or accidental, redesign.

---

## 6. Readable at a glance

- **Portrait, and big.** In every view the level allows, the structure fills most of the screen width.
  Nothing important is smaller than the ball. Check every view, not just the first.
- **Start, goal and pieces are visible from the start**, in the start view.
- **Seams are never covered.** No geometry, ornament or HUD sits over a seam the solution uses.
- **Depth is readable.** Use depth tint and the two-finger peek to show what is nearer and what is farther.
  The perceptual join should surprise, but peeking should explain it.
- **Quiet backgrounds.** Ornament never competes with track, and never reads as track.

---

## 7. Feel

- **Momentum is real.** Downhill speeds up, level ground cruises, bumps lose speed, nothing climbs from rest.
- **Runs are short.** A solution run takes about 3–8 seconds. Long empty stretches are cut.
- **Feedback for everything.** A join forming glows. A bump knocks and the piece wobbles. A fall fades and
  the ball drops back onto its socket. A refused move shakes. The first perceptual crossing plays in
  slow motion.
- **Calm.** No timers, no fail screens, no punishment for trying.

---

## 8. Checklist (copy one per level)

| Check | How | ✓ |
|---|---|---|
| Laws L1–L8 pass | `npm test` | |
| Unique solution at par | `npm run solve` | |
| The answer looks like the answer | solved screenshot, traced by someone fresh | |
| Every wrong position looks wrong and fails legibly | try every stop and orientation | |
| Frame-by-frame: no clip, flicker, vanish or pop | phone screen recording of solution and two wrong tries | |
| Pieces are displaced parts of the structure | review start and solved screenshots | |
| Pieces are anchored (rail, hub, arm), not floating | review | |
| Every piece does two things | write them down | |
| Every visible part has a job | review | |
| Solved structure reads as one object | solved screenshot | |
| One idea, deducible by looking | play cold | |
| Fills the screen in every view | screenshot per view | |
| Played on a phone and the owner is happy | owner | |

---

## 9. Review of Chapter 1 (2026-10-26, first pass)

All seven solution runs recorded frame by frame in the browser at phone size; L1–L3 also played on the owner's
phone, including wrong attempts. After v0.4's physics fixes all seven levels pass the Laws (§2). The other
sections are where the work is.

| Level | Laws | Answer reads | Pieces belong | Two jobs | Verdict |
|---|---|---|---|---|---|
| L1 First Sight | ✓ | ✓ one straight beam | ✗ the beam floats on a dotted rail | exempt (teaches slide) | Anchor the beam |
| L2 Turn | ✓ (hub fixed) | ✓ a clean J curve | ✗ the elbow floats beside the pillar | ✗ its start orientation does nothing | Mount the elbow on the pillar; make wrong turns send the ball somewhere |
| L3 The Star | ✓ (solid star) | ✓ pillar flows through the star into the floor, both joins seamless | ~ the star now sits on the pillar like a bracket; its rail is still dotted; three of its four faces are unused | ✗ only catches | Give the other faces a job; anchor its rail |
| L4 Two Sights | ✓ | ~ the zigzag reads, the drop to the goal is unclear | ✗ two floating beams; the decoy block sits over the goal bowl at the start | ~ slider 1 has a decoy join | Make the decoy a meaningful ledge that never covers the bowl; anchor both beams |
| L5 Hold | ✓ | ✓ | ✗ floats | ✓ one beam, two jobs | Anchor the beam |
| L6 Another Angle | ✓ | ~ | ✗ four separate floating blocks | ✗ | Rebuild as one structure that looks broken until the turn |
| L7 Monument | ✓ | ~ | ✗ star and elbow float | ✗ | Rework with L3's star; frame view 1 (tiny on screen) |

Common to every level: **movable pieces float in empty space with only a dotted line as a mechanism**,
and most do one job. That is the next round of work (§4.1 anchoring, §4.2 two jobs), level by level, with
the owner checking each one against this guide until every row is a ✓.
