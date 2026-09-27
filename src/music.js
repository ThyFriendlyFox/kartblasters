/**
 * Procedural soundtrack: a small step sequencer that schedules synthesized
 * drums, bass, pads, arpeggios and a lead ahead of time on the WebAudio
 * clock. Each track is a key, mode, chord progression, tempo and a set of
 * patterns; songs cycle through intro / verse / chorus / breakdown sections.
 */

const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

// x = hit, . = rest. 16 steps per bar.
export const TRACKS = {
  menu: {
    bpm: 96, root: 50, mode: 'major', prog: [0, 4, 5, 3],
    kick: 'x.......x.......', snare: '....x.......x...', hat: '..x...x...x...x.',
    bass: 'R...R...R.R.....', arp: 'up', arpWave: 'triangle', pad: 'sine', lead: false, bright: 0.5,
  },
  toy: {
    bpm: 132, root: 52, mode: 'major', prog: [0, 5, 3, 4],
    kick: 'x...x...x...x...', snare: '....x.......x..x', hat: 'x.x.x.x.x.x.x.x.',
    bass: 'R.R.oR.RR.R.oR.R', arp: 'updown', arpWave: 'square', pad: 'triangle', lead: 'square', bright: 0.8,
  },
  stadium: {
    bpm: 128, root: 50, mode: 'major', prog: [0, 4, 5, 3],
    kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.',
    bass: 'R.R.R.oRR.R.R.oR', arp: 'updown', arpWave: 'sawtooth', pad: 'sawtooth', lead: 'square', bright: 0.8,
  },
  alpine: {
    bpm: 138, root: 55, mode: 'major', prog: [0, 3, 4, 5],
    kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.xx',
    bass: 'R.oR.RoRR.oR.RoR', arp: 'up', arpWave: 'triangle', pad: 'triangle', lead: 'square', bright: 0.85,
  },
  neon: {
    bpm: 110, root: 45, mode: 'minor', prog: [0, 5, 2, 6],
    kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...xx',
    bass: 'RRRRRRRRRRRRRRRR', arp: 'up', arpWave: 'sawtooth', pad: 'sawtooth', lead: 'sawtooth', bright: 0.65,
  },
  desert: {
    bpm: 124, root: 40, mode: 'minor', prog: [0, 6, 5, 6],
    kick: 'x..x..x.x..x....', snare: '....x.......x...', hat: 'x.xxx.xxx.xxx.xx',
    bass: 'R.RR.RoRR.RR.RoR', arp: 'down', arpWave: 'square', pad: 'sawtooth', lead: 'square', bright: 0.7,
  },
  volcano: {
    bpm: 128, root: 38, mode: 'minor', prog: [0, 5, 6, 4],
    kick: 'x...x..xx...x...', snare: '....x.......x...', hat: 'x.x.x.xxx.x.x.xx',
    bass: 'RR.RR.RRRR.RR.oR', arp: 'updown', arpWave: 'sawtooth', pad: 'sawtooth', lead: 'sawtooth', bright: 0.55,
  },
  battle: {
    bpm: 144, root: 48, mode: 'minor', prog: [0, 0, 5, 6],
    kick: 'x..x..x...x..x..', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx',
    bass: 'RRoRRRoRRRoRRoRR', arp: 'up', arpWave: 'square', pad: 'sawtooth', lead: 'square', bright: 0.75,
  },
};

// ---------------- random songs ----------------

const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const range = (rng, lo, hi) => lo + Math.round(rng() * (hi - lo));
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PROGS = {
  minor: [[0, 5, 2, 6], [0, 3, 4, 0], [0, 5, 6, 4], [0, 6, 5, 6], [0, 2, 5, 4], [0, 3, 6, 5]],
  major: [[0, 4, 5, 3], [0, 5, 3, 4], [0, 3, 4, 3], [5, 3, 0, 4], [0, 1, 3, 4]],
};

/**
 * Song styles. Each field is a list to pick from (or a [lo, hi] range for
 * numbers), so every song in a style has the style's groove but its own key,
 * tempo, chords, patterns and hook.
 */
