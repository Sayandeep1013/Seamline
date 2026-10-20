// Chapter palettes (GAME_PLAN §7).
export interface Palette {
  bgTop: string; bgBottom: string;
  top: string; left: string; right: string;
  ball: string; ballLight: string; ballShade: string; ballBand: string; ballSpec: string;
  glow: string; rail: string;
  bowlTop: string; bowlLeft: string; bowlRight: string; bowlRim: string;
  shadow: string; mote: string;
}

export const PALETTES: Record<string, Palette> = {
  mustard: {
    bgTop: '#E3DC4E', bgBottom: '#D9CF3A',
    top: '#F7EE5C', left: '#E2CF2A', right: '#BFA81E',
    ball: '#D3261E', ballLight: '#E2463A', ballShade: '#A81C16', ballBand: '#F07A6C', ballSpec: '#FF8A7A',
    glow: '#FFFFFF', rail: '#8C7A12',
    bowlTop: '#F4F1E6', bowlLeft: '#E4DECA', bowlRight: '#CDC4A6', bowlRim: '#C9A227',
    shadow: '#78640A', mote: '#FFF9D6',
  },
};
