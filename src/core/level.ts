// Level schema (GAME_PLAN §9.3), loading and validation.
import { AXES, type Axis, type V3, scale } from './grid';
import { type EndFlag, type Segment, tangentOf, translate } from './track';

export interface SegmentDef {
  id: string;
  type: 'straight';
  from: [number, number, number];
  to: [number, number, number];
  n: Axis;
  ends?: [EndFlag, EndFlag];
}

export interface SlideMove {
  kind: 'slide';
  axis: 'x' | 'y' | 'z';
  stops: number[];
  initial: number;
}

export interface PieceDef extends SegmentDef {
  move: SlideMove;
}

export interface LevelDef {
  id: string;
  name: string;
  palette: string;
  views: number[];
  startView: number;
  start: { p: [number, number, number]; t: Axis; n: Axis };
  goal: { pieceId: string; end: 'far' | 'near' };
  fixed: SegmentDef[];
  pieces: PieceDef[];
  restPads: unknown[];
  par: number;
  hint: { piece: string; slideTo: number }[];
}

/** Current stop value for each movable piece. */
export type PieceStops = Record<string, number>;

export const slideAxis = (m: SlideMove): V3 => AXES[`+${m.axis}` as Axis];

function baseSegment(def: SegmentDef, pieceId: string | null, defaultEnds: [EndFlag, EndFlag]): Segment {
  return { id: def.id, pieceId, from: def.from, to: def.to, n: def.n, ends: def.ends ?? defaultEnds };
}

/** Segments with goal flags applied, before piece offsets. */
export function baseSegments(level: LevelDef): Segment[] {
  const segs = [
    ...level.fixed.map((d) => baseSegment(d, null, ['open', 'open'])),
    ...level.pieces.map((d) => baseSegment(d, d.id, ['open', 'open'])),
  ];
  return segs.map((s) => {
    if (s.id !== level.goal.pieceId) return s;
    const ends: [EndFlag, EndFlag] = [...s.ends];
    ends[level.goal.end === 'far' ? 1 : 0] = 'goal';
    return { ...s, ends };
  });
}

/** Resolve every segment at the given piece stops. A piece at stop s is offset by s along its slide axis. */
export function resolveSegments(level: LevelDef, stops: PieceStops): Segment[] {
  return baseSegments(level).map((s) => {
    if (s.pieceId === null) return s;
    const piece = level.pieces.find((p) => p.id === s.pieceId)!;
    return translate(s, scale(slideAxis(piece.move), stops[s.pieceId] ?? piece.move.initial));
  });
}

export const initialStops = (level: LevelDef): PieceStops =>
  Object.fromEntries(level.pieces.map((p) => [p.id, p.move.initial]));

export function startSegment(level: LevelDef): Segment {
  const seg = baseSegments(level).find((s) => s.ends[0] === 'start');
  if (!seg) throw new Error(`${level.id}: no segment with a 'start' end`);
  return seg;
}

/** Throws on malformed levels. */
export function validateLevel(level: LevelDef): void {
  const segs = baseSegments(level);
  const ids = new Set<string>();
  for (const s of segs) {
    if (ids.has(s.id)) throw new Error(`${level.id}: duplicate segment id ${s.id}`);
    ids.add(s.id);
    const t = tangentOf(s);
    if (t[1] === s.n[1]) throw new Error(`${level.id}: ${s.id} normal must be perpendicular to its direction`);
  }
  for (const p of level.pieces) {
    if (!p.move.stops.includes(p.move.initial)) throw new Error(`${level.id}: ${p.id} initial stop not in stops`);
  }
  if (!segs.some((s) => s.ends.includes('goal'))) throw new Error(`${level.id}: no goal`);
  startSegment(level);
}
