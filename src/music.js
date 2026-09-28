/**
 * Procedural soundtrack: a small step sequencer that schedules synthesized
 * drums, bass, pads, arpeggios and a lead ahead of time on the WebAudio
 * clock. Each track is a key, mode, chord progression, tempo and a set of
 * patterns; songs cycle through intro / verse / chorus / breakdown sections.
 */

const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10], // minor with a flat second: dark, half-step heavy
};

// x = hit, . = rest. 16 steps per bar.
// riff: X = long power chord, x = short palm-muted chug. acid: 0-7 = scale
// step above the chord root, o = the root an octave up, . = rest.
export const TRACKS = {
  // The menu tune (Vapor City style), built up a layer at a time as you go through the menu
  menu: {
    bpm: 126, root: 45, mode: 'minor', prog: [0, 5, 3, 6],
    kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.xxx.xxx.xxx.xx', ohat: '..x...x...x...x.',
    bass: 'R.RR.RoRR.RR.RoR', arp: 'updown', arpWave: 'sawtooth', pad: 'sawtooth', lead: 'sawtooth',
    acid: '0..0o.3.0..5.3o.', riff: 'X.......X...x.x.', echo: 0.4, bright: 0.6, kit: 'hard',
  },
  // Neon Junction keeps its signature tune
  neon: {
    bpm: 110, root: 45, mode: 'minor', prog: [0, 5, 2, 6],
    kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...xx',
    bass: 'RRRRRRRRRRRRRRRR', arp: 'up', arpWave: 'sawtooth', pad: 'sawtooth', lead: 'sawtooth', bright: 0.65,
  },
};

// ---------------- random songs ----------------
// Three styles modelled on a 2000s arcade-racer soundtrack: every map load
// rolls a fresh song in one of them (except Neon Junction).

const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const range = (rng, lo, hi) => lo + Math.round(rng() * (hi - lo));
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PROGS = {
  phrygian: [[0, 0, 1, 0], [0, 1, 0, 6], [0, 0, 6, 1], [0, 5, 6, 0]],
  minor: [[0, 5, 2, 6], [0, 3, 4, 0], [0, 5, 6, 4], [0, 6, 5, 6], [0, 0, 5, 6], [0, 3, 6, 5]],
  major: [[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4]],
};

/**
 * Each field is a list to pick from (or a [lo, hi] range for numbers), so
 * every song keeps its style's groove but gets its own key, tempo, chords,
 * patterns and hook.
 */
