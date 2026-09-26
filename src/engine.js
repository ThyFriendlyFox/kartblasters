/**
 * Synthesized combustion engine. An AudioWorklet fires one exhaust pulse per
 * cylinder at the right crank angle (4-stroke: every cylinder fires once per
 * 720 degrees). Each pulse excites an exhaust-pipe resonance and goes through a
 * muffler low-pass, so the result has real engine "beats" rather than a
 * buzzing oscillator. Engine layouts give each car its own character.
 */

// Crank angles (0-720) where cylinders fire, plus per-cylinder pulse strength.
// Uneven strengths/angles are what make a cross-plane V8 burble.
const even = (n) => Array.from({ length: n }, (_, i) => (720 / n) * i);

export const ENGINES = {
  v12: { label: 'V12', fire: even(12), amp: [1, 0.95, 1, 0.97, 0.99, 0.95, 1, 0.96, 0.98, 0.95, 1, 0.97], res: 210, res2: 520, idle: 900, redline: 6200, body: 0.8 },
  v8: { label: 'V8', fire: [0, 90, 180, 270, 360, 450, 540, 630], amp: [1, 0.62, 0.9, 0.55, 1, 0.7, 0.85, 0.5], jitter: 5, res: 115, res2: 330, idle: 700, redline: 5200, body: 1 },
  v10: { label: 'V10', fire: even(10), amp: [1, 0.9, 0.97, 0.88, 1, 0.92, 0.95, 0.9, 1, 0.9], res: 260, res2: 700, idle: 1050, redline: 6600, body: 0.7 },
  flat4: { label: 'Flat-4', fire: [0, 180, 360, 540], amp: [1, 0.8, 0.95, 0.75], jitter: 8, uneven: [0, 12, -8, 6], res: 140, res2: 400, idle: 850, redline: 5400, body: 0.9 },
  bigv8: { label: 'Big-block V8', fire: [0, 90, 180, 270, 360, 450, 540, 630], amp: [1, 0.55, 0.95, 0.5, 1, 0.65, 0.9, 0.45], jitter: 7, res: 85, res2: 240, idle: 600, redline: 4300, body: 1.15 },
};

export const CAR_ENGINES = { hyper: 'v12', muscle: 'v8', formula: 'v10', buggy: 'flat4', truck: 'bigv8' };

