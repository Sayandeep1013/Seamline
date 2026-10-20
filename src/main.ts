import '@fontsource/outfit/300.css';
import '@fontsource/outfit/400.css';
import '@fontsource/outfit/600.css';
import './ui/style.css';
import L01 from '../levels/L01.json';
import { Game } from './app/game';
import { activeTweens } from './anim/motion';
import { sound } from './audio/sound';
import { type LevelDef, validateLevel } from './core/level';
import { Stage } from './render/scene';
import { Hud } from './ui/hud';

const level = L01 as unknown as LevelDef;
validateLevel(level);

const stage = new Stage(document.getElementById('stage') as HTMLCanvasElement);
let hud: Hud;
const game = new Game(stage, level, {
  onWin: (moves, par) => hud.showResult(moves, par),
  onMovesChanged: () => {},
});
hud = new Hud(document.getElementById('ui')!, 1, level.name, {
  onBegin: () => { sound.unlock(); sound.startPad(); },
  onUndo: () => game.undo(),
  onRestart: () => { hud.hideResult(); game.restart(); },
  onToggleSound: () => { sound.setMuted(!sound.muted); return !sound.muted; },
  onAgain: () => game.restart(),
});

// One render loop for everything. dt is clamped so a backgrounded tab resumes gently.
let last = performance.now();
let timeScale = 1;
document.addEventListener('visibilitychange', () => { last = performance.now(); });
stage.renderer.setAnimationLoop((now: number) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  game.update(dt * timeScale);
  stage.render();
});

if (import.meta.env.DEV || location.search.includes('test')) {
  Object.assign(window, {
    __seamline: game.debug(),
    __game: game,
    __anim: { active: activeTweens, get timeScale() { return timeScale; }, set timeScale(v: number) { timeScale = v; } },
  });
}