const STYLES = {
  // Misty city at night: echoing arpeggios over a rolling bass, broken beats, risers
  vapor: {
    // Measured from the reference: ~140 BPM, dark phrygian minor (flat 2nd), a loud
    // sub bass bouncing between octaves with half-step neighbours, breakbeat drums
    // with 16th hats leaning on the off-16ths, a lead that hammers the root with
    // minor-third / fifth / octave leaps, and groove / big-section alternation
    label: ['Vapor Drive', 'Neon Fog', 'Night Circuit', 'Steam Grid'],
    bpm: [137, 142], mode: ['phrygian'], root: [37, 42],
    kick: ['x..x..x...x.x...', 'x.x...x..x..x...', 'x..x.x....x..x..'],
    snare: ['....x.......x...', '....x..x....x...', '....x.......x.x.'],
    hat: ['xxxxxxxxxxxxxxxx', 'x.xxx.xxx.xxx.xx'], hatAccent: ['off16'],
    ohat: ['..x...x...x...x.', '......x.......x.'],
    // Groove sections: busy 16ths (R root, o octave, u half-step up, d half-step down)
    bass: ['RoRuRoRdRoRuoRoR', 'RRoRuRoRRRoRdRoR', 'RoRRuoRoRoRRdoRo'],
    // Big sections: longer notes
    bassB: ['R...o...R.u.o...', 'R.....o.R...u...', 'R...R.o...d.R...'],
    arp: ['down', 'updown'], arpWave: ['square', 'sawtooth'], pad: ['sawtooth'], lead: ['sawtooth', 'square'],
    leadDegrees: [[0, 0, 0, 2, 4, 7]], stab: ['..x.......x.....', '......x.......x.'], stabWave: ['sawtooth'],
    acid: [false], riff: [false, 'X.......X.......'],
    echo: [0.3, 0.42], sweep: [true], bright: [0.5, 0.62], bassGain: [1.2], up: [12],
  },
  // Out in orbit: pumping four-on-the-floor, squelchy acid line, spacey echoes
  space: {
    label: ['Space Out', 'Orbit Run', 'Starfield', 'Zero-G'],
    bpm: [132, 140], mode: ['minor', 'minor', 'major'], root: [45, 52],
    kick: ['x...x...x...x...'], snare: ['................', '....x.......x...'], clap: ['....x.......x...'],
    hat: ['..x...x...x...x.', 'x.x.x.x.x.x.x.x.'], ohat: ['..x...x...x...x.'],
    bass: ['.RRR.RRR.RRR.RRR', '.RoR.RoR.RoR.RoR', '..R...R...R...R.'],
    acid: ['0.0o.03.0.5.0o.3', '00.3.0o.0.30.o5.', '0..o0.3.0..o5.3.', '0o0.30o.0o0.5o3.'],
    arp: ['up', 'updown'], arpWave: ['triangle', 'sawtooth'], pad: ['sawtooth'], lead: ['sawtooth', false],
    riff: [false], echo: [0.45, 0.6], pump: [true], sweep: [true], bright: [0.65, 0.8],
  },
  // Monster trucks off the leash: hard breakbeat, distorted guitar riffs
  beasts: {
    label: ['Road Beasts', 'Chrome Riot', 'Turbo Brawl', 'Iron Stampede'],
    bpm: [138, 148], mode: ['minor'], root: [38, 45],
    kick: ['x.x...x...x..x..', 'x..x..x...x..x..', 'x.x...x.x.x.....'],
    snare: ['....x.......x...', '....x..x....x...', '....x.......x.x.'],
    hat: ['x.x.x.x.x.x.x.x.', 'xxxxxxxxxxxxxxxx'], ohat: ['................', '......x.......x.'],
    bass: ['R.RR.RR.R.RR.R..', 'RRoRRRoRRRoRRoRR', 'R.R.RRR.R.R.RR.R'],
    riff: ['X..x.xx.X..x.x..', 'x.xxx.x.x.xxx.X.', 'X.x.x.X.x.x.X.xx', 'X...X.x.X...X.xx'],
    arp: [false, 'down'], arpWave: ['square'], pad: ['sawtooth'], lead: ['square', 'sawtooth'],
    acid: [false], stab: [false], echo: [0.15, 0.25], sweep: [true], bright: [0.55, 0.7],
  },
};
export const STYLE_IDS = Object.keys(STYLES);

/** A brand new song in a style (random each call unless a seed is given). */
export function randomSong(style = pick(Math.random, STYLE_IDS), seed = Math.floor(Math.random() * 1e9)) {
  const st = STYLES[style], rng = seeded(seed);
  const t = { id: `${style}-${seed}`, seed };
  for (const [k, v] of Object.entries(st)) {
    if (k === 'label') continue;
    t[k] = typeof v[0] === 'number' && v.length === 2 ? (Number.isInteger(v[0]) ? range(rng, v[0], v[1]) : v[0] + rng() * (v[1] - v[0])) : pick(rng, v);
  }
  t.prog = pick(rng, PROGS[t.mode]);
  t.form = style;
  t.kit = 'hard'; // punchier drums and a reese bass
  t.label = `${pick(rng, st.label)} · ${NOTE_NAMES[t.root % 12]} ${t.mode} · ${t.bpm} BPM`;
  return t;
}

/**
 * The soundtrack for a map: Neon Junction keeps its signature tune; every
 * other map (and the battle arenas) gets a fresh random song each time.
 */
export function musicFor(mapId) {
  if (mapId === 'junction') return 'neon';
  return randomSong();
}

