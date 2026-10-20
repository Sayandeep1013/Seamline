// DOM overlay: title, level label, HUD buttons, result card. Hand-written SVG icons.

const icon = {
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  restart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  muted: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6"/><path d="m21 9-5 6"/></svg>',
};

export interface HudHandlers {
  onBegin(): void;
  onUndo(): void;
  onRestart(): void;
  onToggleSound(): boolean;
  onAgain(): void;
}

export class Hud {
  private card: HTMLDivElement;
  private stats: HTMLDivElement;

  constructor(root: HTMLElement, levelNumber: number, levelName: string, h: HudHandlers) {
    root.innerHTML = `
      <div class="label"><b>${levelNumber}</b>${levelName}</div>
      <div class="hud">
        <div class="group">
          <button class="btn" data-a="undo" aria-label="Undo">${icon.undo}</button>
          <button class="btn" data-a="restart" aria-label="Restart">${icon.restart}</button>
        </div>
        <div class="group">
          <button class="btn" data-a="sound" aria-label="Sound on">${icon.sound}</button>
        </div>
      </div>
      <div class="card" role="dialog" aria-live="polite">
        <h2>Solved</h2>
        <div class="stats"></div>
        <button data-a="again">Play again</button>
      </div>
      <div class="overlay title-screen">
        <div class="title"><h1>SEAMLINE</h1><p>tap to begin</p></div>
      </div>`;
    this.card = root.querySelector('.card')!;
    this.stats = root.querySelector('.stats')!;
    const title = root.querySelector<HTMLDivElement>('.title-screen')!;
    title.addEventListener('pointerdown', () => {
      title.classList.add('hidden');
      h.onBegin();
    }, { once: true });
    root.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'undo') h.onUndo();
      if (a === 'restart') h.onRestart();
      if (a === 'again') { this.hideResult(); h.onAgain(); }
      if (a === 'sound') {
        const on = h.onToggleSound();
        const b = root.querySelector<HTMLButtonElement>('[data-a="sound"]')!;
        b.innerHTML = on ? icon.sound : icon.muted;
        b.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
      }
    });
  }

  showResult(moves: number, par: number) {
    this.stats.textContent = `${moves} ${moves === 1 ? 'move' : 'moves'}  ·  par ${par}`;
    this.card.classList.add('shown');
  }

  hideResult() {
    this.card.classList.remove('shown');
  }
}
