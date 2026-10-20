// Renderer, true-isometric orthographic camera, view turns and fit-to-screen.
import * as THREE from 'three';
import { camRight } from './materials';

const Y = new THREE.Vector3(0, 1, 0);

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  private target = new THREE.Vector3();
  private halfExtent = { x: 5, y: 5 };
  /** Continuous view angle in quarter turns; integers are the four views of GAME_PLAN §4.1. */
  angle = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: import.meta.env.DEV });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.setView(0);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Unit vector from the target toward the camera for a (possibly fractional) view angle. */
  viewDir(quarterTurns: number) {
    return new THREE.Vector3(1, 1, 1).normalize().applyAxisAngle(Y, (quarterTurns * Math.PI) / 2);
  }

  setView(quarterTurns: number) {
    this.angle = quarterTurns;
    this.camera.position.copy(this.target).addScaledVector(this.viewDir(quarterTurns), 100);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    camRight.value.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
  }

  /** Fit the points on screen in every view the level allows, so turning never changes the zoom. */
  fit(points: THREE.Vector3[], views: number[], margin = 1.12) {
    const box = new THREE.Box3().setFromPoints(points);
    box.getCenter(this.target);
    if (views.length === 1) {
      // Single view: centre the level's on-screen footprint, not its 3D box.
      this.setView(views[0]);
      const inv = this.camera.matrixWorldInverse;
      const sb = new THREE.Box3().setFromPoints(points.map((p) => p.clone().applyMatrix4(inv)));
      const c = sb.getCenter(new THREE.Vector3()).applyMatrix4(this.camera.matrixWorld);
      this.target.copy(c);
    }
    let hx = 0, hy = 0;
    for (const v of views) {
      this.setView(v);
      const inv = this.camera.matrixWorldInverse;
      const c = this.target.clone().applyMatrix4(inv);
      for (const p of points) {
        const q = p.clone().applyMatrix4(inv).sub(c);
        hx = Math.max(hx, Math.abs(q.x));
        hy = Math.max(hy, Math.abs(q.y));
      }
    }
    this.halfExtent = { x: hx * margin, y: hy * margin };
    this.setView(this.angle);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
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