// Each style has its own arrangement, so it announces itself from the first bar
const ALL = ['pad', 'arp', 'hat', 'kick', 'snare', 'bass', 'lead', 'ohat', 'clap', 'stab', 'riff', 'acid'];
const FORMS = {
  // Guitar and drums straight away, like a rock intro
  beasts: [
    { bars: 4, parts: ['riff', 'kick', 'snare', 'hat'] },
    { bars: 8, parts: ['riff', 'kick', 'snare', 'hat', 'ohat', 'bass'] },
    { bars: 8, parts: ['riff', 'kick', 'snare', 'hat', 'ohat', 'bass', 'lead', 'pad'] },
    { bars: 4, parts: ['pad', 'bass', 'hat', 'arp'] },
    { bars: 8, parts: ALL },
  ],
  // The acid line opens and never leaves
  space: [
    { bars: 4, parts: ['acid', 'pad', 'hat'] },
    { bars: 8, parts: ['acid', 'kick', 'clap', 'snare', 'hat', 'ohat', 'bass', 'pad'] },
    { bars: 8, parts: ['acid', 'kick', 'clap', 'snare', 'hat', 'ohat', 'bass', 'pad', 'arp', 'lead'] },
    { bars: 4, parts: ['acid', 'pad', 'arp'] },
    { bars: 8, parts: ALL },
  ],
  // Measured layout: short intro with no hats, then ~16-bar groove and big
  // sections alternating, with a build before some big sections
  vapor: [
    { bars: 4, parts: ['bass', 'pad'] },
    { bars: 16, parts: ['bass', 'kick', 'snare', 'hat', 'pad'] },
    { bars: 16, parts: ['bass', 'kick', 'snare', 'hat', 'ohat', 'pad', 'lead', 'arp', 'stab', 'riff'] },
    { bars: 16, parts: ['bass', 'kick', 'snare', 'hat', 'pad', 'arp'] },
    { bars: 4, parts: ['bass', 'hat', 'snare', 'pad'] },
    { bars: 16, parts: ['bass', 'kick', 'snare', 'hat', 'ohat', 'pad', 'lead', 'arp', 'stab', 'riff'] },
  ],
};

