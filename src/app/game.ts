// Level controller: builds the scene from level data, runs input, the ball and feedback.
import * as THREE from 'three';
import { type BallEvent, type BallState, type BallWorld, advance, upcoming } from '../core/ball';
import { AXES, VIEWS, type V3, add, eq, manhattan, scale, sub } from '../core/grid';
import { findContinuation } from '../core/joins';
import { Solidity } from '../core/solidity';
import {
  type LevelDef, type PieceDef, type PieceState, type PieceStates, initialStates, padKeys, pieceSegments, placementOf,
  resolveSegments, slideVector, startSegment,
} from '../core/level';
import { type Move, solve } from '../core/solver';
import { type Segment, exitOf, frameAt, lengthOf, place } from '../core/track';
import { type Spring, activeTweens, cancelAllTweens, damp, ease, reducedMotion, stepSpring, tween, updateTweens } from '../anim/motion';
import { sound } from '../audio/sound';
import {
  BALL_R, bowlParts, hookParts, nubGeometry, padGeometry, pivotGeometry, seamGeometry, trackGeometry,
} from '../render/geometry';
import {
  backgroundMesh, ballMaterial, blobShadowMaterial, depthUniforms, dustMotes, seamGlowMaterial, toneMaterial, toneVariant,
} from '../render/materials';
import { PALETTES, type Palette } from '../render/palette';
import type { Stage } from '../render/scene';
import { haptic, hapticSelectionEnd, hapticSelectionStart } from './platform';

const CRUISE = 2.0;          // tiles per second
const RUBBER = 0.45;         // rubber-band length past the rail ends
const DRAG_SLOP = 10;        // px before a tap becomes a drag
const SWIPE_MIN = 60;        // px for a view turn
const BALL_TAP_PX = 48;      // tap radius around the ball, in CSS px
const HINT_IDLE = 25;        // seconds before the hint button appears
const GRAVITY = 22;          // world units per second², tuned so short drops read as weighty but quick
/** Star arms taper to fine points at the tips and thicken toward the centre. */
const STAR_DEPTH = (u: number) => 0.1 + 0.62 * Math.sin(Math.PI * u);

const vec = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);

interface PieceView {
  def: PieceDef;
  outer: THREE.Group;
  pivot: THREE.Group;
  inner: THREE.Group;
  hit: THREE.Mesh;
  slideAxis: THREE.Vector3 | null;
  rotAxis: THREE.Vector3 | null;
  stops: number[];
  committed: PieceState;
  slide: Spring;
  rot: Spring;
  moving: boolean;
  lastDetent: number;
  shake: number;
}

interface SeamView { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; intensity: number }

type Action =
  | { type: 'slide'; id: string; from: number; to: number }
  | { type: 'rotate'; id: string; from: number; to: number }
  | { type: 'view'; from: number; to: number };

export interface GameCallbacks {
  onWin(moves: number, par: number): void;
  onMoves(moves: number): void;
  onHintAvailable(on: boolean): void;
  onTip(text: string | null): void;
}

export class Game {
  readonly level: LevelDef;
  private pal: Palette;
  private root = new THREE.Group();
  private pieces = new Map<string, PieceView>();
  private caps = new Map<string, [THREE.Mesh, THREE.Mesh]>();
  private seams = new Map<string, SeamView>();
  private ball = new THREE.Group();
  private ballMesh!: THREE.Mesh;
  private ballShadow!: THREE.Mesh;
  private hookArm: THREE.Mesh | null = null;
  private ring: THREE.Mesh | null = null;
  private ghost: THREE.Group | null = null;
  private ghostUntil = Infinity;
  private motes!: THREE.Points;
  private bg!: THREE.Mesh;
  private view: number;
  private turning = false;
  private state: BallState;
  private speed = 0;
  private pauseFor = 0;
  private overlayAfter = 0;
  private released = false;
  private crossedOnce = false;
  private firstCrossDone = false;
  private time = 0;
  private idle = 0;
  private hintShown = false;
  private timeScale = 1;
  private targetTimeScale = 1;
  private moves = 0;
  private undoStack: Action[] = [];
  private breathe = 0;
  private won = false;
  private pointer: {
    id: number; start: THREE.Vector2; piece: PieceView | null; startValue: number;
    screenAxis: THREE.Vector2; dragging: boolean;
  } | null = null;
  private raycaster = new THREE.Raycaster();
  private abort = new AbortController();
  private lastBallPos = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpAxis = new THREE.Vector3();
  private disposables: { dispose(): void }[] = [];
  private timers: number[] = [];
  private solid: Solidity;
  /** Tone materials per owner (piece id, or fixed segment id) so each can borrow a partner's depth. */
  private ownerMats = new Map<string, THREE.ShaderMaterial[]>();
  private shift = new Map<string, { x: number; target: number }>();
  private tone!: THREE.ShaderMaterial;
  /** Which side of a perceptual crossing is nearer the camera, for drawing the ball at that depth. */
  private crossK = 0;
  private falling: {
    pos: THREE.Vector3; vel: THREE.Vector3; to: THREE.Vector3; t: number; result: 'roll' | 'settle' | 'lost' | 'drop-in';
  } | null = null;
  private pointers = new Map<number, THREE.Vector2>();
  private lastSeg = '';
  private lastDir: 1 | -1 = 1;
  private peeking = false;
  private peekTarget = 0;
  private dragRange: [number, number] = [0, 0];

  constructor(private stage: Stage, level: LevelDef, private cb: GameCallbacks) {
    this.level = level;
    this.pal = PALETTES[level.palette] ?? PALETTES.mustard;
    this.view = level.startView;
    this.solid = new Solidity(level);
    this.state = this.startState();
    this.build();
    this.bindInput();
    cb.onTip(level.tip ?? null);
  }

  // ---------------------------------------------------------------- build

  private startState(): BallState {
    return { segId: startSegment(this.level).id, dir: 1, dist: 0, mode: 'resting' };
  }

  private keep<T extends { dispose(): void }>(m: T): T { this.disposables.push(m); return m; }