const STYLES = {
  house: {
    label: ['Deep House', 'Piano House', 'Disco House', 'Tech House'],
    bpm: [120, 126], mode: ['minor', 'minor', 'major'], root: [43, 50],
    kick: ['x...x...x...x...'],
    snare: ['................'],
    clap: ['....x.......x...', '....x.......x..x'],
    hat: ['xxxxxxxxxxxxxxxx', 'x.xxx.xxx.xxx.xx', '................'],
    ohat: ['..x...x...x...x.'],
    bass: ['..R...R...R...R.', '..R.R.oR..R.R.oR', 'R..R..R...R..R.o', '..Ro..R...Ro..R.'],
    stab: ['..x...x...x..x..', 'x..x..x...x..x..', '...x..x....x..x.', 'x.....x.x.....x.'],
    stabWave: ['triangle', 'square', 'sawtooth'],
    arp: [false, false, 'up'], arpWave: ['triangle'], pad: ['sawtooth', 'triangle'], lead: [false, 'triangle', 'square'],
    pump: [true], swing: [0.06, 0.1], bright: [0.55, 0.85],
  },
  synthwave: {
    label: ['Synthwave', 'Outrun', 'Night Drive'],
    bpm: [100, 116], mode: ['minor'], root: [40, 47],
    kick: ['x...x...x...x...', 'x.......x.x.....'], snare: ['....x.......x...'], hat: ['..x...x...x...x.', 'x.x.x.x.x.x.x.x.'],
    bass: ['RRRRRRRRRRRRRRRR', 'R.RRR.RRR.RRR.RR', 'RoRoRoRoRoRoRoRo'],
    arp: ['up', 'updown'], arpWave: ['sawtooth', 'square'], pad: ['sawtooth'], lead: ['sawtooth'], bright: [0.5, 0.7],
  },
  chiptune: {
    label: ['Chiptune', '8-bit Rush', 'Arcade'],
    bpm: [140, 160], mode: ['major', 'major', 'minor'], root: [50, 57],
    kick: ['x...x...x...x...', 'x.x...x.x.x...x.'], snare: ['....x.......x...', '....x..x....x...'], hat: ['x.x.x.x.x.x.x.x.'],
    bass: ['R.oRR.oRR.oRR.oR', 'RoRoRoRoRoRoRoRo'],
    arp: ['up', 'updown', 'down'], arpWave: ['square'], pad: ['square', 'triangle'], lead: ['square'], bright: [0.8, 0.95],
  },
  trance: {
    label: ['Trance', 'Euphoric Trance', 'Uplifting'],
    bpm: [134, 140], mode: ['minor', 'major'], root: [45, 52],
    kick: ['x...x...x...x...'], snare: ['....x.......x...'], hat: ['..x...x...x...x.'], ohat: ['..x...x...x...x.'],
    bass: ['.RRR.RRR.RRR.RRR', '.RoR.RoR.RoR.RoR'],
    arp: ['updown', 'up'], arpWave: ['sawtooth'], pad: ['sawtooth'], lead: ['sawtooth', 'square'], pump: [true], bright: [0.7, 0.9],
  },
  breakbeat: {
    label: ['Drum & Bass', 'Breakbeat', 'Jungle'],
    bpm: [168, 174], mode: ['minor'], root: [38, 45],
    kick: ['x.........x.....', 'x.........x..x..'], snare: ['....x.......x...', '....x..x....x...'], hat: ['xxxxxxxxxxxxxxxx', 'x.xxx.xxx.xxx.xx'],
    bass: ['R.......R.R.....', 'R...R.....R.R...'],
    arp: [false, 'down'], arpWave: ['triangle'], pad: ['sawtooth', 'triangle'], lead: ['sawtooth', false], bright: [0.45, 0.65],
  },
  funk: {
    label: ['Disco Funk', 'Funk Drive', 'Boogie'],
    bpm: [112, 122], mode: ['major', 'minor'], root: [43, 50],
    kick: ['x...x...x...x...'], snare: ['....x.......x...'], hat: ['x.x.x.x.x.x.x.x.'], ohat: ['..x...x...x...x.'],
    bass: ['R.o.R.o.R.o.R.o.', 'R..oR.o.R..oR.oR'],
    stab: ['..x.......x.....', '..x..x....x..x..'], stabWave: ['square', 'triangle'],
    arp: [false, 'up'], arpWave: ['triangle'], pad: ['triangle'], lead: ['square', 'triangle'], swing: [0.04, 0.08], bright: [0.65, 0.85],
  },
};
export const STYLE_IDS = Object.keys(STYLES);