const WORKLET = `
class EngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 900, minValue: 100, maxValue: 12000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'gain', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.phase = 0;
    this.exc = 0;
    this.nz = 0;
    this.y1 = this.y2 = this.z1 = this.z2 = 0;
    this.lp = this.lp2 = 0;
    this.th = this.dcx = this.dcy = 0;
    this.drive = 1;
    this.pop = 0;
    this.lastLoad = 0;
    this.setEngine({ fire: [0, 360], amp: [1, 1], res: 120, res2: 300, body: 1 });
    this.port.onmessage = (e) => this.setEngine(e.data);
  }
  setEngine(e) {
    this.fire = e.fire;
    this.amp = e.amp;
    this.uneven = e.uneven || e.fire.map(() => 0);
    this.jitterDeg = e.jitter || 2;
    this.resHz = e.res;
    this.res2Hz = e.res2;
    this.body = e.body || 1;
    this.drive = e.drive || 1;
    this.offs = this.fire.map(() => 0);
  }
  // Two-pole resonator, input-scaled so its peak gain is about 1
  coeffs(f, r) {
    const w = 2 * Math.PI * f / sampleRate;
    return [2 * r * Math.cos(w), -r * r, (1 - r) * 2 * Math.sin(w) * 1.2];
  }
  process(inputs, outputs, params) {
    const out = outputs[0][0];
    const rpm = params.rpm[0], load = params.load[0], gain = params.gain[0];
    const degPerSample = (rpm / 60) * 360 / sampleRate;
    // Exhaust resonances shift a little with revs
    const [a1, a2, ag] = this.coeffs(this.resHz * (0.85 + rpm / 20000), 0.985);
    const [b1, b2, bg] = this.coeffs(this.res2Hz * (0.9 + rpm / 15000), 0.97);
    // Muffler opens up under load and at high revs
    const cut = 240 + load * 900 + rpm * 0.12;
    const lpk = 1 - Math.exp(-2 * Math.PI * cut / sampleRate);
    const decay = Math.exp(-1 / (sampleRate * (0.0014 + 0.0018 * load)));
    // Lifting off the gas at high revs: occasional exhaust pops
    const lifted = this.lastLoad - load > 0.4 && rpm > 3000;
    this.lastLoad = load;
    if (lifted) this.pop = 0.25;
    for (let i = 0; i < out.length; i++) {
      const prev = this.phase;
      this.phase += degPerSample;
      let wrapped = false;
      if (this.phase >= 720) {
        this.phase -= 720;
        wrapped = true;
        for (let k = 0; k < this.offs.length; k++) this.offs[k] = (Math.random() - 0.5) * this.jitterDeg;
      }
      for (let k = 0; k < this.fire.length; k++) {
        const a = (this.fire[k] + this.uneven[k] + this.offs[k] + 720) % 720;
        if ((!wrapped && prev < a && this.phase >= a) || (wrapped && (a > prev || a <= this.phase))) {
          const strength = this.amp[k] * (0.45 + 0.55 * load) * (0.92 + Math.random() * 0.16);
          this.exc += strength;
          this.nz += strength * 0.5;
        }
      }
      if (this.pop > 0) {
        this.pop -= 1 / sampleRate;
        if (Math.random() < 0.0009) this.exc += 1.6;
      }
      const x = this.exc + (Math.random() * 2 - 1) * this.nz * 0.35;
      this.exc *= decay;
      this.nz *= decay * 0.999;
      const y = x * ag + a1 * this.y1 + a2 * this.y2;
      this.y2 = this.y1;
      this.y1 = y;
      const z = x * bg + b1 * this.z1 + b2 * this.z2;
      this.z2 = this.z1;
      this.z1 = z;
      // The raw pulse gives the low "thump" of each firing
      this.th += (x - this.th) * 0.02;
      const mix = y * this.body + z * 0.5 + this.th * 0.6;
      // DC blocker, then muffler low-pass and gentle saturation
      const dc = mix - this.dcx + 0.995 * this.dcy;
      this.dcx = mix;
      this.dcy = dc;
      this.lp += (dc - this.lp) * lpk;
      this.lp2 += (this.lp - this.lp2) * lpk;
      out[i] = Math.tanh(this.lp2 * this.drive) * gain;
    }
    return true;
  }
}
registerProcessor('engine-processor', EngineProcessor);
`;

/** Speed/throttle -> rpm through a simple 6-speed gearbox. */
export class Gearbox {
  constructor() {
    this.gear = 0;
    this.rpm = 900;
    this.shiftT = 0;
  }

  update(dt, speedNorm, throttle, spec, boosting) {
    // Gear speed bands as a fraction of top speed
    const bands = [0, 0.16, 0.31, 0.47, 0.64, 0.82, 10];
    const s = Math.max(0, speedNorm);
    let g = this.gear;
    while (g < 5 && s > bands[g + 1]) g++;
    while (g > 0 && s < bands[g] * 0.92) g--;
    if (g !== this.gear) {
      this.shiftT = g > this.gear ? 0.12 : 0.06; // brief dip in load while shifting up
      this.gear = g;
    }
    this.shiftT = Math.max(0, this.shiftT - dt);
    const lo = bands[g], hi = bands[g + 1] > 5 ? 1.25 : bands[g + 1];
    const t = Math.min(1.05, (s - lo) / (hi - lo));
    const floor = g === 0 ? spec.idle : spec.redline * 0.52;
    let target = floor + t * (spec.redline - floor);
    if (s < 0.04) target = spec.idle + Math.max(0, throttle) * spec.redline * 0.35; // revving on the spot
    if (boosting) target *= 1.05;
    // Engines rev up quicker than they fall
    const rate = target > this.rpm ? 7 : 4;
    this.rpm += (target - this.rpm) * Math.min(1, dt * rate);
    const load = this.shiftT > 0 ? 0.1 : Math.max(0.08, throttle);
    return { rpm: this.rpm, load };
  }
}

export async function createEngine(ctx, dest) {
  if (!ctx.audioWorklet) return null;
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  const node = new AudioWorkletNode(ctx, 'engine-processor', { numberOfInputs: 0, outputChannelCount: [1] });
  const hp = ctx.createBiquadFilter(); // keep sub-bass mud out of small speakers
  hp.type = 'highpass';
  hp.frequency.value = 35;
  node.connect(hp).connect(dest);
  return node;
}
