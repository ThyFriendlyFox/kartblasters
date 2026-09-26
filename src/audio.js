import { createEngine, Gearbox, ENGINES, CAR_ENGINES } from './engine.js';
import { Music } from './music.js';

const store = {
  get(k, d) {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

/** Synthesized sound effects, engine and music via WebAudio (no asset files needed). */
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = store.get('kb-music', '1') === '1';
    this.gearbox = new Gearbox();
    this.engineSpec = ENGINES.v12;
    this.wantTrack = 'menu';
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.45;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Engine: firing-pulse synth in an AudioWorklet
    createEngine(ctx, this.master)
      .then((node) => {
        this.eng = node;
        if (node) node.port.postMessage(this.engineSpec);
      })
      .catch((e) => console.warn('engine audio unavailable', e));

    this.music = new Music(ctx, this.master, this.noise);
    this.music.setEnabled(this.musicOn);
    this.music.play(this.wantTrack);
  }

  /** Choose the engine that matches a car. */
  setCar(carType) {
    this.engineSpec = ENGINES[CAR_ENGINES[carType]] || ENGINES.v12;
    this.eng?.port.postMessage(this.engineSpec);
  }

  playMusic(name) {
    this.wantTrack = name;
    this.music?.play(name);
  }

  setMusic(on) {
    this.musicOn = on;
    store.set('kb-music', on ? '1' : '0');
    this.music?.setEnabled(on);
    for (const id of ['musicToggle', 'musicToggleMenu']) {
      const el = document.getElementById(id);
      if (el) el.checked = on;
    }
  }

  /** Continuous tire screech while drifting (level 0..1). */
  screech(level) {
    if (!this.ctx) return;
    if (!this.scr) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2600;
      bp.Q.value = 4;
      this.scr = this.ctx.createGain();
      this.scr.gain.value = 0;
      src.connect(bp).connect(this.scr).connect(this.master);
      src.start();
      this.scrFilter = bp;
    }
    // Only touch the params when the level really changes (see engine())
    if (Math.abs(level - (this.scrLevel ?? -1)) < 0.04 && !(level === 0 && this.scrLevel !== 0)) return;
    this.scrLevel = level;
    const t = this.ctx.currentTime;
    for (const [param, v] of [[this.scr.gain, level * 0.16], [this.scrFilter.frequency, 2200 + level * 900 + Math.random() * 300]]) {
      param.cancelScheduledValues(t);
      param.setTargetAtTime(v, t, 0.05);
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.45;
  }

  /**
   * Drive the engine sound. speedNorm = speed / top speed, throttle -1..1.
   */
  engine(dt, speedNorm, throttle, boosting, on) {
    if (!this.eng) return;
    const { rpm, load } = this.gearbox.update(dt, Math.abs(speedNorm), throttle, this.engineSpec, boosting);
    // Plain values: the worklet smooths them. (Scheduling an automation event
    // every frame piles up on the audio thread and makes all sound lag.)
    const p = this.eng.parameters;
    p.get('rpm').value = rpm;
    p.get('load').value = load;
    // Kept well under the effects and music
    p.get('gain').value = on ? 0.1 + 0.08 * load : 0;
  }

  tone(type, f0, f1, dur, vol) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noiseBurst(dur, vol, freq, q = 1) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(80, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  play(name, vol = 1) {
    if (!this.ctx || this.muted || vol < 0.02) return;
    switch (name) {
      case 'blaster': this.tone('square', 1400, 180, 0.12, 0.12 * vol); break;
      case 'rocket': this.noiseBurst(0.5, 0.35 * vol, 1800); this.tone('sawtooth', 300, 60, 0.4, 0.1 * vol); break;
      case 'explode': this.noiseBurst(1.1, 0.9 * vol, 2200); this.tone('sine', 120, 30, 0.8, 0.5 * vol); break;
      case 'impact': this.noiseBurst(0.12, 0.25 * vol, 3000); break;
      case 'hitmark': this.tone('triangle', 1800, 2400, 0.06, 0.25 * vol); break;
      case 'hurt': this.tone('sine', 220, 60, 0.25, 0.5 * vol); this.noiseBurst(0.15, 0.3 * vol, 900); break;
      case 'bump': this.noiseBurst(0.2, 0.4 * vol, 600); break;
      case 'jump': this.tone('sine', 200, 900, 0.35, 0.3 * vol); break;
      case 'pickup': this.tone('triangle', 600, 1200, 0.15, 0.3 * vol); setTimeout(() => this.ctx && this.tone('triangle', 900, 1800, 0.15, 0.3 * vol), 90); break;
      case 'overheat': this.noiseBurst(0.6, 0.3 * vol, 5000, 6); break;
      case 'kill': this.tone('square', 500, 1000, 0.1, 0.2 * vol); setTimeout(() => this.ctx && this.tone('square', 750, 1500, 0.18, 0.2 * vol), 100); break;
      case 'beep': this.tone('square', 440, 440, 0.25, 0.25 * vol); break;
      case 'go': this.tone('square', 880, 880, 0.6, 0.3 * vol); break;
      case 'lap': this.tone('triangle', 660, 990, 0.2, 0.3 * vol); setTimeout(() => this.ctx && this.tone('triangle', 990, 1320, 0.25, 0.3 * vol), 140); break;
      case 'shotgun': this.noiseBurst(0.35, 0.55 * vol, 2600); this.tone('square', 160, 60, 0.15, 0.2 * vol); break;
      case 'laser': this.tone('square', 2200, 900, 0.05, 0.06 * vol); break;
      case 'hail': this.tone('triangle', 900, 300, 0.12, 0.15 * vol); break;
      case 'bubble': this.tone('sine', 300, 1100, 0.15, 0.2 * vol); break;
      case 'grenade': this.tone('sine', 220, 90, 0.2, 0.35 * vol); this.noiseBurst(0.1, 0.2 * vol, 800); break;
      case 'flame': this.noiseBurst(0.12, 0.12 * vol, 1400); break;
      case 'zap': this.tone('sawtooth', 1600, 120, 0.2, 0.18 * vol); this.noiseBurst(0.15, 0.2 * vol, 6000, 3); break;
      case 'beam': this.tone('sine', 1200, 1250, 0.1, 0.05 * vol); break;
      case 'sniper': this.noiseBurst(0.6, 0.8 * vol, 5000); this.tone('square', 1800, 90, 0.35, 0.3 * vol); break;
      case 'empty': this.tone('square', 200, 150, 0.05, 0.1 * vol); break;
    }
  }
}