  private build() {
    const p = this.pal;
    const stage = this.stage;
    stage.setView(this.view);
    this.bg = backgroundMesh(p);
    stage.scene.add(this.bg, this.root);
    this.tone = this.keep(toneMaterial(p.top, p.left, p.right));
    depthUniforms.uBg.value.set(p.bgTop);
    const v0 = VIEWS[this.level.startView];
    const fitPoints: THREE.Vector3[] = [];
    const addFit = (segs: Segment[]) => {
      for (const s of segs) for (let i = 0; i <= 4; i++) {
        const f = frameAt(s, 1, (lengthOf(s) * i) / 4);
        fitPoints.push(vec(f.p).addScaledVector(vec(f.n), -0.6), vec(f.p).addScaledVector(vec(f.n), 0.4));
      }
    };

    const fixedSegs = resolveSegments(this.level, initialStates(this.level)).filter((s) => s.pieceId === null);
    for (const seg of fixedSegs) this.root.add(this.segmentMeshes(seg, this.ownerTone(seg.id)));
    addFit(fixedSegs);

    for (const def of this.level.pieces) {
      const segs = pieceSegments(def);
      const outer = new THREE.Group(), pivot = new THREE.Group(), inner = new THREE.Group();
      const pv3 = def.rotate ? vec(def.rotate.pivot as V3) : new THREE.Vector3();
      pivot.position.copy(pv3);
      inner.position.copy(pv3).negate();
      outer.add(pivot);
      pivot.add(inner);
      const star = def.shape === 'star' || def.shape === 'halfstar';
      const tone = this.ownerTone(def.id);
      for (const seg of segs) inner.add(this.segmentMeshes(seg, tone, star ? STAR_DEPTH : undefined));
      if (def.slide && def.shape === 'beam') inner.add(new THREE.Mesh(this.keep(nubGeometry(segs[0], v0)), tone));
      if (def.rotate) inner.add(new THREE.Mesh(this.keep(pivotGeometry(def.rotate.pivot as V3, def.rotate.axis, v0)), tone));
      // Generous invisible hit box around the whole piece, in the inner group's frame.
      const box = new THREE.Box3();
      for (const s of segs) for (let i = 0; i <= 6; i++) {
        const f = frameAt(s, 1, (lengthOf(s) * i) / 6);
        box.expandByPoint(vec(f.p)).expandByPoint(vec(f.p).addScaledVector(vec(f.n), -0.9));
      }
      box.expandByScalar(0.4);
      const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const hitGeo = this.keep(new THREE.BoxGeometry(size.x, size.y, size.z));
      hitGeo.translate(c.x, c.y, c.z);
      const hit = new THREE.Mesh(hitGeo, this.keep(new THREE.MeshBasicMaterial({ visible: false })));
      inner.add(hit);
      this.root.add(outer);
      if (def.slide) this.addRail(def, segs);

      const st = { s: def.slide?.initial ?? 0, r: def.rotate?.initial ?? 0 };
      const view: PieceView = {
        def, outer, pivot, inner, hit,
        slideAxis: def.slide ? vec(slideVector(def.slide)) : null,
        rotAxis: def.rotate ? vec(AXES[`+${def.rotate.axis}`]) : null,
        stops: def.slide ? [...def.slide.stops].sort((a, b) => a - b) : [0],
        committed: { ...st },
        slide: { x: st.s, v: 0, target: st.s },
        rot: { x: st.r, v: 0, target: st.r },
        moving: false, lastDetent: st.s, shake: 0,
      };
      this.pieces.set(def.id, view);
      this.applyPieceTransform(view);
      for (const s of def.slide?.stops ?? [st.s]) for (let r = 0; r < (def.rotate ? 4 : 1); r++) {
        addFit(segs.map((sg) => place(sg, placementOf(def, { s, r }))));
      }
    }

    for (const pad of this.level.restPads) {
      const seg = fixedSegs.find((s) => onStraight(s, pad as V3));
      const n = seg ? vec(AXES[seg.n0]) : new THREE.Vector3(0, 1, 0);
      const rimMat = this.keep(toneMaterial('#E2BE3F', p.bowlRim, '#A9871C'));
      if (seg) this.ownerMats.get(seg.id)?.push(rimMat);
      const ring = new THREE.Mesh(this.keep(padGeometry(pad as V3, n)), rimMat);
      ring.castShadow = ring.receiveShadow = true;
      this.root.add(ring);
    }

    this.buildBall();
    this.buildHint();
    const box = new THREE.Box3().setFromPoints(fitPoints);
    this.motes = dustMotes(p, box.getCenter(new THREE.Vector3()), box.getSize(new THREE.Vector3()).addScalar(6));
    this.disposables.push(this.motes.geometry, this.motes.material as THREE.Material, this.bg.geometry, this.bg.material as THREE.Material);
    stage.scene.add(this.motes);
    stage.fit(fitPoints, this.level.views);
    stage.setView(this.view);
    this.refreshJoins(true);
    this.placeBall(true);
  }

  private ownerTone(owner: string) {
    const m = this.keep(toneVariant(this.tone));
    this.ownerMats.set(owner, [...(this.ownerMats.get(owner) ?? []), m]);
    this.shift.set(owner, { x: 0, target: 0 });
    return m;
  }

  /** Body + end caps (+ hook / bowl) for one segment in its authored position. */
  private segmentMeshes(seg: Segment, tone: THREE.ShaderMaterial, depth?: number | ((u: number) => number)) {
    const g = new THREE.Group();
    const geo = trackGeometry(seg, 0, depth);
    this.disposables.push(geo.body, ...geo.caps);
    const caps: [THREE.Mesh, THREE.Mesh] = [new THREE.Mesh(geo.caps[0], tone), new THREE.Mesh(geo.caps[1], tone)];
    const body = new THREE.Mesh(geo.body, tone);
    for (const m of [body, ...caps]) { m.castShadow = true; m.receiveShadow = true; }
    g.add(body, ...caps);
    this.caps.set(seg.id, caps);
    if (seg.ends[0] === 'start') this.buildHook(seg, tone, g);
    if (seg.ends.includes('goal')) this.buildBowl(seg, g, seg.pieceId ?? seg.id);
    return g;
  }

