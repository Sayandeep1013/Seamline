# Seamline: Feel, Motion and Atmosphere Research

> Compiled 2026-10-20 from web research. This is input to `GAME_PLAN.md`, not part of it yet. Anything adopted gets moved into the plan and logged in §16 there.
> Items marked "(obs.)" come from play and analysis rather than developer sources. Millisecond costs are estimates for a Mali-G57 / Adreno 6xx class phone at DPR 2. Profile on the real device.

## 1. What calm games actually do

- **Monument Valley 1.** "Every screen could be framed and hung on a wall": the whole puzzle sits in one composition with no scrolling, a diorama floating in a void. The base of each structure fades into the background, so there is never a hard world edge (obs.). Levels were added only "if we had something new to say".
  - Sources: gamedeveloper.com/design/designing-the-surprise-mobile-game-hit-i-monument-valley-i- · gdcvault.com/play/1021380/Designing-Monument-Valley-Less
- **Monument Valley 2.** Music and sound effects work as one system. Character steps play a randomised hang-drum ping tuned to the level's key, and finishing a puzzle phase plays a sting. "Important to not overuse musical interactions."
  - Source: asoundeffect.com/behind-beautiful-sound-monument-valley-2-todd-baker
- **Monument Valley 3.** Rotators play a note at each set angle, so moving one plays a scale. Drag sounds are layered:
  - a physical loop
  - a high-pass filter that opens as the drag goes on
  - an impact at the end of travel, scaled by velocity
  - a tonal layer whose tremolo follows drag speed

  Ambience, effects and music take turns in focus, which leaves "pockets of breathing space".
  - Source: asoundeffect.com/monument-valley-3-game-audio
- **Mini Metro / Mini Motorways (Disasterpeace).**
  - There are no loops: every sound is a note triggered by an event.
  - Each new chord shares tones with the previous one (common-tone voice leading).
  - Interaction sounds are pitched to the current chord.
  - Simultaneous voices are capped, and clustered events are spread into arpeggios.
  - Sources: designingsound.org/2016/02/18/the-programmed-music-of-mini-metro-interview-with-rich-vreeland-disasterpeace · gamedeveloper.com/design/turning-road-noise-into-music-mini-motorways
- **Townscaper.** A toy with very few interactions. Detail fills in a beat after a block appears. Ambient life (birds) loiters near the geometry. The only sounds are a soft pop, water and gulls.
- **Journey.** The sand is several cheap fakes layered together (an "ocean" specular plus glitter), not physically correct rendering.
  - Source: alanzucconi.com/2019/10/08/journey-sand-shader-1
- **Gris.** Colour is the progression: each chapter is built around one colour, and the game "evolves visually, not only mechanically". This maps directly onto Seamline's per-chapter palettes.
- **Alto's Odyssey.** "Stripping away the noise": a limited palette per area, a purer foreground against a tinted background, and a Zen mode with no score.
- **I Love Hue / A Monster's Expedition.** No timers, no move limits, no penalty, and instant undo. Camera glides gently between islands (obs.).
- **Viewfinder.** Perspective actions must feel "seamless and immediate". The team optimised specifically to remove single-frame stutters.
  - Source: 80.lv/articles/postmortem-developing-viewfinder-a-surreal-perception-bending-puzzle-game
- **Lumino City.** Tiny mechanical motion makes a still world feel alive.

## 2. Atmosphere techniques (Three.js orthographic, mobile budget)

| Technique | How | Mobile cost | Verdict |
|---|---|---|---|
| Gradient background with slow drift, dither and vignette | Full-screen shader drawn first (snippet A) | ~0.3 ms, 1 draw | **Core** |
| Height fade into the background | In the three-tone shader: `mix(col, bgAt(screenY), smoothstep(y0,y1,-worldY))`. Do **not** use `THREE.Fog`, because depth fog reads wrong in orthographic. | ~0 | **Core** |
| Contact AO | Bake vertex darkening (×0.9) at block bases and inner corners when generating geometry | 0 | **Core** |
| Blob shadow under the ball | Warm radial-gradient quad (snippet C) | 1 draw | **Core** |
| Dust motes | One `THREE.Points` set, animated entirely in the vertex shader (snippet B) | < 0.2 ms | **M3** |
| Seam glow | Additive ribbon mesh with Gaussian falloff, no post-processing (snippet D) | 1 draw | **Core** |
| Per-chapter colour grade | Palette uniforms lerped over 2–3 s | 0 | **Core** |
| Vignette | Inside the background shader only, ≤ 12%, never darkening the structure | 0 | **M3** |
| Day/night drift | Same palette uniforms on a 3–6 min loop. Warm shadows, never true night, because low contrast hurts seam readability | 0 | Nice-to-have |
| Parallax backdrop shapes | Flat distant shapes rotating at ~0.3× during view turns. Disabled under reduced motion | 1–3 draws | Nice-to-have |
| Flat clouds / banded water | Rounded flat-shaded boxes drifting; a 2-tone `sin` stripe plane | 1–3 draws | Nice-to-have |
| Bloom (UnrealBloomPass), SSAO, DOF, shadow maps, animated grain | — | 3–8 ms+ | **Skip** |

