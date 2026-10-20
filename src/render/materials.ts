// Shaders: three-tone face shading, toon ball, seam glow, background gradient, dust motes.
import * as THREE from 'three';
import type { Palette } from './palette';

/** World-space camera right vector, shared by every three-tone material. */
export const camRight = { value: new THREE.Vector3(1, 0, -1).normalize() };

/** Shared by every three-tone material: camera, depth-tint and shadow settings. */
export const depthUniforms = {
  uViewDir: { value: new THREE.Vector3(1, 1, 1).normalize() },
  uTarget: { value: new THREE.Vector3() },
  /** Effective depth at which the tint is 0 (nearest) and full (farthest). */
  uDepthNear: { value: 5 },
  uDepthFar: { value: -5 },
  uTintStrength: { value: 0.16 },
  uBg: { value: new THREE.Color('#E3DC4E') },
  uShadowTint: { value: new THREE.Color(0.8, 0.75, 0.58) },
};

/**
 * Three-tone flat shading by face normal, plus the depth cues:
 * - soft shadows from the level light (warm-tinted, never grey);
 * - darker toward the bottom of side faces, a faint bevel highlight on top edges;
 * - a slight fade toward the background with depth. `uDepthShift` lets a joined piece borrow its
 *   partner's depth so a perceptual seam never shows a colour step.
 */
