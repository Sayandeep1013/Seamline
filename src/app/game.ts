// Level controller: builds the scene from level data, runs input, the ball and feedback.
import * as THREE from 'three';
import { type BallEvent, type BallState, advance, upcoming } from '../core/ball';
import { AXES, VIEWS, type V3 } from '../core/grid';
import { type JoinWorld, findContinuation } from '../core/joins';
import {
  type LevelDef, type PieceDef, type PieceStops, baseSegments, initialStops, resolveSegments, slideAxis, startSegment,
} from '../core/level';
import { type Segment, exitOf, pointAt, tangentOf } from '../core/track';
import { damp, ease, reducedMotion, stepSpring, tween, updateTweens, activeTweens, type Spring } from '../anim/motion';
import { haptic, sound } from '../audio/sound';
import {
  BALL_R, BEAM_D, BEAM_W, beamGeometry, bowlParts, frameOf, hookParts, nubGeometry, seamGeometry,
} from '../render/geometry';
import {
  backgroundMesh, ballMaterial, blobShadowMaterial, dustMotes, seamGlowMaterial, toneMaterial,
} from '../render/materials';
import { PALETTES } from '../render/palette';
import type { Stage } from '../render/scene';

const CRUISE = 2.0;          // tiles per second
const RUBBER = 0.45;         // rubber-band length past the rail ends
const DRAG_SLOP = 8;         // px before a tap becomes a drag

interface PieceView {
  def: PieceDef;
  group: THREE.Group;
  hit: THREE.Mesh;
  axis: THREE.Vector3;
  stops: number[];
  committed: number;
  spring: Spring;
  moving: boolean;
  lastDetent: number;
  shake: number;
}

interface SeamView { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; follow: string | null; intensity: number }

export interface GameCallbacks {
  onWin(moves: number, par: number): void;
  onMovesChanged(moves: number): void;
}

export class Game {
  private level: LevelDef;
  private pal;
  private root = new THREE.Group();
  private pieces = new Map<string, PieceView>();
  private caps = new Map<string, [THREE.Mesh, THREE.Mesh]>();
  private seams = new Map<string, SeamView>();
  private ball!: THREE.Group;
  private ballMesh!: THREE.Mesh;
  private ballShadow!: THREE.Mesh;
  private ballHit!: THREE.Mesh;
  private hookArm!: THREE.Mesh;
  private hookSide: 1 | -1 = 1;
  private ghost: THREE.Mesh | null = null;
  private ring!: THREE.Mesh;
  private motes!: THREE.Points;
  private bg!: THREE.Mesh;
  private state: BallState;
  private speed = 0;
  private pauseFor = 0;
  private overlayAfter = 0;
  private released = false;
  private firstCrossDone = false;
  private crossedOnce = false;
  private time = 0;
  private timeScale = 1;
  private targetTimeScale = 1;
  private moves = 0;
  private undoStack: { id: string; from: number; to: number }[] = [];
  private breathe = 0;
  private drag: { piece: PieceView | null; start: THREE.Vector2; startValue: number; screenAxis: THREE.Vector2; dragging: boolean; pointerId: number } | null = null;
  private raycaster = new THREE.Raycaster();
  private tmpQ = new THREE.Quaternion();
  private tmpAxis = new THREE.Vector3();
  private tmpV = new THREE.Vector3();
  private lastBallPos = new THREE.Vector3();

  constructor(private stage: Stage, level: LevelDef, private cb: GameCallbacks) {
    this.level = level;
    this.pal = PALETTES[level.palette] ?? PALETTES.mustard;
    this.state = this.startState();
    this.build();
    this.bindInput();
  }

  // ---------------------------------------------------------------- build

  private startState(): BallState {
    return { segId: startSegment(this.level).id, dir: 1, dist: 0, mode: 'resting' };
  }

