/**
 * Phone controls: tilt to drive (landscape, like a steering wheel), on-screen
 * buttons, and drag-to-aim in battle. Tilt is turned into a gravity vector in
 * screen space so it behaves the same on iOS and Android and in either
 * landscape direction. If tilt isn't available, a virtual joystick appears.
 */

export const isTouchDevice = () =>
  typeof window !== 'undefined' && (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) && navigator.maxTouchPoints > 0;

const DEG = Math.PI / 180;
// Small tilts matter: tight dead zones, full input well before the phone is awkward
const STEER_DEAD = 1.5 * DEG, STEER_FULL = 13 * DEG;
const PITCH_DEAD = 2 * DEG, PITCH_FULL = 9 * DEG;
const TILT_KEY = 'kb-tilt';

/** Must be called from a tap (iOS asks the user for motion permission). */
export async function requestMotionPermission() {
  try {
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === 'function') return (await D.requestPermission()) === 'granted';
    return !!D;
  } catch {
    return false;
  }
}

/** Best effort: go fullscreen and lock to landscape (Android). */
export async function enterLandscape() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch {}
  try {
    await screen.orientation?.lock?.('landscape');
  } catch {}
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Past the dead zone, a square-root curve gives a strong response to small tilts
const shape = (v, dead, full) => {
  const a = Math.abs(v);
  if (a < dead) return 0;
  return Math.sign(v) * Math.sqrt(Math.min(1, (a - dead) / (full - dead)));
};

export class MobileInput {
  constructor(mode) {
    this.mode = mode; // 'race' | 'battle'
    this.steer = 0; // +1 = left (matches keyboard A)
    this.throttle = 0;
    this.drift = false;
    this.boost = false;
    this.fire = false;
    this.rocket = false;
    this.spin = 0; // one-shot trick edges
    this.flip = false;
    this.aimDX = 0;
    this.aimDY = 0;
    this.pitch0 = null;
    this.hasTilt = false;
    this.lastTilt = 0;
    this.stick = null; // virtual joystick state
    this.enabled = true;
    try {
      this.useTilt = localStorage.getItem(TILT_KEY) !== '0';
    } catch {
      this.useTilt = true;
    }

    document.body.classList.add('touch');
    this.buildUI();
    this.onOrient = (e) => this.handleOrientation(e);
    window.addEventListener('deviceorientation', this.onOrient);
    this.bindToggle();
    this.refreshStick();
    // No tilt data shortly after starting? Show the virtual joystick instead.
    setTimeout(() => this.refreshStick(), 1500);
  }

  // ---------------- tilt ----------------

  handleOrientation(e) {
    if (e.beta == null || e.gamma == null) return;
    const first = !this.hasTilt;
    this.hasTilt = true;
    this.lastTilt = performance.now();
    if (first) this.refreshStick();
    const b = e.beta * DEG, g = e.gamma * DEG;
    // Gravity ("down") in device coordinates from the W3C beta/gamma angles
    const dx = Math.sin(g) * Math.cos(b), dy = -Math.sin(b), dz = -Math.cos(g) * Math.cos(b);
    const a = ((screen.orientation?.angle ?? window.orientation ?? 0) * DEG) || 0;
    const right = dx * Math.cos(a) - dy * Math.sin(a);
    const up = dx * Math.sin(a) + dy * Math.cos(a);
    // Steering wheel: right edge dipping (clockwise) steers right
    const roll = Math.asin(clamp(right, -1, 1));
    // How far the screen leans back from vertical; tilting the top away = more lean
    const pitch = Math.atan2(-dz, -up);
    if (this.pitch0 == null) this.pitch0 = pitch;
    this.tiltSteer = -shape(roll, STEER_DEAD, STEER_FULL);
    this.tiltThrottle = shape(pitch - this.pitch0, PITCH_DEAD, PITCH_FULL);
    this.rawPitch = pitch;
  }

  /** Use the current way the phone is held as "neutral" for gas/brake. */
  calibrate() {
    if (this.rawPitch != null) this.pitch0 = this.rawPitch;
  }

  // ---------------- UI ----------------

  buildUI() {
    const ui = document.createElement('div');
    ui.id = 'touchUI';
    ui.className = `touch-${this.mode}`;
    ui.innerHTML = `
      <div id="tAim"></div>
      <button class="tbtn" id="tPause" aria-label="Pause">⏸</button>
      <div id="tStick" class="hidden"><div class="knob"></div></div>
      <div class="tcol tright">
        ${this.mode === 'battle' ? '<button class="tbtn big" id="tRocket">🚀</button>' : ''}
        <button class="tbtn big" id="tBoost">${this.mode === 'race' ? 'NITRO' : 'BOOST'}</button>
        <button class="tbtn big" id="tDrift">DRIFT</button>
      </div>
      <div id="tTilt" class="tiltbar"><span></span></div>
    `;
    document.body.appendChild(ui);
    this.ui = ui;

    const hold = (id, key) => {
      const el = ui.querySelector(id);
      if (!el) return;
      const on = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this[key] = true;
        if (key === 'drift') this.flip = true; // tapping drift in the air flips
        el.classList.add('down');
      };
      const off = (e) => {
        e.preventDefault();
        this[key] = false;
        el.classList.remove('down');
      };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    };
    hold('#tBoost', 'boost');
    hold('#tDrift', 'drift');
    hold('#tRocket', 'rocket');