Global settings:
- Use `antialias: true` with `setPixelRatio(min(dpr, 2))`. Edge shimmer during view turns breaks the calm more than the extra fill cost hurts.
- No EffectComposer.
- No allocations per frame.
- One shared material per tone.
- Call `renderer.compile(scene, camera)` at load so shaders don't compile mid-play.
- Render on demand when idle.

## 3. Motion language

**Rule zero: puzzle geometry never idles.** Joins are pixel-exact, so only decorative things move: motes, the background drift and the ball's breathing.

| Action | Timing / easing |
|---|---|
| Drag a slider | Follows the finger 1:1 along the rail. Past the ends, rubber-band resistance `d' = L·(1−e^(−d/L))` instead of an error. |
| Release snap | 180–260 ms easeOutCubic, or a critically damped spring (ζ = 1, at most 3% overshoot). A soft tick at each detent. |
| Rotate | Snaps to 90° in 250–350 ms with easeOutQuart. |
| View turn | 600 ms easeInOutSine/Cubic, with an optional 2% orthographic zoom-out "breath" at the midpoint. **No roll.** Snap to the exact isometric angle at the end. |
| Ball travel | Cruises at 1.8–2.2 tiles/s. Eases in over 150 ms and out over 250 ms. Speed ×1.15 downhill and ×0.85 uphill, smoothed with k≈6. Corners are rounded over ~0.2 tile. |
| Ball rolling | `axis = up × dir`, `angle = dist / R` (snippet E). **A plain red ball with a fixed specular dot shows no rotation**, so it needs a lighter band or dot in its geometry. |
| Ball idle | Breathing scale of 1.0 ↔ 1.015 at 0.2 Hz. A 0.97 y squash on landing. |
| Seam forms | The glow fades in over 400 ms, a chime plays, and the path "draws" along over 300 ms. |
| Solve | The ball settles. A ring expands from the goal (1.2 s, easeOutSine). Motes swirl upward. The palette lifts by 4% and the chord resolves. |
| Level transition | No hard cuts. The blocks lower away with a 30–40 ms stagger (500 ms) while the palette lerps, then the next level rises in. Total ≤ 1.8 s, and tapping skips it. |
| Reduced motion | The view turn becomes a 250 ms crossfade. No motes, no parallax. Transitions become fades. |

## 4. Audio and haptics

**Musical rules**
- **Key:** one pentatonic or modal key per chapter. Every sound effect is pitched to the current scale or chord.
- **Slide detents:** each detent plays the next scale degree, rising in the direction of travel. Amplitude follows drag speed.
- **Snap:** a chord tone plus a soft low "thock" (filtered noise, 150–300 Hz, 40 ms).
- **Seam join:** a rising fifth. **Solve:** a 3-note arpeggio resolving to the root.
- **Ball steps:** a randomised pentatonic ping every 1–2 tiles at −28 dB, rate-limited.
- **Latency:** direct feedback is **never** quantised to the beat, because more than 50 ms of latency feels broken. Only ambient flourishes are quantised.

**Ambient pad**
- 3–4 detuned sine and triangle voices, low-passed at 700–1500 Hz.
- An LFO at 0.05–0.1 Hz moves the cutoff.
- The chord changes every 8–16 s, with 4–6 s crossfades between chords that share tones.
- A sparse melody note every 6–20 s.

**Reverb**
- One shared `ConvolverNode` with a generated 3–4 s decaying, low-passed noise impulse response.

**Mix**
- Levels: pad −24 dBFS, chimes −14, steps −28.
- Master compressor: threshold −18, ratio 3.
- High-shelf cut above 7 kHz, and no sustained energy at 2–5 kHz.
- Attacks of at least 5 ms; exponential releases.
- High-pass at 40 Hz.

**Lifecycle**
- Resume audio on first touch. Suspend on Capacitor `pause` and resume on `resume`.

**Haptics (Capacitor Haptics)**
- Dragging: `selectionStart` on grab, `selectionChanged` at each detent, `selectionEnd` on release.
- Snap: `impact({ style: Light })`.
- Solve: two Light impacts 120 ms apart. Avoid `notification(Success)`, which is often buzzy on Android.
- No haptics on view turns.
- Leave at least 60 ms between pulses, and provide an off toggle.

## 5. Things that break calm

