// Synthesised sound (GAME_PLAN §8): pentatonic chimes, soft thocks, a generative ambient pad.
// Everything is pitched to the chapter key; nothing is sampled.

const PENTA = [0, 2, 4, 7, 9];
const ROOT = 50; // D3
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const note = (deg: number, oct = 0) => ROOT + PENTA[((deg % 5) + 5) % 5] + 12 * (Math.floor(deg / 5) + oct);

class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private verb!: ConvolverNode;
  private padTimer = 0;
  private nextChordAt = 0;
  private chord = [0, 2, 4];
  private voices = 0;
  private lastTick = 0;
  private padBus!: GainNode;
  muted = false;
  music = true;

  /** Must be called from a user gesture. */
  unlock() {
    if (!this.ctx) this.build();
    void this.ctx!.resume();
  }

  private build() {
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 40;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 7000;
    shelf.gain.value = -6;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(hp).connect(shelf).connect(comp).connect(ctx.destination);

    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(3.5, 3);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.verb.connect(wet).connect(this.master);
    this.padBus = ctx.createGain();
    this.padBus.gain.value = this.music ? 1 : 0;
    this.padBus.connect(this.master);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void ctx.suspend();
      else void ctx.resume();
    });
  }

  private impulse(sec: number, decay: number) {
    const ctx = this.ctx!;
    const n = (ctx.sampleRate * sec) | 0;
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        lp += 0.2 * (Math.random() * 2 - 1 - lp);
        d[i] = lp * Math.pow(1 - i / n, decay);
      }
    }
    return b;
  }

  setMusic(on: boolean) {
    this.music = on;
    if (this.ctx) this.padBus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.6);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.15);
  }

  /** Soft FM bell. Voice-limited so clusters never get harsh. */
  chime(deg: number, vel = 1, oct = 1, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || this.voices > 6) return;
    this.voices++;
    const t = ctx.currentTime + delay;
    const f0 = hz(note(deg, oct)) * (1 + (Math.random() - 0.5) * 0.004);
    const o = ctx.createOscillator(), mod = ctx.createOscillator();
    const mg = ctx.createGain(), g = ctx.createGain();
    o.frequency.value = f0;
    mod.frequency.value = f0 * 2;
    mg.gain.setValueAtTime(f0 * 0.6 * vel, t);
    mg.gain.setTargetAtTime(0, t, 0.12);
    mod.connect(mg).connect(o.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16 * vel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    o.connect(g);
    g.connect(this.master);
    g.connect(this.verb);
    o.start(t); mod.start(t);
    o.stop(t + 1.9); mod.stop(t + 1.9);
    o.onended = () => { this.voices--; };
  }

  /** Low filtered-noise "thock" for contact. */
  thock(vel = 1, freq = 220) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const len = (ctx.sampleRate * 0.08) | 0;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq * (1 + (Math.random() - 0.5) * 0.1);
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.value = 0.5 * vel;
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
  }

  /** Detent tick while sliding: the stop index walks up the scale. Rate-limited. */
  tick(stopIndex: number) {
    if (!this.ctx || this.ctx.currentTime - this.lastTick < 0.05) return;
    this.lastTick = this.ctx.currentTime;
    this.chime(stopIndex, 0.35, 1);
  }

  snap() { this.thock(0.6, 200); }
  join() { this.chime(0, 0.7, 1); this.chime(3, 0.6, 1, 0.16); } // rising fifth
  turn() { this.chime(1, 0.3, 0); this.chime(4, 0.25, 0, 0.3); }
  rotate(step: number) { this.chime(step + 1, 0.4, 1); this.thock(0.35, 260); }
  rest() { this.chime(2, 0.45, 1); }
  bump() { this.thock(0.5, 160); }
  release() { this.chime(2, 0.4, 1); this.thock(0.3, 300); }
  win() { [0, 2, 4, 5].forEach((d, i) => this.chime(d, 0.8 - i * 0.08, 1, i * 0.22)); }

  // --- Ambient pad: overlapping chords that always share a tone with the last one.
  startPad() {
    if (!this.ctx || this.padTimer) return;
    this.nextChordAt = this.ctx.currentTime + 0.2;
    this.padTimer = window.setInterval(() => this.schedulePad(), 500);
    this.schedulePad();
  }

  private schedulePad() {
    const ctx = this.ctx!;
    if (ctx.state !== 'running' || ctx.currentTime < this.nextChordAt - 1) return;
    const cands = [[0, 2, 4], [1, 3, 5], [2, 4, 6], [-1, 1, 3], [0, 3, 5]]
      .filter((c) => c.some((x) => this.chord.includes(x)) && c.join() !== this.chord.join());
    this.chord = cands[(Math.random() * cands.length) | 0];
    const t = Math.max(this.nextChordAt, ctx.currentTime + 0.05);
    for (const d of this.chord) this.padVoice(note(d), t, 14);
    if (this.music && Math.random() < 0.3) this.chime(this.chord[2] + 5, 0.25, 0, 4 + Math.random() * 4);
    this.nextChordAt = t + 10;
  }

  private padVoice(m: number, t: number, dur: number) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    f.Q.value = 0.4;
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.06;
    lg.gain.value = 350;
    lfo.connect(lg).connect(f.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.04, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const oscs = ([['triangle', 0], ['sine', 7], ['sine', -5]] as const).map(([type, det]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz(m);
      o.detune.value = det;
      o.connect(f);
      return o;
    });
    f.connect(g);
    g.connect(this.padBus);
    g.connect(this.verb);
    for (const o of [...oscs, lfo]) { o.start(t); o.stop(t + dur + 0.1); }
  }
}

export const sound = new Sound();
