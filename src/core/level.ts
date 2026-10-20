// Level schema (GAME_PLAN §9.3), loading and validation.
import { AXES, type Axis, type AxisName, type V3, add, key, scale } from './grid';
import { type EndFlag, type Segment, arc, place, straight } from './track';

type P3 = [number, number, number];

export type SegmentDef =
  | { id: string; type: 'straight'; from: P3; to: P3; n: Axis; ends?: [EndFlag, EndFlag] }
  | { id: string; type: 'concave' | 'convex'; from: P3; t: Axis; n: Axis; ends?: [EndFlag, EndFlag] }
  | { id: string; type: 'turn'; from: P3; t: Axis; n: Axis; side: Axis; ends?: [EndFlag, EndFlag] };

export interface SlideDef { axis: AxisName; stops: number[]; initial: number }
export interface RotateDef { axis: AxisName; pivot: P3; initial: number }

export type StarFace = 'ne' | 'es' | 'sw' | 'wn';

export interface PieceDef {
  id: string;
  /** beam/elbow: built from `segments`; star/halfstar: generated from `center`, `plane` and `faces`. */
  shape: 'beam' | 'elbow' | 'star' | 'halfstar';
  segments?: SegmentDef[];
  center?: P3;
  plane?: AxisName;
  faces?: StarFace[];
  slide?: SlideDef;
  rotate?: RotateDef;
}

export interface LevelDef {
  id: string;
  name: string;
  palette: string;
  /** Views the player can turn between, in swipe order. */
  views: number[];
  startView: number;
  fixed: SegmentDef[];
  pieces: PieceDef[];
  /** Grid points on fixed track where the ball stops and waits for a tap. */
  restPads: P3[];
  par: number;
  /** One-line teaching tip shown when the level starts. */
  tip?: string;
  /** Optional teaching ghost shown from the start (level 1). */
  hint?: { piece: string; slideTo?: number; rotateTo?: number };
}

export interface PieceState { s: number; r: number }
export type PieceStates = Record<string, PieceState>;

function buildSegment(d: SegmentDef, pieceId: string | null): Segment {
  const ends = d.ends ?? ['open', 'open'];
  if (d.type === 'straight') return straight(d.id, pieceId, d.from, d.to, d.n, ends);
  if (d.type === 'turn') return arc(d.id, pieceId, 'turn', d.from, d.t, d.n, ends, d.side);
  return arc(d.id, pieceId, d.type, d.from, d.t, d.n, ends);
}

/** In-plane axes (u, v) for a star lying across `plane` (the axis it's extruded along). */
const STAR_PLANE: Record<AxisName, [Axis, Axis]> = { z: ['+x', '+y'], x: ['+z', '+y'], y: ['+x', '+z'] };

/**
 * The Star: four concave faces around its centre; tips at ±u, ±v (GAME_PLAN §4.7).
 * Face NE runs from tip N (moving −v, riding on +u) round to tip E.
 */
function starFaces(p: PieceDef): Segment[] {
  const [u, v] = STAR_PLANE[p.plane ?? 'z'];
  const U = AXES[u], Vv = AXES[v];
  const c = p.center!;
  const neg = (a: Axis) => (a[0] === '+' ? '-' : '+') + a[1] as Axis;
  const all: Record<StarFace, [V3, Axis, Axis]> = {
    ne: [add(c, Vv), neg(v), u],
    es: [add(c, U), neg(u), neg(v)],
    sw: [add(c, scale(Vv, -1)), v, neg(u)],
    wn: [add(c, scale(U, -1)), u, v],
  };
  const faces = p.faces ?? (p.shape === 'star' ? ['ne', 'es', 'sw', 'wn'] : ['ne', 'es']);
  return faces.map((f) => arc(`${p.id}.${f}`, p.id, 'concave', all[f][0], all[f][1], all[f][2], ['open', 'open']));
}

export function pieceSegments(p: PieceDef): Segment[] {
  if (p.shape === 'star' || p.shape === 'halfstar') return starFaces(p);
  return (p.segments ?? []).map((d) => buildSegment(d, p.id));
}

/** Segments at their authored positions (stop 0, rotation 0). */
export function baseSegments(level: LevelDef): Segment[] {
  return [...level.fixed.map((d) => buildSegment(d, null)), ...level.pieces.flatMap(pieceSegments)];
}

export const slideVector = (s: SlideDef): V3 => AXES[`+${s.axis}` as Axis];

export function placementOf(p: PieceDef, st: PieceState) {
  return {
    offset: p.slide ? scale(slideVector(p.slide), st.s) : ([0, 0, 0] as V3),
    rotation: p.rotate ? { axis: p.rotate.axis, pivot: p.rotate.pivot as V3, k: st.r } : undefined,
  };
}

/** Resolve every segment for the given piece states. */
export function resolveSegments(level: LevelDef, states: PieceStates): Segment[] {
  const fixed = level.fixed.map((d) => buildSegment(d, null));
  const pieces = level.pieces.flatMap((p) => {
    const pl = placementOf(p, states[p.id] ?? initialState(p));
    return pieceSegments(p).map((s) => place(s, pl));
  });
  return [...fixed, ...pieces];
}

export const initialState = (p: PieceDef): PieceState => ({ s: p.slide?.initial ?? 0, r: p.rotate?.initial ?? 0 });

export const initialStates = (level: LevelDef): PieceStates =>
  Object.fromEntries(level.pieces.map((p) => [p.id, initialState(p)]));

export function startSegment(level: LevelDef): Segment {
  const seg = baseSegments(level).find((s) => s.ends[0] === 'start');
  if (!seg) throw new Error(`${level.id}: no segment with a 'start' end`);
  return seg;
}

export const padKeys = (level: LevelDef): Set<string> => new Set(level.restPads.map((p) => key(p)));

/** Throws on malformed levels. */
export function validateLevel(level: LevelDef): void {
  const segs = baseSegments(level);
  const ids = new Set<string>();
  for (const s of segs) {
    if (ids.has(s.id)) throw new Error(`${level.id}: duplicate segment id ${s.id}`);
    ids.add(s.id);
  }
  for (const p of level.pieces) {
    if (p.slide && !p.slide.stops.includes(p.slide.initial)) throw new Error(`${level.id}: ${p.id} initial stop not in stops`);
    if (!p.slide && !p.rotate) throw new Error(`${level.id}: piece ${p.id} can't move`);
  }
  if (!segs.some((s) => s.ends.includes('goal'))) throw new Error(`${level.id}: no goal`);
  if (!level.views.includes(level.startView)) throw new Error(`${level.id}: startView not in views`);
  startSegment(level);
}