- Screenshake, flashes, hard cuts, error buzzers or red ✗ (use rubber-banding instead).
- Bouncy overshoot.
- Identical repeated sounds (use variation pools instead).
- Loud stings, or sudden silence.
- A busy melody.
- Gradient banding.
- A strong vignette.
- Aliasing shimmer during rotation.
- GC or shader-compile hitches.
- Idle motion on puzzle geometry.
- Camera zoom or roll.
- Long unskippable transitions.
- Popups, star ratings or move counters during play.
- Grey shadows (keep shadows warm within the palette).

## 6. Priorities

**M0 (core feel)**
1. Direct-manipulation drag with rubber-banding, snap easing and detent ticks.
2. Ball easing, slope speed and visible rolling.
3. View-turn easing with an exact end snap.
4. Gradient background with dither.
5. Blob shadow and baked AO.
6. Seam glow ribbon.
7. Pentatonic chimes with shared reverb and a compressor.
8. DPR cap, MSAA, allocation-free render loop and shader pre-warm.
9. A reduced-motion flag wired through every tween.

**M3 (atmosphere)**
1. Height fade.
2. Dust motes.
3. Generative common-tone pad.
4. Palette lerps per chapter.
5. Solve flourish and staggered level transitions.
6. Haptics.
7. Ball step pings and breathing.
8. Vignette.
9. Audio lifecycle handling.

**Nice-to-have**
- Day/night drift.
- Parallax backdrop.
- Clouds and water.
- Drag tremolo.
- Transition audio built from the next level's material.
- Ambient birds.
- Gris-style colour-unlock progression.

**Skip**
- Bloom, SSAO, DOF, chromatic aberration.
- Shadow maps, physics, volumetric fog.
- Animated grain, screenshake.
- Sample libraries.
- Tone.js.

## 7. Snippets

### A. Gradient background
```ts
const bgMat = new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: { uTop:{value:new THREE.Color('#E3DC4E')}, uBot:{value:new THREE.Color('#D9CF3A')},
              uTime:{value:0}, uVig:{value:0.10} },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `precision highp float; varying vec2 vUv;
    uniform vec3 uTop, uBot; uniform float uTime, uVig;
    float ign(vec2 p){ return fract(52.9829189*fract(dot(p, vec2(0.06711056,0.00583715)))); }
    void main(){
      float t = vUv.y + 0.03*sin(uTime*0.05 + vUv.x*2.0);      // ~2-min drift
      vec3 c = mix(uBot, uTop, smoothstep(0.0, 1.0, t));
      vec2 d = vUv - 0.5; c *= 1.0 - uVig*dot(d,d)*2.0;
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
      gl_FragColor.rgb += (ign(gl_FragCoord.xy) - 0.5)/255.0;  // anti-banding dither
    }`
});
const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
bg.frustumCulled = false; bg.renderOrder = -1000; scene.add(bg);
```

### B. Dust motes (GPU-only, zero CPU per frame)
```ts
const N = 140, seeds = new Float32Array(N*4).map(() => Math.random());
const g = new THREE.BufferGeometry();
g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N*3), 3));
g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
const motes = new THREE.Points(g, new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uTime:{value:0}, uBox:{value:new THREE.Vector3(14,10,14)}, uSize:{value:3*Math.min(devicePixelRatio,2)},
              uColor:{value:new THREE.Color('#FFF9D6')} },
  vertexShader: `attribute vec4 aSeed; uniform float uTime, uSize; uniform vec3 uBox; varying float vA;
    void main(){
      vec3 p = (aSeed.xyz - 0.5) * uBox;
      float h = mod(aSeed.y*uBox.y + uTime*(0.05 + 0.08*aSeed.w), uBox.y);
      p.y = h - 0.5*uBox.y;
      p.x += 0.3*sin(uTime*0.2 + aSeed.w*6.28); p.z += 0.3*cos(uTime*0.17 + aSeed.x*6.28);
      vA = smoothstep(0.0, 0.15, h/uBox.y) * smoothstep(1.0, 0.8, h/uBox.y) * (0.35 + 0.35*aSeed.w);
      gl_PointSize = uSize * (0.6 + 0.8*aSeed.z);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: `uniform vec3 uColor; varying float vA;
    void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uColor, vA*smoothstep(0.5, 0.15, d)); }`
}));
motes.frustumCulled = false; scene.add(motes);
```

### C. Blob shadow (warm, not black)
```ts
const cv = Object.assign(document.createElement('canvas'), {width:64, height:64});
const cx = cv.getContext('2d')!, gr = cx.createRadialGradient(32,32,0,32,32,32);
gr.addColorStop(0, 'rgba(120,100,10,0.45)'); gr.addColorStop(1, 'rgba(120,100,10,0)');
cx.fillStyle = gr; cx.fillRect(0,0,64,64);
const blob = new THREE.Mesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),
  new THREE.MeshBasicMaterial({ map:new THREE.CanvasTexture(cv), transparent:true, depthWrite:false,
    polygonOffset:true, polygonOffsetFactor:-2 }));
