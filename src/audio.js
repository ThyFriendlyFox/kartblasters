/** Synthesized sound effects via WebAudio (no asset files needed). */
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.45;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Engine: two detuned saws through a lowpass
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    this.engOsc = [ctx.createOscillator(), ctx.createOscillator()];
    this.engOsc.forEach((o, i) => {
      o.type = 'sawtooth';
      o.frequency.value = 50 + i * 3;
      o.connect(lp);
      o.start();
    });
    lp.connect(this.engGain);
    this.engGain.connect(this.master);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.45;
  }

  engine(speed, boosting, alive) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 45 + Math.abs(speed) * 3.2 + (boosting ? 40 : 0);
    this.engOsc[0].frequency.setTargetAtTime(f, t, 0.05);
    this.engOsc[1].frequency.setTargetAtTime(f * 1.5 + 2, t, 0.05);
    this.engGain.gain.setTargetAtTime(alive ? 0.05 + Math.min(Math.abs(speed), 40) * 0.0025 : 0, t, 0.1);
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
      case 'empty': this.tone('square', 200, 150, 0.05, 0.1 * vol); break;
    }
  }
}
