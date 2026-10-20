// Renderer, true-isometric orthographic camera, view turns and fit-to-screen.
import * as THREE from 'three';
import { camRight, depthUniforms } from './materials';

const Y = new THREE.Vector3(0, 1, 0);

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  private target = new THREE.Vector3();
  private halfExtent = { x: 5, y: 5 };
  /** Continuous view angle in quarter turns; integers are the four views of GAME_PLAN §4.1. */
  angle = 0;
  /** 0 = exact isometric, 1 = fully tilted "peek" that shows the true depth. */
  peek = 0;
  /** The level light: mostly overhead, so a floating piece's shadow lands on whatever is really below it. */
  readonly light = new THREE.DirectionalLight(0xffffff, 1);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: import.meta.env.DEV });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    this.light.shadow.bias = -0.0006;
    this.light.shadow.normalBias = 0.03;
    this.light.shadow.radius = 4;
    this.scene.add(this.light, this.light.target);
    this.setView(0);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Unit vector from the target toward the camera for a (possibly fractional) view angle. */
  viewDir(quarterTurns: number, peek = 0) {
    const d = new THREE.Vector3(1, 1, 1).normalize().applyAxisAngle(Y, (quarterTurns * Math.PI) / 2 + peek * 0.32);
    // Peeking lowers the camera toward the horizon, which pulls depth apart on screen.
    const right = new THREE.Vector3().crossVectors(Y, d).normalize();
    return d.applyAxisAngle(right, -peek * 0.38);
  }

  setView(quarterTurns: number) {
    this.angle = quarterTurns;
    if (this.frames.size) {
      const lo = Math.floor(quarterTurns), f = quarterTurns - lo;
      const a = this.frames.get(((lo % 4) + 4) % 4)!, b = this.frames.get((((lo + 1) % 4) + 4) % 4)!;
      const e = f * f * (3 - 2 * f);
      this.target.lerpVectors(a.target, b.target, e);
      this.halfExtent = { x: a.hx + (b.hx - a.hx) * e, y: a.hy + (b.hy - a.hy) * e };
      this.resize();
    }
    this.place(quarterTurns);
  }

  private place(quarterTurns: number) {
    const dir = this.viewDir(quarterTurns, this.peek);
    this.camera.position.copy(this.target).addScaledVector(dir, 100);
    depthUniforms.uViewDir.value.copy(dir);
    depthUniforms.uTarget.value.copy(this.target);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    camRight.value.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
  }

  /** Per-view framing: each view centres and zooms on the level; a turn blends between them. */
  private frames = new Map<number, { target: THREE.Vector3; hx: number; hy: number }>();

  /** Fit the level in each view it allows (tight, centred), so every view is framed well. */
  fit(points: THREE.Vector3[], views: number[], margin = 1.12) {
    const box = new THREE.Box3().setFromPoints(points);
    this.frames.clear();
    for (let v = 0; v < 4; v++) {
      this.target.copy(box.getCenter(new THREE.Vector3()));
      this.place(v);
      const inv = this.camera.matrixWorldInverse;
      const sb = new THREE.Box3().setFromPoints(points.map((p) => p.clone().applyMatrix4(inv)));
      const target = sb.getCenter(new THREE.Vector3()).applyMatrix4(this.camera.matrixWorld);
      const size = sb.getSize(new THREE.Vector3());
      this.frames.set(v, { target, hx: (size.x / 2) * margin, hy: (size.y / 2) * margin });
    }
    void views;
    this.setView(this.angle);
    // Depth-tint range and the shadow camera both follow the level's box.
    const r = box.getSize(new THREE.Vector3()).length() / 2 + 1;
    depthUniforms.uDepthNear.value = r * 0.55;
    depthUniforms.uDepthFar.value = -r * 0.85;
    const c = box.getCenter(new THREE.Vector3());
    this.light.position.copy(c).add(new THREE.Vector3(-2.5, 20, -4));
    this.light.target.position.copy(c);
    const cam = this.light.shadow.camera;
    cam.left = cam.bottom = -r;
    cam.right = cam.top = r;
    cam.near = 1;
    cam.far = 40;
    cam.updateProjectionMatrix();
  }

  private lastSize = '';

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    // Only touch the drawing buffer when the window really changed (this runs every frame during turns).
    if (this.lastSize !== `${w}x${h}`) { this.lastSize = `${w}x${h}`; this.renderer.setSize(w, h, false); }
    const aspect = w / h;
    // Leave room for the HUD: the scene uses the middle ~78% of a portrait screen.
    let hy = Math.max(this.halfExtent.y, this.halfExtent.x / aspect) / 0.78;
    hy = Math.max(hy, 2.5);
    this.camera.top = hy;
    this.camera.bottom = -hy;
    this.camera.left = -hy * aspect;
    this.camera.right = hy * aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Screen-space (CSS px, y down) vector for a world direction. */
  screenVector(world: THREE.Vector3) {
    const a = new THREE.Vector3().project(this.camera);
    const b = world.clone().project(this.camera);
    return new THREE.Vector2(((b.x - a.x) * window.innerWidth) / 2, (-(b.y - a.y) * window.innerHeight) / 2);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
