import '@fontsource/outfit/300.css';
import '@fontsource/outfit/400.css';
import '@fontsource/outfit/600.css';
import './ui/style.css';
import { LEVELS } from '../levels';
import { Game } from './app/game';
import {
  type Progress, type Settings, loadProgress, loadSettings, saveProgress, saveSettings, setHaptics, setupNative,
} from './app/platform';
import { activeTweens, setReducedMotion } from './anim/motion';
import { sound } from './audio/sound';
import { validateLevel } from './core/level';
import { Stage } from './render/scene';
import { Ui } from './ui/hud';

LEVELS.forEach(validateLevel);

async function main() {
  const [settings, progress] = await Promise.all([loadSettings(), loadProgress()]);
  const stage = new Stage(document.getElementById('stage') as HTMLCanvasElement);
  let current = Math.min(Object.keys(progress.solved).length, LEVELS.length - 1);
  let game: Game;

  const applySettings = (s: Settings) => {
    sound.setMuted(!s.sound);
    sound.setMusic(s.music);
    setHaptics(s.haptics);
    setReducedMotion(s.reduceMotion);
  };
  applySettings(settings);

  const unlocked = (i: number) => i === 0 || LEVELS[i - 1].id in progress.solved;
  const tiles = () => LEVELS.map((l, i) => ({
    id: l.id, name: l.name, par: l.par, best: progress.solved[l.id] ?? null, unlocked: unlocked(i),
  }));

  const ui = new Ui(document.getElementById('ui')!, settings, {
    onBegin: () => {
      sound.unlock();
      sound.startPad();
      ui.renderLevels(tiles(), current);
      ui.show('levels');
    },
    onPick: (i) => { load(i); ui.show('hud'); },
    onBack: () => { ui.renderLevels(tiles(), current); ui.show('levels'); },
    onUndo: () => game.undo(),
    onRestart: () => game.restart(),
    onHint: () => game.hint(),
    onNext: () => {
      if (current + 1 < LEVELS.length) load(current + 1);
      else { ui.renderLevels(tiles(), current); ui.show('levels'); }
    },
    onReplay: () => game.restart(),
    onSettings: (s) => { Object.assign(settings, s); applySettings(s); void saveSettings(s); },
  });

  function load(i: number) {
    game?.dispose();
    current = i;
    const level = LEVELS[i];
    ui.setLevel(i, level.name);
    ui.setMoves(0, level.par);
    game = new Game(stage, level, {
      onWin: (moves, par) => {
        const best = progress.solved[level.id];
        progress.solved[level.id] = best === undefined ? moves : Math.min(best, moves);
        void saveProgress(progress as Progress);
        ui.showResult(moves, par, i === LEVELS.length - 1);
      },
      onMoves: (m) => ui.setMoves(m, level.par),
      onHintAvailable: (on) => ui.setHint(on),
      onTip: (t) => ui.tip(t),
    });
    if (import.meta.env.DEV || location.search.includes('test')) {
      Object.assign(window, { __seamline: game.debug(), __game: game, __load: load });
    }
  }

  // The title sits over the first unsolved level, idling.
  load(current);
  ui.tip(null);

  await setupNative(
    () => {
      if (ui.settingsOpen) { ui.openSettings(false); return true; }
      if (ui.screen === 'hud') { ui.renderLevels(tiles(), current); ui.show('levels'); return true; }
      return false;
    },
    () => sound.setMuted(true),
    () => sound.setMuted(!settings.sound),
  );

  // One render loop for everything. dt is clamped so a backgrounded app resumes gently.
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
      __anim: { active: activeTweens, get timeScale() { return timeScale; }, set timeScale(v: number) { timeScale = v; } },
    });
  }
}

void main();
