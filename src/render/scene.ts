// Renderer, true-isometric orthographic camera and fit-to-screen.
import * as THREE from 'three';
import { VIEWS } from '../core/grid';
import { camRight } from './materials';

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  private target = new THREE.Vector3();
  private halfExtent = { x: 5, y: 5 };
  private viewAngle = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: import.meta.env.DEV });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.setView(0);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Continuous view angle in quarter turns (0..4); integer values are the four views of §4.1. */
  setView(quarterTurns: number) {
    this.viewAngle = quarterTurns;
    const a = (-quarterTurns * Math.PI) / 2;
    const v0 = new THREE.Vector3(...VIEWS[0]).normalize();
    const dir = v0.applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
    this.camera.position.copy(this.target).addScaledVector(dir, 100);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    camRight.value.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
  }

  /** Fit a set of world points on screen with a comfortable margin, centred. */
  fit(points: THREE.Vector3[], margin = 1.35) {
    this.setView(this.viewAngle);
    const inv = this.camera.matrixWorldInverse;
    const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = min.clone().negate();
    for (const p of points) { const q = p.clone().applyMatrix4(inv); min.min(q); max.max(q); }
    const centerView = min.clone().add(max).multiplyScalar(0.5);
    // Move the target to the centre of the points (in view space x/y), keeping the view direction.
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.target.addScaledVector(right, centerView.x).addScaledVector(up, centerView.y);
    this.halfExtent = { x: ((max.x - min.x) / 2) * margin, y: ((max.y - min.y) / 2) * margin };
    this.setView(this.viewAngle);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    let hy = Math.max(this.halfExtent.y, this.halfExtent.x / aspect);
    hy = Math.max(hy, 2);
    this.camera.top = hy;
    this.camera.bottom = -hy;
    this.camera.left = -hy * aspect;
    this.camera.right = hy * aspect;
    this.camera.updateProjectionMatrix();
  }

  /** World units per CSS pixel. */
  get unitsPerPixel() {
    return (this.camera.top - this.camera.bottom) / window.innerHeight;
  }

  /** Screen-space (CSS px, y down) direction and length of a world vector. */
  screenVector(world: THREE.Vector3) {
    const a = new THREE.Vector3().project(this.camera);
    const b = world.clone().project(this.camera);
    return new THREE.Vector2(((b.x - a.x) * window.innerWidth) / 2, (-(b.y - a.y) * window.innerHeight) / 2);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