  private addRail(def: PieceDef, segs: Segment[]) {
    const axis = vec(slideVector(def.slide!));
    const box = new THREE.Box3();
    for (const s of segs) for (let i = 0; i <= 4; i++) box.expandByPoint(vec(frameAt(s, 1, (lengthOf(s) * i) / 4).p));
    // Sit the rail just below the piece, or behind it for vertical rails.
    const off = def.slide!.axis === 'y' ? new THREE.Vector3(-0.2, 0, -0.75) : new THREE.Vector3(0, -BALL_R - 0.78, 0);
    const mid = box.getCenter(new THREE.Vector3()).add(off);
    const mat = this.keep(new THREE.MeshBasicMaterial({ color: this.pal.rail, transparent: true, opacity: 0.5, depthWrite: false }));
    const geo = this.keep(new THREE.SphereGeometry(0.055, 10, 8));
    const lo = Math.min(...def.slide!.stops), hi = Math.max(...def.slide!.stops);
    for (let s = lo; s <= hi + 1e-6; s += 0.25) {
      const isStop = def.slide!.stops.some((x) => Math.abs(x - s) < 1e-6);
      const dot = new THREE.Mesh(geo, mat);
      dot.scale.setScalar(isStop ? 1.3 : 0.55);
      dot.position.copy(mid).addScaledVector(axis, s);
      this.root.add(dot);
    }
  }

  private buildHook(seg: Segment, tone: THREE.ShaderMaterial, g: THREE.Group) {
    const h = hookParts(seg, VIEWS[this.level.startView]);
    this.disposables.push(h.post, h.arm);
    const post = new THREE.Mesh(h.post, tone);
    post.position.copy(h.postAt);
    const arm = new THREE.Mesh(h.arm, tone);
    arm.position.copy(h.pivot);
    arm.userData = { axis: h.hingeAxis, side: h.side };
    this.hookArm = arm;
    g.add(post, arm);
  }

