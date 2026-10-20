// Renders the app icon and splash art (red ball crossing a seam on mustard) to assets/*.png.
// `npm run icons` then feeds these to @capacitor/assets to produce every Android size.
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const C = {
  bg: '#E3DC4E', bgDark: '#D9CF3A', top: '#F7EE5C', left: '#E2CF2A', right: '#BFA81E',
  ball: '#D3261E', ballShade: '#A81C16', ballLight: '#E2463A', spec: '#FF8A7A', seam: '#FFFFFF',
};

/** Isometric projection of grid point (x, y, z) into a 1024 canvas around `o` at scale `s`. */
const iso = (o, s) => (x, y, z) => [o[0] + s * 0.866 * (x - z), o[1] + s * (0.5 * (x + z) - y)];
const poly = (pts, fill) => `<polygon points="${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="${fill}"/>`;

function art(o, s) {
  const P = iso(o, s);
  const W = 0.45, D = 0.62, R = 0.3;
  // Two beams: the near one ends where the far one begins, joined only on screen (a perceptual seam).
  const beam = (x0, x1, y, z) => [
    poly([P(x0, y, z - W), P(x1, y, z - W), P(x1, y, z + W), P(x0, y, z + W)], C.top),
    poly([P(x0, y, z + W), P(x1, y, z + W), P(x1, y - D, z + W), P(x0, y - D, z + W)], C.left),
    poly([P(x1, y, z - W), P(x1, y, z + W), P(x1, y - D, z + W), P(x1, y - D, z - W)], C.right),
  ].join('');
  const seam = [P(1.5, -0.001, -W), P(1.5, -0.001, W), P(1.5, -D, W)];
  const [bx, by] = P(0.75, R, 0);
  const r = s * R * 1.12;
  return `
    ${beam(-1.4, 1.5, 0, 0)}
    ${beam(2.5, 4.4, 1, 1).replace(/^/, '')}
    <polyline points="${seam.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${C.seam}" stroke-width="${s * 0.05}" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
    <ellipse cx="${bx}" cy="${by + r * 0.95}" rx="${r * 1.05}" ry="${r * 0.42}" fill="#78640A" opacity="0.28"/>
    <circle cx="${bx}" cy="${by}" r="${r}" fill="${C.ball}"/>
    <path d="M ${bx - r} ${by} A ${r} ${r} 0 0 0 ${bx + r} ${by} A ${r} ${r * 0.55} 0 0 1 ${bx - r} ${by}" fill="${C.ballShade}" opacity="0.55"/>
    <circle cx="${bx - r * 0.38}" cy="${by - r * 0.42}" r="${r * 0.2}" fill="${C.spec}"/>`;
}

const bgRect = (size, rx = 0) => `
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.bg}"/><stop offset="1" stop-color="${C.bgDark}"/></linearGradient></defs>
  <rect width="${size}" height="${size}" rx="${rx}" fill="url(#g)"/>`;

const svg = (size, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;

mkdirSync('assets', { recursive: true });
const out = (name, s) => sharp(Buffer.from(s)).png().toFile(`assets/${name}`);

// Full icon (legacy launchers) and adaptive-icon layers; the foreground keeps inside the 66% safe zone.
await out('icon-only.png', svg(1024, bgRect(1024) + art([379, 388], 154)));
await out('icon-foreground.png', svg(1024, art([410, 417], 118)));
await out('icon-background.png', svg(1024, bgRect(1024)));
await out('splash.png', svg(2732, bgRect(2732) + art([1202, 1213], 190)));
await out('splash-dark.png', svg(2732, bgRect(2732) + art([1202, 1213], 190)));
console.log('assets/*.png written');