// per frame: sit under the ball; shrink and fade with height
blob.position.set(ball.position.x, surfaceY + 0.002, ball.position.z);
const k = 1 / (1 + 2*(ball.position.y - R - surfaceY));
blob.scale.setScalar(R*2.2*k); (blob.material as THREE.MeshBasicMaterial).opacity = k;
```

### D. Seam glow ribbon
Build a strip along the seam, offset by ±w perpendicular to both the seam and the view vector. Store `aSide = −1 | +1` on each vertex.
```glsl
// fragment — AdditiveBlending, depthTest:false, high renderOrder
uniform float uTime, uIntensity; varying float vSide; varying float vAlong;
void main(){
  float core = exp(-8.0*vSide*vSide);
  float pulse = 0.8 + 0.2*sin(uTime*1.3 - vAlong*2.0);
  gl_FragColor = vec4(vec3(1.0, 0.97, 0.80) * core * pulse * uIntensity, 1.0);
}
// tween uIntensity 0 → 0.6 over 400 ms when the join forms
```

### E. Ball roll and slope speed
```ts
const UP = new THREE.Vector3(0,1,0), axis = new THREE.Vector3(), q = new THREE.Quaternion();
speed += (cruise*slopeMul - speed) * (1 - Math.exp(-6*dt));  // slopeMul 1.15 down / 0.85 up
const step = moveAlongPath(speed*dt);                         // world delta (reused Vector3)
const d = step.length();
if (d > 1e-6) { axis.crossVectors(UP, step).normalize(); q.setFromAxisAngle(axis, d / R); ball.quaternion.premultiply(q); }
```
On vertical track segments, compute the axis from the surface normal (`n × dir`) instead of `UP`.

### F. Generative pad, reverb and chime (Web Audio, no libraries)
```ts
const ctx = new AudioContext(), master = ctx.createGain(); master.gain.value = 0.7;
const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
const shelf = ctx.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 7000; shelf.gain.value = -6;
master.connect(shelf).connect(comp).connect(ctx.destination);
function ir(sec = 3.5, decay = 3) {
  const n = ctx.sampleRate*sec|0, b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let lp = 0;
    for (let i = 0; i < n; i++) { lp += 0.2*((Math.random()*2-1) - lp); d[i] = lp*Math.pow(1 - i/n, decay); } }
  return b;
}
const verb = ctx.createConvolver(); verb.buffer = ir(); const wet = ctx.createGain(); wet.gain.value = 0.35;
verb.connect(wet).connect(master);
const PENTA = [0,2,4,7,9], ROOT = 50, hz = (m:number) => 440*2**((m-69)/12);
const note = (deg:number, oct = 0) => ROOT + PENTA[((deg%5)+5)%5] + 12*(Math.floor(deg/5) + oct);

function padVoice(m:number, t:number, dur:number) {
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 0.4;
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.06; lg.gain.value = 350;
  lfo.connect(lg).connect(f.frequency);
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.045, t + dur*0.4); g.gain.linearRampToValueAtTime(0, t + dur);
  const oscs = ([['triangle',0],['sine',7],['sine',-5]] as const).map(([type, det]) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz(m); o.detune.value = det;
    o.connect(f); return o; });
  f.connect(g); g.connect(master); g.connect(verb);
  [...oscs, lfo].forEach(o => { o.start(t); o.stop(t + dur + 0.1); });
}
let chord = [0,2,4];
function nextChord() {                       // keep >= 1 common tone (Mini Motorways rule)
  const cands = [[0,2,4],[1,3,5],[2,4,6],[-1,1,3],[0,3,5]].filter(c => c.some(x => chord.includes(x)) && c+'' !== chord+'');
  chord = cands[Math.random()*cands.length|0];
  const t = ctx.currentTime + 0.1; chord.forEach(d => padVoice(note(d), t, 14));
}
function chime(deg:number, vel = 1) {        // soft FM bell; modulation index decays so it mellows
  const t = ctx.currentTime, f0 = hz(note(deg, 1));
  const o = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
  o.frequency.value = f0; mod.frequency.value = f0*2; mg.gain.setValueAtTime(f0*0.6*vel, t); mg.gain.setTargetAtTime(0, t, 0.12);
  mod.connect(mg).connect(o.frequency);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16*vel, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
  o.connect(g); g.connect(master); g.connect(verb);
  o.start(t); mod.start(t); o.stop(t + 1.9); mod.stop(t + 1.9);
}
```
Production notes:
- Drive `nextChord` from a lookahead scheduler on `ctx.currentTime`, not `setInterval`, and pause it in the background.
- Cap simultaneous chimes at about 6 (voice stealing).
- Pool 3–5 variants of the "thock" sound.