  private buildBowl(seg: Segment, g: THREE.Group, owner: string) {
    const p = this.pal;
    const f = frameAt(seg, 1, seg.ends[1] === 'goal' ? lengthOf(seg) : 0);
    const parts = bowlParts(f.p, vec(f.n));
    this.disposables.push(parts.bowl, parts.rim);
    const bowlMat = this.keep(toneMaterial(p.bowlTop, p.bowlLeft, p.bowlRight));
    bowlMat.side = THREE.DoubleSide;
    const rimMat = this.keep(toneMaterial('#E2BE3F', p.bowlRim, '#A9871C'));
    this.ownerMats.get(owner)?.push(bowlMat, rimMat);
    const bowl = new THREE.Mesh(parts.bowl, bowlMat), rim = new THREE.Mesh(parts.rim, rimMat);
    bowl.receiveShadow = rim.castShadow = true;
    g.add(bowl, rim);
    const ringGeo = this.keep(new THREE.RingGeometry(0.38, 0.44, 48));
    ringGeo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), vec(f.n)));
    this.ring = new THREE.Mesh(ringGeo, this.keep(new THREE.MeshBasicMaterial({
      color: p.glow, transparent: true, opacity: 0, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    })));
    this.ring.renderOrder = 15;
    this.ring.position.copy(parts.surface).addScaledVector(vec(f.n), 0.16);
    g.add(this.ring);
  }

  private buildBall() {
    this.ballMesh = new THREE.Mesh(this.keep(new THREE.SphereGeometry(BALL_R, 40, 28)), this.keep(ballMaterial(this.pal, BALL_R)));
    this.ballShadow = new THREE.Mesh(
      this.keep(new THREE.PlaneGeometry(BALL_R * 2.6, BALL_R * 2.6)), this.keep(blobShadowMaterial(this.pal.shadow)));
    this.ballMesh.castShadow = true;
    // Seam glows ignore depth; drawing the ball after them (transparent pass, later order) keeps it on top.
    (this.ballMesh.material as THREE.ShaderMaterial).transparent = true;
    this.ballMesh.renderOrder = 20;
    this.ballShadow.renderOrder = 19;
    this.ball.add(this.ballMesh);
    this.root.add(this.ball, this.ballShadow);
  }

  private buildHint() {
    const h = this.level.hint;
    if (!h) return;
    const c = this.pieces.get(h.piece)!.committed;
    this.showGhost(h.piece, { s: h.slideTo ?? c.s, r: h.rotateTo ?? c.r });
  }

  /** A translucent copy of a piece at a target state. */
  private showGhost(id: string, st: PieceState, seconds = Infinity) {
    this.clearGhost();
    const pv = this.pieces.get(id)!;
    const ghost = new THREE.Group();
    const mat = this.keep(new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0, depthWrite: false }));
    for (const seg of pieceSegments(pv.def)) {
      const geo = trackGeometry(place(seg, placementOf(pv.def, st)), 0.02);
      this.disposables.push(geo.body);
      const m = new THREE.Mesh(geo.body, mat);
      m.renderOrder = 5;
      ghost.add(m);
    }
    ghost.userData = { id, st };
    this.ghost = ghost;
    this.ghostUntil = this.time + seconds;
    this.root.add(ghost);
  }

  private clearGhost() {
    if (this.ghost) this.root.remove(this.ghost);
    this.ghost = null;
  }

  // ---------------------------------------------------------------- rules glue

  private states(): PieceStates {
    const s: PieceStates = {};
    for (const [id, pv] of this.pieces) s[id] = { ...pv.committed };
    return s;
  }

  private world(): BallWorld {
    const moving = new Set<string>();
    for (const [id, pv] of this.pieces) if (pv.moving) moving.add(id);
    return {
      segments: resolveSegments(this.level, this.states()), view: this.view, moving, pads: padKeys(this.level),
      startSeg: startSegment(this.level).id,
    };
  }

  private segment(world: BallWorld, id: string): Segment {
    return world.segments.find((s) => s.id === id)!;
  }

  /** Seam glows for active perceptual joins; end caps hidden on every joined end. */
  private refreshJoins(initial = false) {
    const world = this.world();
    const active = new Set<string>();
    const pairs = new Set<string>();
    const edges: [string, string, number][] = [];
    const owner = (sg: Segment) => sg.pieceId ?? sg.id;
    for (const [, caps] of this.caps) caps.forEach((c) => (c.visible = true));
    for (const seg of world.segments) {
      if (seg.pieceId && world.moving.has(seg.pieceId)) continue;
      for (const dir of [1, -1] as const) {
        const exit = exitOf(seg, dir);
        if (exit.flag !== 'open') continue;
        const c = findContinuation(world, exit, seg);
        if (!c || ((this.turning || this.peeking) && c.k !== 0)) continue;
        edges.push([owner(seg), owner(c.seg), c.k]);
        this.caps.get(seg.id)![dir === 1 ? 1 : 0].visible = false;
        if (c.dist === 0) this.caps.get(c.seg.id)![c.dir === 1 ? 0 : 1].visible = false;
        if (c.k === 0) continue;
        // One glow per seam, whichever direction found it first.
        const pair = [seg.id, c.seg.id].sort().join('|');
        if (pairs.has(pair)) continue;
        pairs.add(pair);
        const k = `${pair}#${this.view}#${[seg.from, seg.to, c.seg.from, c.seg.to].map((q) => q.join(',')).join(';')}`;
        active.add(k);
        if (!this.seams.has(k)) this.addSeam(k, seg, dir === 1 ? 1 : 0, initial);
      }
    }
    this.updateDepthShifts(edges);
    for (const [k, s] of this.seams) {
      if (active.has(k)) continue;
      this.seams.delete(k);
      tween(s.intensity, 0, 0.25, (x) => (s.mat.uniforms.uIntensity.value = x), {
        done: () => { this.root.remove(s.mesh); s.mesh.geometry.dispose(); s.mat.dispose(); },
      });
    }
  }

  /**
   * Joined pieces share a depth for the tint, so a perceptual seam never shows a colour step.
   * Walking the join graph from the start: a join with k puts the next piece k·|v| deeper, so it
   * borrows that much depth back. While turning or peeking every piece shows its true depth.
   */
  private updateDepthShifts(edges: [string, string, number][]) {
    for (const v of this.shift.values()) v.target = 0;
    if (this.turning || this.peeking) return;
    const adj = new Map<string, [string, number][]>();
    for (const [a, b, k] of edges) {
      adj.set(a, [...(adj.get(a) ?? []), [b, k]]);
      adj.set(b, [...(adj.get(b) ?? []), [a, -k]]);
    }
    const start = startSegment(this.level).id;
    const seen = new Map<string, number>([[start, 0]]);
    const queue = [start];
    while (queue.length) {
      const a = queue.shift()!;
      for (const [b, k] of adj.get(a) ?? []) {
        if (seen.has(b)) continue;
        seen.set(b, seen.get(a)! + k * Math.sqrt(3));
        queue.push(b);
      }
    }
    for (const [o, x] of seen) { const v = this.shift.get(o); if (v) v.target = x; }
  }

  private addSeam(k: string, seg: Segment, end: 0 | 1, initial: boolean) {
    const sg = seamGeometry(seg, end);
    const mat = seamGlowMaterial(this.pal.glow);
    mat.uniforms.uSide.value = sg.w.dot(vec(VIEWS[this.view])) >= 0 ? 1 : 0;
    mat.uniforms.uAspect.value = sg.aspect;
    const mesh = new THREE.Mesh(sg.geometry, mat);
    mesh.renderOrder = 10;
    this.root.add(mesh);
    const view: SeamView = { mesh, mat, intensity: 0 };
    this.seams.set(k, view);
    const set = (x: number) => { view.intensity = x; mat.uniforms.uIntensity.value = x; };
    if (initial) { set(0.5); return; }
    // One soft flare (well under the 3-flashes-per-second limit), then settle.
    tween(0, 1, 0.4, set, { ease: ease.outCubic, done: () => tween(1, 0.5, 1.2, set, { ease: ease.inOutSine }) });
    sound.join();
    haptic('light');
  }

  // ---------------------------------------------------------------- input

  private bindInput() {
    const el = this.stage.renderer.domElement;
    const o = { signal: this.abort.signal };
    el.addEventListener('pointerdown', (e) => this.onDown(e), o);
    el.addEventListener('pointermove', (e) => this.onMove(e), o);
    el.addEventListener('pointerup', (e) => this.onUp(e), o);
    el.addEventListener('pointercancel', (e) => this.onUp(e), o);
    el.addEventListener('lostpointercapture', (e) => this.onUp(e), o);
    el.addEventListener('contextmenu', (e) => e.preventDefault(), o);
  }

  private pickPiece(x: number, y: number): PieceView | null {
    const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    const hits = this.raycaster.intersectObjects([...this.pieces.values()].map((p) => p.hit), false);
    if (!hits.length) return null;
    return [...this.pieces.values()].find((p) => p.hit === hits[0].object) ?? null;
  }

  private ballScreen() {
    const v = this.ball.position.clone().project(this.stage.camera);
    return new THREE.Vector2(((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight);
  }

  private onDown(e: PointerEvent) {
    this.pointers.set(e.pointerId, new THREE.Vector2(e.clientX, e.clientY));
    // A second finger turns any gesture into a peek at the true depth.
    if (this.pointers.size >= 2 || e.button === 2) {
      this.cancelPointer();
      this.setPeek(true);
      return;
    }
    if (this.pointer || this.won) return;
    sound.unlock();
    sound.startPad();
    this.idle = 0;
    const start = new THREE.Vector2(e.clientX, e.clientY);
    const nearBall = this.ballScreen().distanceTo(start) < BALL_TAP_PX && this.state.mode === 'resting';
    const piece = nearBall ? null : this.pickPiece(e.clientX, e.clientY);
    const screenAxis = piece?.slideAxis ? this.stage.screenVector(piece.slideAxis) : new THREE.Vector2();
    this.pointer = { id: e.pointerId, start, piece, startValue: piece ? piece.slide.x : 0, screenAxis, dragging: false };
    this.stage.renderer.domElement.setPointerCapture(e.pointerId);
  }

  /** Abandon the current one-finger gesture, putting a dragged piece back on its stop. */
  private cancelPointer() {
    const d = this.pointer;
    this.pointer = null;
    if (d?.dragging && d.piece) {
      d.piece.slide.target = d.piece.committed.s;
      hapticSelectionEnd();
    }
  }

  private setPeek(on: boolean) {
    if (on === this.peeking && this.peekTarget === (on ? 1 : 0)) return;
    this.peekTarget = on ? 1 : 0;
    if (on && !this.peeking) {
      this.peeking = true;
      sound.turn();
      this.refreshJoins();
    }
  }

  private onMove(e: PointerEvent) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, new THREE.Vector2(e.clientX, e.clientY));
    const d = this.pointer;
    if (!d || e.pointerId !== d.id) return;
    const pv = d.piece;
    if (!pv || !pv.slideAxis) return;
    const delta = new THREE.Vector2(e.clientX, e.clientY).sub(d.start);
    if (!d.dragging) {
      if (delta.length() < DRAG_SLOP) return;
      if (this.ballOn(pv.def.id) || this.falling) { pv.shake = 1; sound.bump(); d.piece = null; return; }
      d.dragging = true;
      pv.moving = true;
      // Solid pieces: the drag can only reach as far as the first thing in the way.
      this.dragRange = this.solid.slideRange(pv.def.id, pv.committed, this.states(), this.ballObstacle());
      this.clearGhostIfFor(pv.def.id);
      hapticSelectionStart();
      this.refreshJoins();
    }
    const units = delta.dot(d.screenAxis) / Math.max(d.screenAxis.lengthSq(), 1e-6);
    const raw = d.startValue + units;
    const [lo, hi] = this.dragRange;
    let value = raw;
    if (raw > hi) value = hi + RUBBER * 0.5 * (1 - Math.exp(-(raw - hi) / RUBBER));
    if (raw < lo) value = lo - RUBBER * 0.5 * (1 - Math.exp(-(lo - raw) / RUBBER));
    const wasFree = pv.slide.x > lo - 1e-3 && pv.slide.x < hi + 1e-3;
    pv.slide.x = value;
    pv.slide.target = value;
    pv.slide.v = 0;
    // Pressing into an obstacle (not the end of the rail) gives a soft thud once.
    const blocked = (raw > hi + 0.05 && hi < pv.stops[pv.stops.length - 1]) || (raw < lo - 0.05 && lo > pv.stops[0]);
    if (blocked && wasFree) { sound.bump(); haptic('tick'); }
    const nearest = this.nearestStop(pv, value);
    if (nearest !== pv.lastDetent && Math.abs(value - nearest) < 0.2) {
      pv.lastDetent = nearest;
      sound.tick(pv.stops.indexOf(nearest));
      haptic('tick');
    }
  }

  private onUp(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.peeking) {
      if (this.pointers.size === 0) this.setPeek(false);
      return;
    }
    const d = this.pointer;
    if (!d || e.pointerId !== d.id) return;
    this.pointer = null;
    const delta = new THREE.Vector2(e.clientX, e.clientY).sub(d.start);
    if (d.dragging && d.piece) {
      const pv = d.piece;
      hapticSelectionEnd();
      const [lo, hi] = this.dragRange;
      const reachable = pv.stops.filter((st) => st >= lo - 1e-6 && st <= hi + 1e-6);
      const v = Math.min(Math.max(pv.slide.x, lo), hi);
      const target = reachable.reduce((best, st) => (Math.abs(st - v) < Math.abs(best - v) ? st : best), pv.committed.s);
      pv.slide.target = target;
      if (target !== pv.committed.s) {
        this.record({ type: 'slide', id: pv.def.id, from: pv.committed.s, to: target });
        pv.committed.s = target;
      }
      return;
    }
    if (delta.length() < DRAG_SLOP) {
      if (this.state.mode === 'resting' && !this.falling && this.ballScreen().distanceTo(d.start) < BALL_TAP_PX) { this.release(); return; }
      if (d.piece?.rotAxis) { this.rotate(d.piece); return; }
      if (d.piece) { d.piece.shake = 0.6; return; }
      if (this.state.mode === 'resting') this.nudgeBall();
      return;
    }
    if (!d.piece && Math.abs(delta.x) > SWIPE_MIN && Math.abs(delta.x) > Math.abs(delta.y) * 1.2) {
      this.turn(delta.x < 0 ? 1 : -1);
    }
  }

  /** Where the ball is, as an obstacle pieces can't pass through. */
  private ballObstacle(): V3 {
    const p = this.lastBallPos;
    return [p.x, p.y, p.z];
  }

  /** Desktop stand-in for the two-finger peek: hold Space. */
  keyPeek(on: boolean) {
    this.setPeek(on);
  }

  private nearestStop(pv: PieceView, value: number) {
    return pv.stops.reduce((best, s) => (Math.abs(s - value) < Math.abs(best - value) ? s : best), pv.stops[0]);
  }

  private ballOn(pieceId: string) {
    return this.segment(this.world(), this.state.segId)?.pieceId === pieceId && this.state.mode === 'rolling';
  }

  private clearGhostIfFor(id: string) {
    if (this.ghost?.userData.id === id) this.ghostUntil = this.time;
  }

  private record(a: Action) {
    this.undoStack.push(a);
    this.moves++;
    this.cb.onMoves(this.moves);
    this.idle = 0;
  }

  // ---------------------------------------------------------------- actions

  release() {
    if (this.state.mode !== 'resting' || this.won || this.falling) return;
    const fromStart = this.atStart();
    if (this.released) { this.moves++; this.cb.onMoves(this.moves); }
    this.released = true;
    this.state.mode = 'rolling';
    this.state.bumps = 0;
    this.state.bumped = false;
    this.speed = 0;
    this.idle = 0;
    if (this.level.hint) this.clearGhostIfFor(this.level.hint.piece);
    sound.release();
    haptic('light');
    const arm = this.hookArm;
    if (arm && fromStart) {
      tween(0, arm.userData.side * 1.25, 0.32, (a) => arm.quaternion.setFromAxisAngle(arm.userData.axis, a), { ease: ease.outCubic, tag: 'hook' });
    }
  }

  private atStart() {
    return this.state.segId === startSegment(this.level).id && this.state.dir === 1 && this.state.dist === 0;
  }

  /** A tap on empty space while the ball waits: a gentle reminder of where to tap. */
  private nudgeBall() {
    tween(0, 1, 0.5, (x) => this.ball.scale.setScalar(1 + 0.08 * Math.sin(x * Math.PI)), { ease: ease.linear, tag: 'nudge' });
  }

  private rotate(pv: PieceView, dirn: 1 | -1 = 1, recordIt = true) {
    const blocked = !this.solid.canMove(pv.def.id, pv.committed, { ...pv.committed, r: pv.committed.r + dirn }, this.states(), this.ballObstacle());
    if (this.ballOn(pv.def.id) || blocked || this.falling) { pv.shake = 1; sound.bump(); haptic('tick'); return false; }
    const from = pv.committed.r;
    const to = (from + dirn + 4) % 4;
    pv.committed.r = to;
    pv.rot.target += dirn;
    pv.moving = true;
    this.clearGhostIfFor(pv.def.id);
    sound.rotate(to);
    haptic('light');
    if (recordIt) this.record({ type: 'rotate', id: pv.def.id, from, to });
    this.refreshJoins();
    return true;
  }

  /** Turn the world to the next/previous allowed view (GAME_PLAN §4.5). */
  turn(step: 1 | -1, recordIt = true) {
    const views = this.level.views;
    if (views.length < 2 || this.turning || this.peeking || this.overlayAfter > 0 || this.falling || this.won) return;
    const to = views[(views.indexOf(this.view) + step + views.length) % views.length];
    this.toView(to, recordIt);
  }

  private toView(to: number, recordIt: boolean) {
    const from = this.view;
    if (to === from) return;
    let delta = ((to - from) % 4 + 4) % 4;
    if (delta > 2) delta -= 4;
    this.turning = true;
    this.refreshJoins();
    sound.turn();
    if (recordIt) this.record({ type: 'view', from, to });
    const start = this.stage.angle;
    const reduce = reducedMotion();
    tween(start, start + delta, reduce ? 0.25 : 0.6, (a) => this.stage.setView(a), {
      ease: reduce ? ease.outCubic : ease.inOutCubic,
      tag: 'view',
      done: () => {
        this.stage.setView(to);
        this.view = to;
        this.turning = false;
        this.refreshJoins();
      },
    });
  }

  undo() {
    const a = this.undoStack.pop();
    if (!a || this.won) return;
    if (a.type === 'view') {
      if (this.turning) { this.undoStack.push(a); return; }
      this.toView(a.from, false);
    } else {
      const pv = this.pieces.get(a.id)!;
      if (this.ballOn(a.id)) { this.undoStack.push(a); pv.shake = 1; return; }
      if (a.type === 'slide') {
        if (!this.solid.canMove(a.id, pv.committed, { ...pv.committed, s: a.from }, this.states(), this.ballObstacle())) {
          this.undoStack.push(a); pv.shake = 1; sound.bump(); return;
        }
        pv.committed.s = a.from;
        pv.slide.target = a.from;
        pv.moving = true;
        this.refreshJoins();
      } else if (!this.rotate(pv, -1, false)) {
        this.undoStack.push(a);
        return;
      }
    }
    this.moves = Math.max(0, this.moves - 1);
    this.cb.onMoves(this.moves);
  }

  restart() {
    this.falling = null;
    this.undoStack = [];
    this.moves = 0;
    this.released = false;
    this.won = false;
    this.cb.onMoves(0);
    this.state.mode = 'resting';
    tween(this.ball.scale.x, 0.001, 0.25, (x) => this.ball.scale.setScalar(x), {
      ease: ease.inOutSine,
      done: () => {
        for (const pv of this.pieces.values()) {
          const init = { s: pv.def.slide?.initial ?? 0, r: pv.def.rotate?.initial ?? 0 };
          const dr = ((init.r - pv.committed.r) % 4 + 4) % 4;
          pv.committed = { ...init };
          pv.slide.target = init.s;
          pv.rot.target += dr > 2 ? dr - 4 : dr;
          pv.moving = pv.slide.x !== init.s || dr !== 0;
        }
        if (this.view !== this.level.startView) this.toView(this.level.startView, false);
        this.refreshJoins();
        this.state = this.startState();
        this.speed = 0;
        this.overlayAfter = 0;
        this.placeBall(true);
        this.lowerHook();
        tween(0.001, 1, 0.35, (x) => this.ball.scale.setScalar(x), { ease: ease.outCubic, delay: 0.1 });
      },
    });
    if (this.ring) {
      const m = this.ring.material as THREE.MeshBasicMaterial;
      tween(m.opacity, 0, 0.3, (x) => (m.opacity = x));
    }
  }

  private lowerHook() {
    const arm = this.hookArm;
    if (!arm) return;
    const current = 2 * Math.acos(Math.min(1, Math.abs(arm.quaternion.w))) * arm.userData.side;
    tween(current, 0, 0.45, (a) => arm.quaternion.setFromAxisAngle(arm.userData.axis, a), { ease: ease.inOutSine, tag: 'hook' });
  }

  /** Reveal the next move of a shortest solution from the current position (GAME_PLAN §5). */
  hint() {
    if (this.state.mode !== 'resting' || this.turning) return;
    const r = solve(this.level, { from: { states: this.states(), view: this.view, ball: { ...this.state } } });
    const m: Move | undefined = r.solution[0];
    this.idle = 0;
    if (!m) { this.cb.onTip('Try restarting this one'); return; }
    if (m.type === 'slide') this.showGhost(m.piece, { ...this.pieces.get(m.piece)!.committed, s: m.to }, 6);
    else if (m.type === 'rotate') this.showGhost(m.piece, { ...this.pieces.get(m.piece)!.committed, r: m.to }, 6);
    else if (m.type === 'view') this.cb.onTip('Swipe across empty space to turn the world');
    else { this.cb.onTip('Tap the ball'); this.nudgeBall(); }
  }

  // ---------------------------------------------------------------- frame

  update(dt: number) {
    this.time += dt;
    this.idle += dt;
    if (!this.hintShown && this.idle > HINT_IDLE && !this.won) { this.hintShown = true; this.cb.onHintAvailable(true); }
    this.timeScale = damp(this.timeScale, this.targetTimeScale, 6, dt);
    const sdt = dt * this.timeScale;
    updateTweens(sdt);
    this.updatePeek(dt);
    this.updatePieces(sdt);
    this.updateBall(this.peeking ? 0 : sdt);
    this.updateFx(dt);
  }

  private updatePeek(dt: number) {
    if (!this.peeking) return;
    const stage = this.stage;
    stage.peek = damp(stage.peek, this.peekTarget, reducedMotion() ? 14 : 7, dt);
    if (this.peekTarget === 0 && stage.peek < 0.01) {
      stage.peek = 0;
      this.peeking = false;
      this.refreshJoins();
    }
    if (!this.turning) stage.setView(stage.angle);
  }

  private applyPieceTransform(pv: PieceView) {
    if (pv.slideAxis) pv.outer.position.copy(pv.slideAxis).multiplyScalar(pv.slide.x);
    if (pv.rotAxis) pv.pivot.quaternion.setFromAxisAngle(pv.rotAxis, (pv.rot.x * Math.PI) / 2);
  }

  private updatePieces(dt: number) {
    for (const pv of this.pieces.values()) {
      const dragging = this.pointer?.piece === pv && this.pointer.dragging;
      if (!dragging && pv.moving) {
        // Critically damped: glides into place, never bounces.
        const a = stepSpring(pv.slide, 3.2, 1, dt);
        const b = stepSpring(pv.rot, 3.4, 1, dt);
        if (a && b) {
          pv.moving = false;
          pv.rot.x = pv.rot.target = pv.committed.r;
          sound.snap();
          haptic('light');
          this.refreshJoins();
        }
      }
      this.applyPieceTransform(pv);
      if (pv.shake > 0) {
        pv.shake = Math.max(0, pv.shake - dt * 2.5);
        pv.outer.position.x += Math.sin(this.time * 38) * 0.035 * pv.shake;
      }
    }
  }

  private updateBall(dt: number) {
    const world = this.world();
    if (this.falling) {
      this.updateFall(dt);
      return;
    }
    if (this.state.mode === 'rolling') {
      if (this.pauseFor > 0) {
        this.pauseFor -= dt;
      } else {
        const f = frameAt(this.segment(world, this.state.segId), this.state.dir, this.state.dist);
        const slope = f.t[1] < -0.5 ? 1.3 : f.t[1] > 0.5 ? 0.8 : 1;
        const next = upcoming(this.state, world);
        let target = CRUISE * slope;
        if (next.flag === 'goal' || next.flag === 'start') target *= Math.max(0.22, Math.min(1, next.remaining / 0.7));
        this.speed = damp(this.speed, target, this.speed < target ? 5 : 9, dt);
        this.lastSeg = this.state.segId;
        this.lastDir = this.state.dir;
        for (const ev of advance(this.state, world, this.speed * dt)) this.onBallEvent(ev);
      }
    }
    if (this.falling) return;
    const next = this.state.mode === 'rolling' ? upcoming(this.state, world) : null;
    const approaching = Boolean(next && next.k !== null && next.k !== 0 && next.remaining < 0.8);
    // Draw the ball at the depth of whichever side of a perceptual crossing is nearer the camera.
    // Sliding it along the view line doesn't move it on screen; it only changes what can hide it.
    const depthCopy = approaching ? Math.max(0, -next!.k!) : this.overlayAfter > 0 ? Math.max(0, this.crossK) : 0;
    this.placeBall(false, depthCopy);
    // Slow-mo for the very first perceptual crossing (GAME_PLAN L1 feedback).
    this.targetTimeScale = !this.firstCrossDone && !reducedMotion() && (approaching || this.overlayAfter > 0.3) ? 0.4 : 1;
    sound.roll(this.state.mode === 'rolling' ? this.speed / CRUISE : 0);
  }

  /**
   * Gravity with momentum. The ball keeps the speed it left the track with, accelerates down, and lands
   * exactly on its target (drawn at the landing's depth, so the fall is straight down the screen).
   * Lost balls fall away and fade; a respawn drops gently onto the start socket.
   */
  private updateFall(dt: number) {
    const f = this.falling!;
    f.t += dt;
    f.vel.y -= GRAVITY * dt;
    f.pos.addScaledVector(f.vel, dt);
    const landed = f.result !== 'lost' && f.pos.y <= f.to.y;
    if (landed) f.pos.copy(f.to);
    // Roll on while falling.
    const step = f.vel.clone().multiplyScalar(dt);
    this.tmpAxis.set(step.z, 0, -step.x);
    if (this.tmpAxis.lengthSq() > 1e-10) {
      this.tmpAxis.normalize();
      this.ballMesh.quaternion.premultiply(this.tmpQ.setFromAxisAngle(this.tmpAxis, Math.hypot(step.x, step.z) / BALL_R));
    }
    this.ball.position.copy(f.pos);
    // The contact shadow waits on the landing surface, sharpening as the ball comes down.
    const sh = this.ballShadow;
    sh.visible = f.result !== 'lost';
    if (sh.visible) {
      const h = Math.max(0, f.pos.y - f.to.y);
      sh.position.set(f.pos.x, f.to.y - BALL_R + 0.004, f.pos.z);
      sh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
      sh.scale.setScalar(1 / (1 + h * 0.6));
    }
    if (f.result === 'lost') {
      const fade = Math.min(1, Math.max(0, (f.t - 0.35) / 0.55));
      this.ball.scale.setScalar(Math.max(0.001, 1 - fade));
      if (f.t < 0.95) return;
      // Back to the start socket: appear just above it and drop gently in.
      this.lowerHook();
      this.ball.scale.setScalar(1);
      this.placeBall(true);
      const rest = this.lastBallPos.clone();
      this.falling = { pos: rest.clone().add(new THREE.Vector3(0, 1.4, 0)), vel: new THREE.Vector3(), to: rest, t: 0, result: 'drop-in' };
      sound.rest();
      return;
    }
    if (!landed) return;
    this.falling = null;
    sh.scale.setScalar(1);
    sh.visible = true;
    this.placeBall(true);
    this.squash(new THREE.Vector3(0, 1, 0), f.result === 'drop-in' ? 0.12 : 0.22);
    sound.land();
    haptic('light');
  }

  /** Brief volume-preserving squash along an axis (landing, bumps). */
  private squash(axis: THREE.Vector3, amount: number) {
    const g = this.ball;
    const a = new THREE.Vector3(Math.abs(axis.x), Math.abs(axis.y), Math.abs(axis.z));
    tween(1, 0, reducedMotion() ? 0.12 : 0.32, (k) => {
      const sq = 1 - amount * k, w = 1 / Math.sqrt(sq);
      g.scale.set(a.x > 0.5 ? sq : w, a.y > 0.5 ? sq : w, a.z > 0.5 ? sq : w);
    }, { ease: ease.outCubic, tag: 'squash' });
  }

  private onBallEvent(ev: BallEvent) {
    switch (ev.type) {
      case 'cross':
        if (ev.k !== 0) { this.overlayAfter = 0.9; this.crossK = ev.k; this.crossedOnce = true; }
        break;
      case 'bump': {
        this.speed = 0;
        this.pauseFor = 0.22;
        const f = frameAt(this.segment(this.world(), this.state.segId), this.state.dir, this.state.dist);
        // Squash against what it hit; a piece it hit wobbles and knocks, so the contact reads.
        this.squash(vec(f.t), ev.piece ? 0.2 : 0.14);
        const hitPiece = ev.piece ? this.pieces.get(ev.piece) : undefined;
        if (hitPiece) { hitPiece.shake = 0.7; sound.thock(0.8, 240); haptic('light'); }
        else { sound.bump(); haptic('tick'); }
        break;
      }
      case 'fall': {
        // Start the fall from the same screen point, at the landing's depth (moving along v is invisible).
        const pos = vec(ev.from).add(vec(VIEWS[this.view]).multiplyScalar(ev.k));
        const to = vec(ev.to);
        const exitSeg = this.segment(this.world(), this.lastSeg);
        const exit = frameAt(exitSeg, this.lastDir, lengthOf(exitSeg));
        const speed = Math.max(this.speed, 0.8);
        const vel = vec(exit.t).multiplyScalar(speed);
        if (ev.result !== 'lost') {
          // Solve the flight time for the drop, then aim the horizontal velocity at the landing point.
          const h = pos.y - to.y, vy = vel.y;
          const t = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * Math.max(h, 0.05))) / GRAVITY;
          vel.x = (to.x - pos.x) / t;
          vel.z = (to.z - pos.z) / t;
        }
        this.falling = { pos, vel, to, t: 0, result: ev.result };
        this.speed = ev.result === 'roll' ? speed * 0.6 : 0;
        this.overlayAfter = 0;
        sound.fall();
        break;
      }
      case 'rest':
        this.speed = 0;
        if (ev.pad) { sound.rest(); haptic('tick'); } else this.lowerHook();
        break;
      case 'goal':
        this.speed = 0;
        this.win();
        break;
    }
  }

  private win() {
    this.won = true;
    sound.win();
    haptic('light');
    this.timers.push(window.setTimeout(() => haptic('light'), 120));
    this.cb.onHintAvailable(false);
    if (this.ring) {
      const ring = this.ring, mat = ring.material as THREE.MeshBasicMaterial;
      tween(0, 1, 1.2, (x) => { ring.scale.setScalar(1 + x * 2.2); mat.opacity = 0.7 * (1 - x); }, { ease: ease.outSine });
    }
    this.timers.push(window.setTimeout(() => this.cb.onWin(this.moves, this.level.par), 1100));
  }

  private placeBall(snap = false, depthCopy = 0) {
    const f = frameAt(this.segment(this.world(), this.state.segId), this.state.dir, this.state.dist);
    const pos = vec(f.p), n = vec(f.n);
    const step = pos.clone().sub(this.lastBallPos);
    const d = step.length();
    // Big jumps are perceptual-join teleports (or restarts): no roll for those.
    if (!snap && d > 1e-6 && d < 0.5) {
      this.tmpAxis.crossVectors(n, step).normalize();
      this.tmpQ.setFromAxisAngle(this.tmpAxis, d / BALL_R);
      this.ballMesh.quaternion.premultiply(this.tmpQ);
      if (this.overlayAfter > 0) {
        this.overlayAfter = Math.max(0, this.overlayAfter - d);
        if (this.overlayAfter === 0 && this.crossedOnce) this.firstCrossDone = true;
      }
    }
    this.lastBallPos.copy(pos);
    const shown = pos.clone().add(vec(VIEWS[this.view]).multiplyScalar(depthCopy));
    this.ball.position.copy(shown);
    this.ballShadow.position.copy(shown).addScaledVector(n, -BALL_R + 0.004);
    this.ballShadow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  }

  private updateFx(dt: number) {
    for (const [o, v] of this.shift) {
      v.x = damp(v.x, v.target, 3.5, dt);
      for (const m of this.ownerMats.get(o) ?? []) m.uniforms.uDepthShift.value = v.x;
    }
    (this.bg.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
    const motes = this.motes.material as THREE.ShaderMaterial;
    motes.uniforms.uTime.value = this.time;
    motes.uniforms.uSize.value = 3 * Math.min(window.devicePixelRatio, 2);
    this.motes.visible = !reducedMotion();
    for (const s of this.seams.values()) s.mat.uniforms.uTime.value = this.time;
    // The ball breathes gently while it waits (~0.2 Hz).
    this.breathe = this.state.mode === 'resting' && !reducedMotion() && !this.won ? 1 : damp(this.breathe, 0, 6, dt);
    this.ballMesh.scale.setScalar(1 + 0.015 * this.breathe * Math.sin(this.time * Math.PI * 0.4));
    if (this.ghost) {
      const { id, st } = this.ghost.userData as { id: string; st: PieceState };
      const c = this.pieces.get(id)!.committed;
      const fade = (c.s === st.s && c.r === st.r) || this.time > this.ghostUntil;
      const mat = (this.ghost.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = damp(mat.opacity, fade ? 0 : 0.16 + 0.1 * Math.sin(this.time * Math.PI), 4, dt);
      if (fade && mat.opacity < 0.01) this.clearGhost();
    }
  }

  dispose() {
    cancelAllTweens();
    this.stage.peek = 0;
    sound.roll(0);
    for (const t of this.timers) clearTimeout(t);
    this.abort.abort();
    this.stage.scene.remove(this.root, this.bg, this.motes);
    for (const s of this.seams.values()) { s.mesh.geometry.dispose(); s.mat.dispose(); }
    for (const d of this.disposables) d.dispose();
  }

  // ---------------------------------------------------------------- test hooks

  debug() {
    return {
      state: () => ({ ...this.state, moves: this.moves, view: this.view, pieces: this.states() }),
      setPiece: (id: string, st: Partial<PieceState>) => {
        const pv = this.pieces.get(id)!;
        if (st.s !== undefined) { pv.committed.s = st.s; pv.slide.target = st.s; }
        if (st.r !== undefined) { pv.rot.target += (st.r - pv.committed.r + 4) % 4; pv.committed.r = st.r; }
        pv.moving = true;
      },
      turn: (step: 1 | -1) => this.turn(step),
      release: () => this.release(),
      solution: () => solve(this.level).solution,
      screenOf: (p: V3) => {
        const v = vec(p).project(this.stage.camera);
        return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
      },
      activeTweens,
    };
  }
}

/** Whether grid point p lies on a straight segment (endpoints included). */
function onStraight(seg: Segment, p: V3): boolean {
  if (seg.kind !== 'straight') return false;
  const d = manhattan(sub(p, seg.from));
  return d <= lengthOf(seg) && eq(add(seg.from, scale(AXES[seg.t0], d)), p);
}