    ui.querySelector('#tPause').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onPause?.();
    });

    // Drag area: aim + fire in battle; tap left/right half to spin in the air (race)
    const aim = ui.querySelector('#tAim');
    this.aimPointer = null;
    aim.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.mode === 'race') {
        this.spin = e.clientX < window.innerWidth / 2 ? 1 : -1;
        return;
      }
      if (this.aimPointer != null) return;
      this.aimPointer = e.pointerId;
      this.aimLast = [e.clientX, e.clientY];
      this.fire = true;
      aim.setPointerCapture?.(e.pointerId);
    });
    aim.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.aimPointer) return;
      this.aimDX += e.clientX - this.aimLast[0];
      this.aimDY += e.clientY - this.aimLast[1];
      this.aimLast = [e.clientX, e.clientY];
    });
    const aimUp = (e) => {
      if (e.pointerId !== this.aimPointer) return;
      this.aimPointer = null;
      this.fire = false;
    };
    aim.addEventListener('pointerup', aimUp);
    aim.addEventListener('pointercancel', aimUp);

    // Virtual joystick fallback (left thumb): x = steer, y = gas/brake
    const stick = ui.querySelector('#tStick');
    const knob = stick.querySelector('.knob');
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = stick.getBoundingClientRect();
      this.stick = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2 };
      stick.setPointerCapture?.(e.pointerId);
      this.moveStick(e, knob);
    });
    stick.addEventListener('pointermove', (e) => this.stick?.id === e.pointerId && this.moveStick(e, knob));
    const stickUp = (e) => {
      if (this.stick?.id !== e.pointerId) return;
      this.stick = null;
      this.stickSteer = this.stickThrottle = 0;
      knob.style.transform = '';
    };
    stick.addEventListener('pointerup', stickUp);
    stick.addEventListener('pointercancel', stickUp);
  }

  moveStick(e, knob) {
    const s = this.stick;
    let x = (e.clientX - s.cx) / s.r, y = (e.clientY - s.cy) / s.r;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    knob.style.transform = `translate(${x * s.r * 0.6}px, ${y * s.r * 0.6}px)`;
    this.stickSteer = -shape(x, 0.12, 0.9);
    this.stickThrottle = -shape(y, 0.15, 0.85);
  }

  /** Pause-menu switch: tilt steering on, or joystick on the left. */
  bindToggle() {
    const box = document.getElementById('tiltToggle');
    if (!box) return;
    box.checked = this.useTilt;
    box.addEventListener('change', () => this.setTilt(box.checked));
  }

  setTilt(on) {
    this.useTilt = on;
    try {
      localStorage.setItem(TILT_KEY, on ? '1' : '0');
    } catch {}
    this.refreshStick();
  }

  /** The joystick shows when tilt is switched off or there's no motion sensor. */
  refreshStick() {
    this.showStick(!this.useTilt || !this.hasTilt);
  }

  showStick(on) {
    if (this.stickShown === on) return;
    this.stickShown = on;
    this.ui.querySelector('#tStick').classList.toggle('hidden', !on);
    this.ui.querySelector('#tTilt').classList.toggle('hidden', on);
  }

  /** Per-frame: read current controls. */
  read() {
    const useStick = !this.useTilt || !this.hasTilt || performance.now() - this.lastTilt > 2000;
    const steer = useStick ? this.stickSteer || 0 : this.tiltSteer || 0;
    const throttle = useStick ? this.stickThrottle || 0 : this.tiltThrottle || 0;
    // Tilt meter shows what the phone is doing
    const bar = this.ui.querySelector('#tTilt span');
    bar.style.transform = `translateX(${-steer * 45}px)`;
    bar.style.background = throttle > 0.05 ? '#4ade80' : throttle < -0.05 ? '#ef4444' : '#fff';
    const out = { steer, throttle, boost: this.boost, drift: this.drift, spin: this.spin, flip: this.flip };
    this.spin = 0;
    this.flip = false;
    return out;
  }

  consumeAim() {
    const d = [this.aimDX, this.aimDY];
    this.aimDX = this.aimDY = 0;
    return d;
  }

  setVisible(on) {
    this.ui.classList.toggle('hidden', !on);
  }
}