  private build() {
    const p = this.pal;
    const stage = this.stage;
    this.bg = backgroundMesh(p);
    stage.scene.add(this.bg, this.root);
    const tone = toneMaterial(p.top, p.left, p.right);
    const v0 = new THREE.Vector3(...VIEWS[this.level.startView]);
    const fitPoints: THREE.Vector3[] = [];

    for (const seg of baseSegments(this.level)) {
      const geo = beamGeometry(seg);
      const group = new THREE.Group();
      const body = new THREE.Mesh(geo.body, tone);
      const caps: [THREE.Mesh, THREE.Mesh] = [new THREE.Mesh(geo.caps[0], tone), new THREE.Mesh(geo.caps[1], tone)];
      group.add(body, ...caps);
      this.caps.set(seg.id, caps);
      this.root.add(group);
      geo.body.computeBoundingBox();
      const bb = geo.body.boundingBox!;

      const piece = this.level.pieces.find((d) => d.id === seg.id);
      if (piece) {
        const f = frameOf(seg);
        const side: 1 | -1 = f.w.dot(v0) >= 0 ? 1 : -1;
        group.add(new THREE.Mesh(nubGeometry(seg, side), tone));
        const hitGeo = new THREE.BoxGeometry(bb.max.x - bb.min.x + 0.6, bb.max.y - bb.min.y + 0.6, bb.max.z - bb.min.z + 0.6);
        const c = bb.getCenter(new THREE.Vector3());
        hitGeo.translate(c.x, c.y, c.z);
        const hit = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
        group.add(hit);
        const axis = new THREE.Vector3(...slideAxis(piece.move));
        group.position.copy(axis).multiplyScalar(piece.move.initial);
        this.addRail(seg, piece, axis);
        for (const s of piece.move.stops) {
          fitPoints.push(bb.min.clone().addScaledVector(axis, s), bb.max.clone().addScaledVector(axis, s));
        }
        this.pieces.set(piece.id, {
          def: piece, group, hit, axis, stops: [...piece.move.stops].sort((a, b) => a - b),
          committed: piece.move.initial, spring: { x: piece.move.initial, v: 0, target: piece.move.initial },
          moving: false, lastDetent: piece.move.initial, shake: 0,
        });
      } else {
        fitPoints.push(bb.min.clone(), bb.max.clone());
      }

      if (seg.ends[0] === 'start') this.buildHook(seg, v0, tone);
      if (seg.ends[1] === 'goal' || seg.ends[0] === 'goal') this.buildBowl(seg, group);
    }

    this.buildBall();
    this.buildHint();

    const box = new THREE.Box3().setFromPoints(fitPoints);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).addScalar(6);
    this.motes = dustMotes(p, center, size);
    stage.scene.add(this.motes);
    stage.fit(fitPoints);
    this.refreshJoins(true);
    this.placeBall();
  }

  private addRail(seg: Segment, piece: PieceDef, axis: THREE.Vector3) {
    const f = frameOf(seg);
    const mid = f.from.clone().addScaledVector(f.t, f.len / 2).addScaledVector(f.n, -BALL_R - BEAM_D - 0.18);
    const mat = new THREE.MeshBasicMaterial({ color: this.pal.rail, transparent: true, opacity: 0.5, depthWrite: false });
    const geo = new THREE.SphereGeometry(0.055, 10, 8);
    const lo = Math.min(...piece.move.stops), hi = Math.max(...piece.move.stops);
    for (let s = lo; s <= hi + 1e-6; s += 0.25) {
      const isStop = piece.move.stops.some((x) => Math.abs(x - s) < 1e-6);
      const dot = new THREE.Mesh(geo, mat);
      dot.scale.setScalar(isStop ? 1.3 : 0.55);
      dot.position.copy(mid).addScaledVector(axis, s);
      this.root.add(dot);
    }
  }

  private buildHook(seg: Segment, v0: THREE.Vector3, tone: THREE.ShaderMaterial) {
    const f = frameOf(seg);
    this.hookSide = f.w.dot(v0) >= 0 ? 1 : -1;
    const h = hookParts(seg, this.hookSide);
    const post = new THREE.Mesh(h.post, tone);
    post.position.copy(h.postAt);
    const arm = new THREE.Mesh(h.arm, tone);
    arm.position.copy(h.pivot);
    this.hookArm = arm;
    this.hookArm.userData.axis = h.hingeAxis;
    this.root.add(post, arm);
  }

  private buildBowl(seg: Segment, group: THREE.Group) {
    const p = this.pal;
    const at = seg.ends[1] === 'goal' ? seg.to : seg.from;
    const parts = bowlParts(at, frameOf(seg).n);
    const bowlMat = toneMaterial(p.bowlTop, p.bowlLeft, p.bowlRight);
    bowlMat.side = THREE.DoubleSide;
    const rimMat = toneMaterial('#E2BE3F', p.bowlRim, '#A9871C');
    group.add(new THREE.Mesh(parts.bowl, bowlMat), new THREE.Mesh(parts.rim, rimMat));
    const ringGeo = new THREE.RingGeometry(0.38, 0.44, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: p.glow, transparent: true, opacity: 0, depthWrite: false, depthTest: false,
    }));
    this.ring.renderOrder = 15;
    this.ring.position.copy(parts.surface).addScaledVector(frameOf(seg).n, 0.16);
    group.add(this.ring);
  }

  private buildBall() {
    this.ball = new THREE.Group();
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 40, 28), ballMaterial(this.pal, BALL_R));
    this.ballShadow = new THREE.Mesh(new THREE.PlaneGeometry(BALL_R * 2.6, BALL_R * 2.6), blobShadowMaterial(this.pal.shadow));
    this.ballHit = new THREE.Mesh(new THREE.SphereGeometry(0.75, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    this.ball.add(this.ballMesh, this.ballHit);
    this.root.add(this.ball, this.ballShadow);
  }

  private buildHint() {
    const h = this.level.hint[0];
    if (!h) return;
    const pv = this.pieces.get(h.piece);
    if (!pv) return;
    const seg = baseSegments(this.level).find((s) => s.id === h.piece)!;
    const geo = beamGeometry(seg, 0.02);
    const mat = new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0, depthWrite: false });
    this.ghost = new THREE.Mesh(geo.body, mat);
    this.ghost.position.copy(pv.axis).multiplyScalar(h.slideTo);
    this.ghost.renderOrder = 5;
    this.root.add(this.ghost);
  }

  // ---------------------------------------------------------------- rules glue

  private world(): JoinWorld {
    const stops: PieceStops = initialStops(this.level);
    const moving = new Set<string>();
    for (const [id, pv] of this.pieces) { stops[id] = pv.committed; if (pv.moving) moving.add(id); }
    return { segments: resolveSegments(this.level, stops), view: this.level.startView, moving };
  }

  private segment(id: string): Segment {
    return this.world().segments.find((s) => s.id === id)!;
  }

  /** Show seam glows for every active perceptual join and hide the end caps of joined ends. */
  private refreshJoins(initial = false) {
    const world = this.world();
    const active = new Set<string>();
    for (const [, caps] of this.caps) caps.forEach((c) => (c.visible = true));
    for (const seg of world.segments) {
      if (seg.pieceId && world.moving.has(seg.pieceId)) continue;
      for (const dir of [1, -1] as const) {
        const exit = exitOf(seg, dir);
        if (exit.flag !== 'open') continue;
        const c = findContinuation(world, exit, seg);
        if (!c) continue;
        this.caps.get(seg.id)![dir === 1 ? 1 : 0].visible = false;
        this.caps.get(c.seg.id)![c.dir === 1 ? 0 : 1].visible = false;
        if (c.k === 0) continue;
        const key = [seg.id, c.seg.id].sort().join('|');
        if (active.has(key)) continue;
        active.add(key);
        if (!this.seams.has(key)) this.addSeam(key, seg, dir, initial);
      }
    }
    for (const [key, s] of this.seams) {
      if (active.has(key)) continue;
      this.seams.delete(key);
      tween(s.intensity, 0, 0.25, (x) => (s.mat.uniforms.uIntensity.value = x), {
        done: () => { this.root.remove(s.mesh); s.mesh.geometry.dispose(); s.mat.dispose(); },
      });
    }
  }

  private addSeam(key: string, seg: Segment, dir: 1 | -1, initial: boolean) {
    // Build the glow on the base segment, then follow the piece's offset via the group.
    const base = baseSegments(this.level).find((s) => s.id === seg.id)!;
    const sg = seamGeometry(base, dir === 1 ? frameOf(base).len : 0);
    const mat = seamGlowMaterial(this.pal.glow);
    const v = new THREE.Vector3(...VIEWS[this.level.startView]);
    mat.uniforms.uSide.value = sg.w.dot(v) >= 0 ? 1 : 0;
    mat.uniforms.uAspect.value = sg.aspect;
    const mesh = new THREE.Mesh(sg.geometry, mat);
    mesh.renderOrder = 10;
    const pv = seg.pieceId ? this.pieces.get(seg.pieceId) : null;
    if (pv) mesh.position.copy(pv.group.position);
    this.root.add(mesh);
    const view: SeamView = { mesh, mat, follow: seg.pieceId, intensity: 0 };
    this.seams.set(key, view);
    const set = (x: number) => { view.intensity = x; mat.uniforms.uIntensity.value = x; };
    if (initial) { set(0.35); return; }
    // Single soft flare (well under the 3-flashes-per-second limit), then settle.
    tween(0, 0.9, 0.4, set, { ease: ease.outCubic, done: () => tween(0.9, 0.35, 1.2, set, { ease: ease.inOutSine }) });
    sound.join();
    haptic(10);
  }

  // ---------------------------------------------------------------- input

  private bindInput() {
    const el = this.stage.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
    el.addEventListener('lostpointercapture', (e) => this.onUp(e));
  }

  private pick(e: PointerEvent): THREE.Object3D | null {
    const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    const targets: THREE.Object3D[] = [this.ballHit, ...[...this.pieces.values()].map((p) => p.hit)];
    const hits = this.raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    // Prefer the ball when it's under the finger: it's small and the main tap target.
    return hits.find((h) => h.object === this.ballHit)?.object ?? hits[0].object;
  }

  private onDown(e: PointerEvent) {
    sound.unlock();
    sound.startPad();
    const obj = this.pick(e);
    const piece = [...this.pieces.values()].find((p) => p.hit === obj) ?? null;
    const start = new THREE.Vector2(e.clientX, e.clientY);
    const screenAxis = piece ? this.stage.screenVector(piece.axis) : new THREE.Vector2();
    this.drag = { piece, start, startValue: piece ? piece.spring.x : 0, screenAxis, dragging: false, pointerId: e.pointerId };
    if (obj === this.ballHit) this.drag.piece = null;
    this.stage.renderer.domElement.setPointerCapture(e.pointerId);
  }

  private onMove(e: PointerEvent) {
    const d = this.drag;
    if (!d || !d.piece || e.pointerId !== d.pointerId) return;
    const delta = new THREE.Vector2(e.clientX, e.clientY).sub(d.start);
    if (!d.dragging) {
      if (delta.length() < DRAG_SLOP) return;
      if (this.ballOn(d.piece.def.id)) { d.piece.shake = 1; this.drag = null; sound.bump(); return; }
      d.dragging = true;
      d.piece.moving = true;
      this.refreshJoins();
    }
    const pv = d.piece;
    const units = delta.dot(d.screenAxis) / d.screenAxis.lengthSq();
    const raw = d.startValue + units;
    const lo = pv.stops[0], hi = pv.stops[pv.stops.length - 1];
    let value = raw;
    if (raw > hi) value = hi + RUBBER * (1 - Math.exp(-(raw - hi) / RUBBER));
    if (raw < lo) value = lo - RUBBER * (1 - Math.exp(-(lo - raw) / RUBBER));
    pv.spring.x = value;
    pv.spring.target = value;
    pv.spring.v = 0;
    // Detent tick each time the piece passes a stop.
    const nearest = this.nearestStop(pv, value);
    if (nearest !== pv.lastDetent && Math.abs(value - nearest) < 0.2) {
      pv.lastDetent = nearest;
      sound.tick(pv.stops.indexOf(nearest));
      haptic(4);
    }
  }

  private onUp(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = null;
    if (d.dragging && d.piece) {
      const pv = d.piece;
      const target = this.nearestStop(pv, Math.min(Math.max(pv.spring.x, pv.stops[0]), pv.stops[pv.stops.length - 1]));
      pv.spring.target = target;
      if (target !== pv.committed) {
        this.undoStack.push({ id: pv.def.id, from: pv.committed, to: target });
        this.addMove();
      }
      pv.committed = target;
      return;
    }
    // A tap: release the ball from the start.
    const moved = new THREE.Vector2(e.clientX, e.clientY).distanceTo(d.start);
    if (moved < DRAG_SLOP) this.tryRelease();
  }

  private nearestStop(pv: PieceView, value: number) {
    return pv.stops.reduce((best, s) => (Math.abs(s - value) < Math.abs(best - value) ? s : best), pv.stops[0]);
  }

  private ballOn(pieceId: string) {
    return this.segment(this.state.segId).pieceId === pieceId && this.state.mode !== 'resting';
  }

  private addMove() {
    this.moves++;
    this.cb.onMovesChanged(this.moves);
  }

  // ---------------------------------------------------------------- actions

  tryRelease() {
    if (this.state.mode !== 'resting') return;
    if (this.released) this.addMove(); // releases after the first count as moves
    this.released = true;
    this.state.mode = 'rolling';
    this.speed = 0;
    sound.release();
    haptic(6);
    const arm = this.hookArm;
    const axis = arm.userData.axis as THREE.Vector3;
    tween(0, this.hookSide * 1.25, 0.32, (a) => arm.quaternion.setFromAxisAngle(axis, a), { ease: ease.outCubic, tag: 'hook' });
  }

  private lowerHook() {
    const arm = this.hookArm;
    const axis = arm.userData.axis as THREE.Vector3;
    const current = 2 * Math.acos(Math.min(1, Math.abs(arm.quaternion.w))) * this.hookSide;
    tween(current, 0, 0.45, (a) => arm.quaternion.setFromAxisAngle(axis, a), { ease: ease.inOutSine, tag: 'hook' });
  }

  undo() {
    const last = this.undoStack.pop();
    if (!last) return;
    const pv = this.pieces.get(last.id)!;
    if (this.ballOn(last.id)) { this.undoStack.push(last); pv.shake = 1; return; }
    pv.committed = last.from;
    pv.spring.target = last.from;
    pv.moving = true;
    this.addMove();
  }

  restart() {
    this.undoStack = [];
    this.moves = 0;
    this.released = false;
    this.cb.onMovesChanged(0);
    this.state.mode = 'resting'; // freeze the ball where it is while it fades out
    tween(this.ball.scale.x, 0.001, 0.25, (x) => this.ball.scale.setScalar(x), {
      ease: ease.inOutSine,
      done: () => {
        for (const pv of this.pieces.values()) {
          pv.committed = pv.def.move.initial;
          pv.spring.target = pv.def.move.initial;
          pv.moving = pv.spring.x !== pv.def.move.initial;
        }
        this.refreshJoins();
        this.state = this.startState();
        this.speed = 0;
        this.overlayAfter = 0;
        this.placeBall();
        this.lowerHook();
        tween(0.001, 1, 0.35, (x) => this.ball.scale.setScalar(x), { ease: ease.outCubic, delay: 0.1 });
      },
    });
    const ringMat = this.ring.material as THREE.MeshBasicMaterial;
    tween(ringMat.opacity, 0, 0.3, (x) => (ringMat.opacity = x));
  }

  // ---------------------------------------------------------------- frame

  update(dt: number) {
    this.time += dt;
    this.timeScale = damp(this.timeScale, this.targetTimeScale, 6, dt);
    const sdt = dt * this.timeScale;
    updateTweens(sdt);
    this.updatePieces(sdt);
    this.updateBall(sdt);
    this.updateFx(dt);
  }

  private updatePieces(dt: number) {
    for (const pv of this.pieces.values()) {
      const dragging = this.drag?.piece === pv && this.drag.dragging;
      if (!dragging && pv.moving) {
        // Critically damped: glides into the stop, never bounces.
        const rest = stepSpring(pv.spring, 3.2, 1, dt);
        if (rest) {
          pv.moving = false;
          sound.snap();
          haptic(6);
          this.refreshJoins();
        }
      }
      pv.group.position.copy(pv.axis).multiplyScalar(pv.spring.x);
      if (pv.shake > 0) {
        pv.shake = Math.max(0, pv.shake - dt * 2.5);
        const s = Math.sin(this.time * 38) * 0.035 * pv.shake;
        pv.group.position.addScaledVector(pv.axis, s);
      }
      for (const seam of this.seams.values()) {
        if (seam.follow === pv.def.id) seam.mesh.position.copy(pv.group.position);
      }
    }
  }

  private updateBall(dt: number) {
    const world = this.world();
    if (this.state.mode === 'rolling') {
      if (this.pauseFor > 0) {
        this.pauseFor -= dt;
      } else {
        const seg = world.segments.find((s) => s.id === this.state.segId)!;
        const t = AXES[exitOf(seg, this.state.dir).t];
        const slope = t[1] < 0 ? 1.3 : t[1] > 0 ? 0.8 : 1;
        const next = upcoming(this.state, world);
        let target = CRUISE * slope;
        if (next.flag === 'goal' || next.flag === 'start') target *= Math.max(0.22, Math.min(1, next.remaining / 0.7));
        this.speed = damp(this.speed, target, this.speed < target ? 5 : 9, dt);
        const events = advance(this.state, world, this.speed * dt);
        for (const ev of events) this.onBallEvent(ev);
      }
    }
    this.placeBall();
    // Slow-mo for the very first perceptual crossing (GAME_PLAN L1 feedback).
    const next = this.state.mode === 'rolling' ? upcoming(this.state, world) : null;
    const approaching = next && next.k !== null && next.k !== 0 && next.remaining < 0.8;
    this.targetTimeScale = !this.firstCrossDone && !reducedMotion() && (approaching || this.overlayAfter > 0.3) ? 0.4 : 1;
    // Draw the ball on top while it's crossing a perceptual join, so it never clips into geometry.
    this.setOverlay(Boolean(approaching) || this.overlayAfter > 0);
  }

  private onBallEvent(ev: BallEvent) {
    switch (ev.type) {
      case 'cross':
        if (ev.k !== 0) { this.overlayAfter = 0.9; this.crossedOnce = true; }
        break;
      case 'bump':
        this.speed = 0;
        this.pauseFor = 0.18;
        sound.bump();
        haptic(5);
        break;
      case 'rest':
        this.speed = 0;
        this.lowerHook();
        break;
      case 'goal':
        this.speed = 0;
        this.win();
        break;
    }
  }

  private win() {
    sound.win();
    haptic(8);
    setTimeout(() => haptic(8), 120);
    const ring = this.ring;
    const mat = ring.material as THREE.MeshBasicMaterial;
    tween(0, 1, 1.2, (x) => { ring.scale.setScalar(1 + x * 2.2); mat.opacity = 0.7 * (1 - x); }, { ease: ease.outSine });
    setTimeout(() => this.cb.onWin(this.moves, this.level.par), 1100);
  }

  private placeBall() {
    const world = this.world();
    const seg = world.segments.find((s) => s.id === this.state.segId)!;
    const p = pointAt(seg, this.state.dir, this.state.dist);
    const pos = this.tmpV.set(p[0], p[1], p[2]);
    const n = new THREE.Vector3(...AXES[seg.n]);
    // Roll: rotation axis = n × direction, angle = distance / radius.
    const step = pos.clone().sub(this.lastBallPos);
    const d = step.length();
    // Big jumps are perceptual-join teleports (or restarts): no roll for those.
    if (d > 1e-6 && d < 0.5) {
      this.tmpAxis.crossVectors(n, step).normalize();
      this.tmpQ.setFromAxisAngle(this.tmpAxis, d / BALL_R);
      this.ballMesh.quaternion.premultiply(this.tmpQ);
      if (this.overlayAfter > 0) {
        this.overlayAfter = Math.max(0, this.overlayAfter - d);
        if (this.overlayAfter === 0 && this.crossedOnce) this.firstCrossDone = true;
      }
    }
    this.lastBallPos.copy(pos);
    this.ball.position.copy(pos);
    this.ballShadow.position.copy(pos).addScaledVector(n, -BALL_R + 0.004);
    this.ballShadow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  }

  private setOverlay(on: boolean) {
    const m = this.ballMesh.material as THREE.ShaderMaterial;
    const s = this.ballShadow.material as THREE.MeshBasicMaterial;
    if (m.depthTest === !on) return;
    m.depthTest = !on;
    s.depthTest = !on;
    this.ballMesh.renderOrder = on ? 20 : 0;
    this.ballShadow.renderOrder = on ? 19 : 0;
  }

  private updateFx(dt: number) {
    (this.bg.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
    const motes = this.motes.material as THREE.ShaderMaterial;
    motes.uniforms.uTime.value = this.time;
    motes.uniforms.uSize.value = 3 * Math.min(window.devicePixelRatio, 2);
    this.motes.visible = !reducedMotion();
    for (const s of this.seams.values()) s.mat.uniforms.uTime.value = this.time;
    // Ball breathing while it waits (tiny, ~0.2 Hz).
    this.breathe = this.state.mode === 'resting' && !reducedMotion() ? 1 : damp(this.breathe, 0, 6, dt);
    this.ballMesh.scale.setScalar(1 + 0.015 * this.breathe * Math.sin(this.time * Math.PI * 0.4));
    if (this.ghost) {
      const pv = this.pieces.get(this.level.hint[0].piece)!;
      const done = pv.committed === this.level.hint[0].slideTo || this.state.mode !== 'resting' || this.released;
      const target = done ? 0 : 0.14 + 0.1 * Math.sin(this.time * Math.PI);
      const mat = this.ghost.material as THREE.MeshBasicMaterial;
      mat.opacity = damp(mat.opacity, target, 4, dt);
    }
  }

  // ---------------------------------------------------------------- test hooks

  debug() {
    return {
      state: () => ({ ...this.state, moves: this.moves, stops: Object.fromEntries([...this.pieces].map(([k, p]) => [k, p.committed])) }),
      setStop: (id: string, stop: number) => {
        const pv = this.pieces.get(id)!;
        pv.committed = stop; pv.spring.target = stop; pv.moving = true;
      },
      release: () => this.tryRelease(),
      activeTweens,
      tangent: (id: string) => tangentOf(this.segment(id)),
      beam: { w: BEAM_W, d: BEAM_D, r: BALL_R },
    };
  }

  /** Point (in screen px) of a world grid position — for e2e tests. */
  screenOf(p: V3) {
    const v = new THREE.Vector3(...p).project(this.stage.camera);
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
  }
}