// Default song form (Neon Junction): bars per section and which parts play
const FORM = [
  { bars: 4, parts: ['pad', 'arp', 'hat', 'acid'] },
  { bars: 8, parts: ['pad', 'arp', 'hat', 'kick', 'snare', 'bass', 'ohat', 'clap', 'acid'] },
  { bars: 8, parts: ['pad', 'arp', 'hat', 'kick', 'snare', 'bass', 'lead', 'ohat', 'clap', 'stab', 'riff', 'acid'] },
  { bars: 4, parts: ['pad', 'arp', 'bass', 'acid'] },
  { bars: 8, parts: ['pad', 'arp', 'hat', 'kick', 'snare', 'bass', 'lead', 'ohat', 'clap', 'stab', 'riff', 'acid'] },
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
    // Echo send (a filtered, feeding-back delay) for the spacey arps, leads and acid
    this.echoIn = ctx.createGain();
    this.echo = ctx.createDelay(2);
    const fb = ctx.createGain(), tone = ctx.createBiquadFilter();
    fb.gain.value = 0.42;
    tone.type = 'lowpass';
    tone.frequency.value = 2600;
    this.echoIn.connect(this.echo).connect(tone).connect(fb).connect(this.echo);
    tone.connect(this.out);
    // Distortion curve for the guitar
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 6) * 0.8;
    }
    this.fuzz = curve;
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
    this.layers = this.pendingLayers = null;
    this.echo.delayTime.value = (60 / t.bpm) * 0.75; // dotted eighth
    this.echoIn.gain.value = t.echo || 0;
    this.rng = seeded(t.seed ?? id.length * 977 + t.bpm);
    this.motif = this.makeMotif();
    const g = this.out.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0, now);
    g.linearRampToValueAtTime(this.enabled === false ? 0 : this.volume, now + 1.5);
    if (!this.timer) this.timer = setInterval(() => this.schedule(), 25);
  }

  /** Only play these parts (null = normal song form). Changes land on the next bar, in time. */
  setLayers(parts) {
    this.pendingLayers = parts ? [...parts] : null;
    if (!this.track) this.layers = this.pendingLayers;
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
        const pool = this.track.leadDegrees;
        const degree = pool ? pool[Math.floor(this.rng() * pool.length)] : Math.floor(this.rng() * 5) + (bar ? 2 : 0);
        notes.push({ step: bar * 16 + s, degree, len: this.rng() < 0.3 ? 3 : 1.5 });
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
    const form = FORMS[this.track.form] || FORM;
    const total = form.reduce((a, f) => a + f.bars, 0);
    let b = bar % total;
    // After the first pass, skip the intro
    if (bar >= total) b = form[0].bars + ((bar - total) % (total - form[0].bars));
    for (const f of form) {
      if (b < f.bars) return f;
      b -= f.bars;
    }
    return form[1];
  }

  schedule() {
    if (!this.track) return;
    const ctx = this.ctx, t = this.track;
    const spb = 60 / t.bpm / 4; // seconds per 16th
    while (this.nextTime < ctx.currentTime + 0.15) {
      const s = this.step % 16;
      const bar = Math.floor(this.step / 16);
      const sec = this.section(bar);
      if (s === 0 && this.pendingLayers !== undefined) this.layers = this.pendingLayers;
      const has = (p) => (this.layers ? this.layers.includes(p) : sec.parts.includes(p));
      const time = this.nextTime + (s % 2 ? (t.swing || 0) * spb * 2 : 0); // swing the off 16ths
      const chord = this.chord(bar);
      if (has('kick') && t.kick[s] === 'x') {
        this.kick(time);
        if (t.pump) this.duck(time, spb * 4);
      }
      if (has('snare') && t.snare[s] === 'x') this.snare(time);
      if (has('clap') && t.clap?.[s] === 'x') this.clap(time);
      if (has('hat') && t.hat[s] === 'x') this.hat(time, t.hatAccent === 'off16' ? (s % 2 ? 0.5 : 0.22) : s % 4 === 2 ? 0.5 : 0.3);
      if (has('ohat') && t.ohat?.[s] === 'x') this.openHat(time);
      const hi = t.up ? chord.map((n) => n + t.up) : chord; // melodic parts can sit above a low bass root
      if (has('stab') && t.stab?.[s] === 'x') this.stab(time, hi, spb * 1.5);
      const bl = t.bassB && has('lead') ? t.bassB : t.bass; // big sections can have their own bassline
      if (has('bass') && bl[s] !== '.') {
        const off = { o: 12, u: 1, d: -1 }[bl[s]] || 0;
        let len = 1;
        while (len < 8 && bl[(s + len) % 16] === '.') len++;
        this.bass(time, chord[0] - 12 + off, spb * Math.min(len, 4) * 0.9);
      }
      if (has('pad') && s === 0) this.pad(time, hi, spb * 16);
      if (has('riff') && t.riff && t.riff[s] !== '.') this.guitar(time, chord[0] - 12, t.riff[s] === 'X' ? spb * 3.5 : spb * 0.8, t.riff[s] === 'X');
      if (has('acid') && t.acid && t.acid[s] !== '.') {
        const c = t.acid[s];
        const deg = t.prog[bar % t.prog.length] + (c === 'o' ? 7 : +c);
        this.acid(time, this.scaleNote(deg, -1), spb * 0.9, s % 4 === 0);
      }
      // Riser into a section where the drums come in
      if (t.sweep && s === 0 && !this.layers) {
        const next = this.section(bar + 1);
        if (next !== sec && next.parts.includes('kick') && !sec.parts.includes('riff') && next.parts.length > sec.parts.length) this.sweep(time, spb * 16);
      }
      if (has('arp') && s % 2 === 0) {
        const tones = [...hi, hi[0] + 12, hi[1] + 12];
        const i = s / 2;
        const idx = t.arp === 'down' ? tones.length - 1 - (i % tones.length) : t.arp === 'updown' ? [0, 1, 2, 3, 4, 3, 2, 1][i % 8] : i % tones.length;
        this.arp(time, tones[idx] + 12, spb * 1.6);
      }
      if (t.lead && has('lead')) {
        const pos = this.step % 32;
        for (const n of this.motif) {
          if (n.step !== pos) continue;
          const vary = bar % 4 === 3 ? 1 : 0; // lift the hook every 4th bar
          this.lead(time, this.scaleNote(t.prog[bar % t.prog.length] + n.degree + vary, 1) + (t.up || 0), spb * n.len * 2);
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

  /** Distorted power chord (root, fifth, octave): short chug or ringing hit. */
  guitar(time, root, dur, accent) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter(), sh = ctx.createWaveShaper(), hp = ctx.createBiquadFilter(), cab = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass';
    f.frequency.value = accent ? 2600 : 1400;
    sh.curve = this.fuzz;
    hp.type = 'highpass';
    hp.frequency.value = 90;
    cab.type = 'lowpass'; // speaker-cabinet roll-off
    cab.frequency.value = 3800;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(accent ? 0.075 : 0.06, time + 0.005);
    g.gain.setValueAtTime(accent ? 0.07 : 0.05, time + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    f.connect(sh).connect(hp).connect(cab).connect(g).connect(this.out);
    for (const [st, det] of [[0, -6], [7, 5], [12, 0]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(root + st);
      o.detune.value = det;
      o.connect(f);
      o.start(time);
      o.stop(time + dur + 0.05);
    }
  }

  /** Squelchy acid line: resonant low-pass with a snappy envelope. */
  acid(time, note, dur, accent) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = mtof(note + 12);
    f.type = 'lowpass';
    f.Q.value = 14;
    const top = (accent ? 2600 : 1500) * (0.6 + this.track.bright * 0.6);
    f.frequency.setValueAtTime(top, time);
    f.frequency.exponentialRampToValueAtTime(260, time + dur);
    this.env(g, time, 0.003, accent ? 0.075 : 0.05, dur);
    o.connect(f).connect(g);
    g.connect(this.out);
    g.connect(this.echoIn);
    o.start(time);
    o.stop(time + dur + 0.05);
  }

  /** Noise riser across a bar, into the next section. */
  sweep(time, dur) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise;
    s.loop = true;
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(300, time);
    f.frequency.exponentialRampToValueAtTime(6000, time + dur);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.09, time + dur * 0.95);
    g.gain.linearRampToValueAtTime(0.0001, time + dur);
    s.connect(f).connect(g).connect(this.out);
    s.start(time);
    s.stop(time + dur + 0.05);
  }

  kick(time) {
    const ctx = this.ctx;
    if (this.track.kit === 'hard') {
      // Punchy: a pitched thump, a click on top, a little drive
      const o = ctx.createOscillator(), g = ctx.createGain(), sh = ctx.createWaveShaper();
      o.frequency.setValueAtTime(190, time);
      o.frequency.exponentialRampToValueAtTime(48, time + 0.09);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 180;
      sh.curve = this.fuzz;
      this.env(g, time, 0.002, 0.6, 0.3);
      o.connect(sh).connect(lp).connect(g).connect(this.out);
      o.start(time);
      o.stop(time + 0.35);
      this.noiseHit(time, 'highpass', 3500, 0.012, 0.35);
      return;
    }
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
    this.noiseHit(time, 'highpass', 6500, 0.2, this.track.kit === 'hard' ? 0.34 : 0.2);
  }

  /** Piano/organ chord stab: bright attack, quick decay, into the pump bus. */
  stab(time, chord, dur) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(this.track.kit === 'hard' ? 5500 : 3200, time);
    f.frequency.exponentialRampToValueAtTime(this.track.kit === 'hard' ? 1400 : 900, time + dur);
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
    if (this.track.kit === 'hard') {
      // Snappy: bright crack, body and a tail that catches the echo
      this.noiseHit(time, 'bandpass', 2600, 0.22, 0.6, 0.6);
      this.noiseHit(time, 'bandpass', 4200, 0.14, 0.8, 0.7);
      this.noiseHit(time, 'highpass', 6000, 0.07, 0.35);
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.frequency.setValueAtTime(240, time);
      o.frequency.exponentialRampToValueAtTime(160, time + 0.06);
      this.env(g, time, 0.002, 0.3, 0.09);
      o.connect(g).connect(this.out);
      g.connect(this.echoIn);
      o.start(time);
      o.stop(time + 0.15);
      return;
    }
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
    if (this.track.kit === 'hard') {
      // Crisp and forward, with some air on top
      this.noiseHit(time, 'bandpass', 4800, 0.05, vol * 1.9, 0.8);
      this.noiseHit(time, 'highpass', 7000, 0.045, vol * 1.1);
      this.noiseHit(time, 'highpass', 10000, 0.03, vol * 0.6);
      return;
    }
    this.noiseHit(time, 'highpass', 7500, 0.04, vol * 0.5);
  }

  bass(time, note, dur) {
    const ctx = this.ctx;
    if (this.track.kit === 'hard') {
      // Reese: two detuned saws and a sub, growled through a little drive
      const f = ctx.createBiquadFilter(), sh = ctx.createWaveShaper(), g = ctx.createGain();
      f.type = 'lowpass';
      f.Q.value = 4;
      f.frequency.setValueAtTime(320 + 500 * this.track.bright, time);
      f.frequency.exponentialRampToValueAtTime(200, time + dur);
      sh.curve = this.fuzz;
      this.env(g, time, 0.004, 0.16 * (this.track.bassGain || 1), dur);
      f.connect(sh).connect(g).connect(this.out);
      for (const [type, mul, det] of [['sawtooth', 1, -14], ['sawtooth', 1, 14]]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = mtof(note) * mul;
        o.detune.value = det;
        o.connect(f);
        o.start(time);
        o.stop(time + dur + 0.05);
      }
      // Clean sine sub underneath, kept out of the distortion
      const sub = ctx.createOscillator(), sg = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.value = mtof(note < 36 ? note : note - 12);
      this.env(sg, time, 0.004, 0.3 * (this.track.bassGain || 1), dur);
      sub.connect(sg).connect(this.out);
      sub.start(time);
      sub.stop(time + dur + 0.05);
      return;
    }
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
    g.gain.linearRampToValueAtTime(this.track.kit === 'hard' ? 0.045 : 0.07, time + dur * 0.25);
    g.gain.linearRampToValueAtTime(0.0001, time + dur);
    if (this.track.kit === 'hard') {
      // Keep the pad out of the bass's way (no low-mid mud)
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 450;
      f.connect(hp).connect(g);
    } else f.connect(g);
    g.connect(this.track.pump ? this.pumpBus : this.out);
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
    g.connect(this.echoIn);
    o.start(time);
    o.stop(time + dur + 0.05);
  }

  lead(time, note, dur) {
    const ctx = this.ctx;
    if (this.track.kit === 'hard') {
      // Supersaw pluck: three detuned saws and a bell an octave up, a filter
      // that snaps shut after the attack and no vibrato (a held, wobbling
      // saw reads as brass)
      const f = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'lowpass';
      f.Q.value = 3;
      f.frequency.setValueAtTime(7500, time);
      f.frequency.exponentialRampToValueAtTime(1700, time + 0.16);
      hp.type = 'highpass';
      hp.frequency.value = 350;
      const len = Math.min(dur, 0.6);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.12, time + 0.004);
      g.gain.exponentialRampToValueAtTime(0.05, time + 0.18);
      g.gain.exponentialRampToValueAtTime(0.0001, time + len);
      f.connect(hp).connect(g).connect(this.out);
      g.connect(this.echoIn);
      for (const [type, mul, det, lvl] of [['sawtooth', 1, -11, 1], ['sawtooth', 1, 0, 1], ['sawtooth', 1, 11, 1], ['sine', 2, 0, 1.6]]) {
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = type;
        o.frequency.value = mtof(note) * mul;
        o.detune.value = det;
        og.gain.value = lvl / 3;
        o.connect(og).connect(f);
        o.start(time);
        o.stop(time + len + 0.05);
      }
      return;
    }
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
    g.connect(this.echoIn);
    o.start(time);
    lfo.start(time);
    o.stop(time + dur + 0.05);
    lfo.stop(time + dur + 0.05);
  }
}