/** A brand new song in a style (random each call unless a seed is given). */
export function randomSong(style = pick(Math.random, STYLE_IDS), seed = Math.floor(Math.random() * 1e9)) {
  const st = STYLES[style], rng = seeded(seed);
  const t = { id: `${style}-${seed}`, seed };
  for (const [k, v] of Object.entries(st)) {
    if (k === 'label') continue;
    t[k] = typeof v[0] === 'number' && v.length === 2 && k !== 'mode' ? (Number.isInteger(v[0]) ? range(rng, v[0], v[1]) : v[0] + rng() * (v[1] - v[0])) : pick(rng, v);
  }
  t.prog = pick(rng, PROGS[t.mode]);
  t.label = `${pick(rng, st.label)} · ${NOTE_NAMES[t.root % 12]} ${t.mode} · ${t.bpm} BPM`;
  return t;
}

// Maps that always get house (a new house tune each time)
const HOUSE_MAPS = ['gyro', 'skyline', 'chaos', 'twin', 'stadium'];

/**
 * The soundtrack for a map: Neon Junction keeps its signature tune; house
 * maps get a fresh house song; everything else gets a random song in a
 * random style, new every time the map loads.
 */
export function musicFor(mapId) {
  if (mapId === 'junction') return 'neon';
  return randomSong(HOUSE_MAPS.includes(mapId) ? 'house' : undefined);
}

