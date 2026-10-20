// DOM overlay for a portrait phone: title, level select, settings, in-game HUD, tips, result card.
import type { Settings } from '../app/platform';

const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const icon = {
  back: svg('<path d="m15 5-7 7 7 7"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  restart: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  hint: svg('<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  close: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
};

export interface LevelTile { id: string; name: string; par: number; best: number | null; unlocked: boolean }

export interface UiHandlers {
  onBegin(): void;
  onPick(index: number): void;
  onBack(): void;
  onUndo(): void;
  onRestart(): void;
  onHint(): void;
  onNext(): void;
  onReplay(): void;
  onSettings(s: Settings): void;
  onUpdate(): void;
}

export class Ui {
  private el: Record<string, HTMLElement> = {};
  private tipTimer = 0;
  private settings: Settings;

  constructor(private root: HTMLElement, settings: Settings, h: UiHandlers) {
    this.settings = { ...settings };
    root.innerHTML = `
      <section class="screen title" data-s="title">
        <div class="title-text"><h1>SEAMLINE</h1><p class="sub">what looks joined, is joined</p></div>
        <p class="begin">tap to begin</p>
      </section>

      <section class="screen levels hidden" data-s="levels" aria-label="Choose a level">
        <header><span class="chapter">Chapter 1</span><h2>Mustard</h2></header>
        <div class="grid"></div>
        <button class="update hidden" data-a="update"><b>New version</b><span class="uv"></span><i>Download</i></button>
        <footer><button class="btn" data-a="settings" aria-label="Settings">${icon.settings}</button></footer>
      </section>

      <section class="screen hud hidden" data-s="hud">
        <div class="top">
          <button class="btn" data-a="back" aria-label="Levels">${icon.back}</button>
          <div class="label"><b class="num"></b><span class="name"></span><small class="moves"></small></div>
          <span class="spacer"></span>
        </div>
        <div class="tip" aria-live="polite"></div>
        <div class="bottom">
          <div class="group">
            <button class="btn" data-a="undo" aria-label="Undo">${icon.undo}</button>
            <button class="btn" data-a="restart" aria-label="Restart">${icon.restart}</button>
          </div>
          <button class="btn hint-btn" data-a="hint" aria-label="Hint">${icon.hint}</button>
        </div>
        <div class="card" role="dialog" aria-live="polite">
          <h2 class="card-title">Solved</h2>
          <div class="stats"></div>
          <div class="actions">
            <button class="ghost" data-a="replay">Replay</button>
            <button class="primary" data-a="next">Next</button>
          </div>
        </div>
      </section>

      <div class="sheet-scrim hidden" data-a="close-settings"></div>
      <section class="sheet hidden" aria-label="Settings">
        <header><h2>Settings</h2><button class="btn" data-a="close-settings" aria-label="Close">${icon.close}</button></header>
        ${this.toggle('sound', 'Sound effects')}
        ${this.toggle('music', 'Music')}
        ${this.toggle('haptics', 'Vibration')}
        ${this.toggle('reduceMotion', 'Reduce motion')}
        ${this.toggle('updates', 'Check for updates')}
        <p class="credit">Seamline v${__APP_VERSION__} · made with calm</p>
      </section>`;
    for (const k of ['title', 'levels', 'hud']) this.el[k] = root.querySelector(`[data-s="${k}"]`)!;
    for (const c of ['grid', 'tip', 'card', 'stats', 'num', 'name', 'moves', 'hint-btn', 'sheet', 'sheet-scrim', 'card-title']) {
      this.el[c] = root.querySelector(`.${c}`)!;
    }
    this.syncToggles();

    this.el.title.addEventListener('pointerup', () => h.onBegin(), { once: true });
    root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
      const tile = t.closest<HTMLElement>('[data-i]');
      if (tile && !tile.classList.contains('locked')) h.onPick(Number(tile.dataset.i));
      switch (a) {
        case 'back': h.onBack(); break;
        case 'undo': h.onUndo(); break;
        case 'restart': this.hideResult(); h.onRestart(); break;
        case 'hint': h.onHint(); break;
        case 'next': this.hideResult(); h.onNext(); break;
        case 'replay': this.hideResult(); h.onReplay(); break;
        case 'settings': this.openSettings(true); break;
        case 'close-settings': this.openSettings(false); break;
        case 'update': h.onUpdate(); break;
      }
    });
    root.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((box) =>
      box.addEventListener('change', () => {
        const k = box.name as keyof Settings;
        (this.settings as unknown as Record<string, boolean | null>)[k] = box.checked;
        h.onSettings({ ...this.settings });
      }));
  }

  private toggle(name: keyof Settings, label: string) {
    return `<label class="row"><span>${label}</span><input type="checkbox" name="${name}" role="switch"><i class="switch"></i></label>`;
  }

  private syncToggles() {
    this.root.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((box) => {
      const v = this.settings[box.name as keyof Settings];
      box.checked = box.name === 'reduceMotion' ? v === true || (v === null && matchMedia('(prefers-reduced-motion: reduce)').matches) : Boolean(v);
    });
  }

  show(screen: 'title' | 'levels' | 'hud') {
    for (const [k, node] of Object.entries(this.el)) {
      if (k === 'title' || k === 'levels' || k === 'hud') node.classList.toggle('hidden', k !== screen);
    }
  }

  get screen() {
    return (['title', 'levels', 'hud'] as const).find((k) => !this.el[k].classList.contains('hidden'))!;
  }

  renderLevels(tiles: LevelTile[], current: number) {
    this.el.grid.innerHTML = tiles.map((t, i) => `
      <button class="tile ${t.unlocked ? '' : 'locked'} ${t.best !== null ? 'solved' : ''} ${i === current ? 'current' : ''}"
        data-i="${i}" ${t.unlocked ? '' : 'aria-disabled="true"'} aria-label="Level ${i + 1}, ${t.name}${t.unlocked ? '' : ', locked'}">
        <span class="n">${t.unlocked ? i + 1 : icon.lock}</span>
        <span class="t">${t.unlocked ? t.name : ''}</span>
        <span class="b">${t.best !== null ? `${t.best} / ${t.par}` : ''}</span>
      </button>`).join('');
  }

  setLevel(index: number, name: string) {
    this.el.num.textContent = String(index + 1);
    this.el.name.textContent = name;
    this.setMoves(0, 0);
    this.setHint(false);
    this.tip(null);
    this.hideResult();
  }

  setMoves(moves: number, par: number) {
    this.el.moves.textContent = moves ? `${moves} ${moves === 1 ? 'move' : 'moves'}` : par ? `par ${par}` : '';
  }

  setHint(on: boolean) {
    this.el['hint-btn'].classList.toggle('on', on);
  }

  tip(text: string | null, seconds = 7) {
    clearTimeout(this.tipTimer);
    const el = this.el.tip;
    if (!text) { el.classList.remove('on'); return; }
    el.textContent = text;
    el.classList.add('on');
    this.tipTimer = window.setTimeout(() => el.classList.remove('on'), seconds * 1000);
  }

  showResult(moves: number, par: number, last: boolean) {
    this.el['card-title'].textContent = last ? 'Chapter complete' : 'Solved';
    const perfect = moves <= par;
    this.el.stats.textContent = `${moves} ${moves === 1 ? 'move' : 'moves'}  ·  par ${par}${perfect ? '  ·  perfect' : ''}`;
    (this.root.querySelector('[data-a="next"]') as HTMLElement).textContent = last ? 'Levels' : 'Next';
    this.el.card.classList.add('shown');
    this.setHint(false);
  }

  hideResult() {
    this.el.card.classList.remove('shown');
  }

  openSettings(open: boolean) {
    this.syncToggles();
    this.el.sheet.classList.toggle('hidden', !open);
    this.el['sheet-scrim'].classList.toggle('hidden', !open);
  }

  /** Show (or hide, with null) the "new version" card on the level select. */
  showUpdate(version: string | null) {
    const el = this.root.querySelector<HTMLElement>('.update')!;
    el.classList.toggle('hidden', !version);
    if (version) el.querySelector('.uv')!.textContent = `v${version}`;
  }

  get settingsOpen() {
    return !this.el.sheet.classList.contains('hidden');
  }
}