export function toneMaterial(top: string, left: string, right: string, opts: { opacity?: number } = {}) {
  return new THREE.ShaderMaterial({
    lights: true,
    transparent: opts.opacity !== undefined,
    depthWrite: opts.opacity === undefined,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
      uTop: { value: new THREE.Color(top) },
      uLeft: { value: new THREE.Color(left) },
      uRight: { value: new THREE.Color(right) },
      uCamRight: camRight,
      uOpacity: { value: opts.opacity ?? 1 },
      uDepthShift: { value: 0 },
      ...depthUniforms,
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <shadowmap_pars_vertex>
      attribute vec2 aFace;
      varying vec3 vN;
      varying vec3 vW;
      varying vec2 vFace;
      void main() {
        #include <beginnormal_vertex>
        #include <defaultnormal_vertex>
        #include <begin_vertex>
        #include <project_vertex>
        #include <worldpos_vertex>
        #include <shadowmap_vertex>
        vN = normalize(mat3(modelMatrix) * normal);
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        vFace = aFace;
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <packing>
      #include <lights_pars_begin>
      #include <shadowmap_pars_fragment>
      #include <shadowmask_pars_fragment>
      uniform vec3 uTop, uLeft, uRight, uCamRight, uViewDir, uTarget, uBg, uShadowTint;
      uniform float uOpacity, uDepthShift, uDepthNear, uDepthFar, uTintStrength;
      varying vec3 vN;
      varying vec3 vW;
      varying vec2 vFace;
      void main() {
        vec3 n = normalize(vN);
        vec3 side = mix(uLeft, uRight, smoothstep(-0.25, 0.25, dot(n, uCamRight)));
        vec3 c = mix(side, uTop, smoothstep(0.35, 0.65, n.y));
        c = mix(c, uRight * 0.85, smoothstep(-0.35, -0.65, n.y));
        // Solidity: a bevel glint along top edges, and side faces darkening toward their base.
        c = mix(c, min(c * 1.06 + 0.035, vec3(1.0)), smoothstep(0.78, 0.96, abs(vFace.x)) * step(0.5, n.y));
        c *= 1.0 - 0.13 * vFace.y;
        // Soft warm shadow from the level light.
        float sh = getShadowMask();
        c = mix(c * uShadowTint, c, sh);
        // Gentle fade toward the background with (join-adjusted) depth.
        float d = dot(vW - uTarget, uViewDir) + uDepthShift;
        c = mix(c, uBg, smoothstep(uDepthNear, uDepthFar, d) * uTintStrength);
        gl_FragColor = vec4(c, uOpacity);
        #include <colorspace_fragment>
      }`,
  });
}

/** A copy of a tone material with its own depth shift (other uniforms stay shared by reference). */
export function toneVariant(base: THREE.ShaderMaterial) {
  const m = base.clone();
  for (const k of Object.keys(base.uniforms)) if (k !== 'uDepthShift') m.uniforms[k] = base.uniforms[k];
  m.uniforms.uDepthShift = { value: 0 };
  return m;
}

export function ballMaterial(p: Palette, radius: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBase: { value: new THREE.Color(p.ball) },
      uLight: { value: new THREE.Color(p.ballLight) },
      uShade: { value: new THREE.Color(p.ballShade) },
      uBand: { value: new THREE.Color(p.ballBand) },
      uSpec: { value: new THREE.Color(p.ballSpec) },
      uR: { value: radius },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNView;
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        vNView = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBase, uLight, uShade, uBand, uSpec;
      uniform float uR;
      varying vec3 vNView;
      varying vec3 vLocal;
      void main() {
        vec3 n = normalize(vNView);
        vec3 L = normalize(vec3(-0.35, 0.85, 0.45));
        float d = dot(n, L);
        float lit = smoothstep(-0.3, 0.05, d);
        vec3 c = mix(uShade, uBase, lit);
        c = mix(c, uLight, smoothstep(0.55, 0.8, d));
        // A lighter band so rolling is visible (a view-fixed highlight alone can't show rotation).
        float band = 1.0 - smoothstep(0.10, 0.15, abs(vLocal.y) / uR);
        c = mix(c, mix(uBand * 0.78, uBand, lit), band * 0.9);
        vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
        c = mix(c, uSpec, smoothstep(0.93, 0.965, dot(n, H)));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/** Additive glow along the visible edges of a seam's cross-section (top edge + camera-facing side). */
export function seamGlowMaterial(color: string) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: 0 },
      uTime: { value: 0 },
      uSide: { value: 1 },
      uAspect: { value: 1.5 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity, uTime, uSide, uAspect;
      varying vec2 vUv;
      void main() {
        float topEdge = (1.0 - vUv.y) / uAspect;          // uv.y = 1 at the riding surface
        float sideEdge = uSide > 0.5 ? 1.0 - vUv.x : vUv.x;
        float g = max(exp(-26.0 * topEdge), exp(-26.0 * sideEdge));
        g = g * 0.9 + 0.03;                               // the faintest fill so the seam reads as one shape
        float shimmer = 0.85 + 0.15 * sin(uTime * 1.3 - (vUv.x + vUv.y) * 3.0);
        // Additive light in display space: no colour-space encode, which would amplify faint values.
        gl_FragColor = vec4(uColor * g * shimmer * uIntensity, 1.0);
      }`,
  });
}

export function backgroundMesh(p: Palette) {
  const mat = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(p.bgTop) },
      uBot: { value: new THREE.Color(p.bgBottom) },
      uTime: { value: 0 },
      uVig: { value: 0.1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uTop, uBot;
      uniform float uTime, uVig;
      varying vec2 vUv;
      float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
      void main() {
        float t = vUv.y + 0.03 * sin(uTime * 0.05 + vUv.x * 2.0);
        vec3 c = mix(uBot, uTop, smoothstep(0.0, 1.0, t));
        vec2 d = vUv - 0.5;
        c *= 1.0 - uVig * dot(d, d) * 2.0;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
        gl_FragColor.rgb += (ign(gl_FragCoord.xy) - 0.5) / 255.0; // dither against banding
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}

/** Slow rising dust motes, animated entirely on the GPU. */
export function dustMotes(p: Palette, center: THREE.Vector3, box: THREE.Vector3, count = 120) {
  const seeds = new Float32Array(count * 4).map(() => Math.random());
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uBox: { value: box },
      uCenter: { value: center },
      uSize: { value: 3 },
      uColor: { value: new THREE.Color(p.mote) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime, uSize;
      uniform vec3 uBox, uCenter;
      varying float vA;
      void main() {
        vec3 q = (aSeed.xyz - 0.5) * uBox;
        float h = mod(aSeed.y * uBox.y + uTime * (0.05 + 0.08 * aSeed.w), uBox.y);
        q.y = h - 0.5 * uBox.y;
        q.x += 0.3 * sin(uTime * 0.2 + aSeed.w * 6.28);
        q.z += 0.3 * cos(uTime * 0.17 + aSeed.x * 6.28);
        float f = h / uBox.y;
        vA = smoothstep(0.0, 0.15, f) * smoothstep(1.0, 0.8, f) * (0.3 + 0.35 * aSeed.w);
        gl_PointSize = uSize * (0.6 + 0.8 * aSeed.z);
        gl_Position = projectionMatrix * viewMatrix * vec4(uCenter + q, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(uColor, vA * smoothstep(0.5, 0.15, d));
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  return points;
}

/** Soft warm contact shadow (never grey/black). */
export function blobShadowMaterial(color: string) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const cx = cv.getContext('2d')!;
  const c = new THREE.Color(color);
  const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
  const gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${rgb},0.42)`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  cx.fillStyle = gr;
  cx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  });
}