// Song form: bars per section and which parts play
const FORM = [
  { bars: 4, parts: ['pad', 'arp', 'hat', 'stab'] },
  { bars: 8, parts: ['pad', 'arp', 'hat', 'kick', 'snare', 'bass', 'ohat', 'clap'] },
  { bars: 8, parts: ['pad', 'arp', 'hat', 'kick', 'snare', 'bass', 'lead', 'ohat', 'clap', 'stab'] },
  { bars: 4, parts: ['pad', 'arp', 'bass', 'stab'] },
  { bars: 8, parts: ['pad', 'arp', 'hat', 'kick', 'snare', 'bass', 'lead', 'ohat', 'clap', 'stab'] },
];

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export class Music {
  constructor(ctx, dest, noise) {
    this.ctx = ctx;
    this.noise = noise;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    // Gentle bus compression so the mix sits under the sound effects
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.out.connect(comp).connect(dest);
    // Pads and stabs go through a bus that ducks on every kick (house "pump")
    this.pumpBus = ctx.createGain();
    this.pumpBus.connect(this.out);
    this.track = null;
    this.timer = null;
    this.volume = 0.16;
  }

  /** Play a named track, or a generated song object (see randomSong). */
  play(name) {
    const t = typeof name === 'object' ? name : TRACKS[name];
    const id = typeof name === 'object' ? name.id : name;
    if (!t || this.name === id) return;
    this.name = id;
    this.track = t;
    this.step = 0;
    this.bar = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.rng = seeded(t.seed ?? id.length * 977 + t.bpm);
    this.motif = this.makeMotif();
    const g = this.out.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0, now);
    g.linearRampToValueAtTime(this.enabled === false ? 0 : this.volume, now + 1.5);
    if (!this.timer) this.timer = setInterval(() => this.schedule(), 25);
  }

  setEnabled(on) {
    this.enabled = on;
    const g = this.out.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(on ? this.volume : 0, now, 0.2);
  }

  /** A 2-bar melodic hook built from the scale, reused with variations. */
  makeMotif() {
    const notes = [];
    const rhythm = ['x..x..x.x...x.x.', 'x.x...x..x.x....', 'x...x.x.x..x..x.'][Math.floor(this.rng() * 3)];
    for (let bar = 0; bar < 2; bar++) {
      for (let s = 0; s < 16; s++) {
        if (rhythm[s] !== 'x') continue;
        notes.push({ step: bar * 16 + s, degree: Math.floor(this.rng() * 5) + (bar ? 2 : 0), len: this.rng() < 0.3 ? 3 : 1.5 });
      }
    }
    return notes;
  }

  scaleNote(degree, octave = 0) {
    const sc = MODES[this.track.mode];
    const o = Math.floor(degree / 7);
    return this.track.root + sc[((degree % 7) + 7) % 7] + 12 * (o + octave);
  }

  chord(bar) {
    const d = this.track.prog[bar % this.track.prog.length];
    return [d, d + 2, d + 4].map((x) => this.scaleNote(x));
  }

  section(bar) {
    const total = FORM.reduce((a, f) => a + f.bars, 0);
    let b = bar % total;
    // After the first pass, skip the intro
    if (bar >= total) b = FORM[0].bars + ((bar - total) % (total - FORM[0].bars));
    for (const f of FORM) {
      if (b < f.bars) return f;
      b -= f.bars;
    }
    return FORM[1];
  }

  schedule() {
    if (!this.track) return;
    const ctx = this.ctx, t = this.track;
    const spb = 60 / t.bpm / 4; // seconds per 16th
    while (this.nextTime < ctx.currentTime + 0.15) {
      const s = this.step % 16;
      const bar = Math.floor(this.step / 16);
      const sec = this.section(bar);
      const has = (p) => sec.parts.includes(p);
      const time = this.nextTime + (s % 2 ? (t.swing || 0) * spb * 2 : 0); // swing the off 16ths
      const chord = this.chord(bar);
      if (has('kick') && t.kick[s] === 'x') {
        this.kick(time);
        if (t.pump) this.duck(time, spb * 4);
      }
      if (has('snare') && t.snare[s] === 'x') this.snare(time);
      if (has('clap') && t.clap?.[s] === 'x') this.clap(time);
      if (has('hat') && t.hat[s] === 'x') this.hat(time, s % 4 === 2 ? 0.5 : 0.3);
      if (has('ohat') && t.ohat?.[s] === 'x') this.openHat(time);
      if (has('stab') && t.stab?.[s] === 'x') this.stab(time, chord, spb * 1.5);
      if (has('bass') && t.bass[s] !== '.') this.bass(time, chord[0] - 12 + (t.bass[s] === 'o' ? 12 : 0), spb * 0.9);
      if (has('pad') && s === 0) this.pad(time, chord, spb * 16);
      if (has('arp') && s % 2 === 0) {
        const tones = [...chord, chord[0] + 12, chord[1] + 12];
        const i = s / 2;
        const idx = t.arp === 'down' ? tones.length - 1 - (i % tones.length) : t.arp === 'updown' ? [0, 1, 2, 3, 4, 3, 2, 1][i % 8] : i % tones.length;
        this.arp(time, tones[idx] + 12, spb * 1.6);
      }
      if (t.lead && has('lead')) {
        const pos = this.step % 32;
        for (const n of this.motif) {
          if (n.step !== pos) continue;
          const vary = bar % 4 === 3 ? 1 : 0; // lift the hook every 4th bar
          this.lead(time, this.scaleNote(t.prog[bar % t.prog.length] + n.degree + vary, 1), spb * n.len * 2);
        }
      }
      this.nextTime += spb;
      this.step++;
    }
  }

  // ---------------- instruments ----------------

  env(g, time, a, peak, d, sus = 0.0001) {
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + a);
    g.gain.exponentialRampToValueAtTime(Math.max(sus, 0.0001), time + a + d);
  }

  kick(time) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, time);
    o.frequency.exponentialRampToValueAtTime(42, time + 0.12);
    this.env(g, time, 0.003, 0.9, 0.35);
    o.connect(g).connect(this.out);
    o.start(time);
    o.stop(time + 0.4);
  }

  noiseHit(time, type, freq, dur, vol, q = 0.8) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, time, 0.002, vol, dur);
    s.connect(f).connect(g).connect(this.out);
    s.start(time, Math.random() * 0.5);
    s.stop(time + dur + 0.05);
  }

  /** Sidechain pump: dip the pad/stab bus on the kick, swell back up over the beat. */
  duck(time, beat) {
    const g = this.pumpBus.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(0.25, time);
    g.linearRampToValueAtTime(1, time + beat * 0.85);
  }

  clap(time) {
    // A few quick noise bursts smeared together, then a short tail
    for (let i = 0; i < 3; i++) this.noiseHit(time + i * 0.011, 'bandpass', 1300, 0.02, 0.32, 1.2);
    this.noiseHit(time + 0.033, 'bandpass', 1200, 0.16, 0.34, 0.9);
  }

  openHat(time) {
    this.noiseHit(time, 'highpass', 6500, 0.2, 0.2);
  }

  /** Piano/organ chord stab: bright attack, quick decay, into the pump bus. */
  stab(time, chord, dur) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3200, time);
    f.frequency.exponentialRampToValueAtTime(900, time + dur);
    this.env(g, time, 0.004, 0.09, dur);
    f.connect(g).connect(this.track.pump ? this.pumpBus : this.out);
    for (const n of chord) {
      for (const [mul, wave] of [[1, this.track.stabWave || 'triangle'], [2, 'sine']]) {
        const o = ctx.createOscillator();
        o.type = wave;
        o.frequency.value = mtof(n + 12) * mul;
        o.connect(f);
        o.start(time);
        o.stop(time + dur + 0.05);
      }
    }
  }

  snare(time) {
    this.noiseHit(time, 'bandpass', 1900, 0.18, 0.5, 0.7);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(220, time);
    o.frequency.exponentialRampToValueAtTime(140, time + 0.08);
    this.env(g, time, 0.002, 0.25, 0.1);
    o.connect(g).connect(this.out);
    o.start(time);
    o.stop(time + 0.15);
  }

  hat(time, vol) {
    this.noiseHit(time, 'highpass', 7500, 0.04, vol * 0.5);
  }

  bass(time, note, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = mtof(note);
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(300 + 900 * this.track.bright, time);
    f.frequency.exponentialRampToValueAtTime(180, time + dur);
    this.env(g, time, 0.005, 0.32, dur);
    o.connect(f).connect(g).connect(this.out);
    o.start(time);
    o.stop(time + dur + 0.05);
  }

  pad(time, chord, dur) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass';
    f.frequency.value = 700 + 900 * this.track.bright;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.07, time + dur * 0.25);
    g.gain.linearRampToValueAtTime(0.0001, time + dur);
    f.connect(g).connect(this.track.pump ? this.pumpBus : this.out);
    for (const n of chord) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = this.track.pad;
        o.frequency.value = mtof(n);
        o.detune.value = det;
        o.connect(f);
        o.start(time);
        o.stop(time + dur + 0.05);
      }
    }
  }

  arp(time, note, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = this.track.arpWave;
    o.frequency.value = mtof(note);
    f.type = 'lowpass';
    f.frequency.value = 1200 + 2600 * this.track.bright;
    this.env(g, time, 0.004, 0.09, dur);
    o.connect(f).connect(g).connect(this.out);
    o.start(time);
    o.stop(time + dur + 0.05);
  }

  lead(time, note, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    o.type = this.track.lead;
    o.frequency.value = mtof(note);
    lfo.frequency.value = 5.5;
    lg.gain.value = 6; // vibrato in cents
    lfo.connect(lg).connect(o.detune);
    f.type = 'lowpass';
    f.frequency.value = 2400;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.11, time + 0.02);
    g.gain.setValueAtTime(0.11, time + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(f).connect(g).connect(this.out);
    o.start(time);
    lfo.start(time);
    o.stop(time + dur + 0.05);
    lfo.stop(time + dur + 0.05);
  }
}
