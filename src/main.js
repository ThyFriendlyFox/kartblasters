import { inject } from '@vercel/analytics';
import { Net } from './net.js';
import { Game, COLORS } from './game.js';
import { RaceGame } from './race.js';
import { Sfx } from './audio.js';
import { isTouchDevice, requestMotionPermission, enterLandscape, MobileInput } from './mobile.js';
import { CARS, CAR_IDS, carThumbnail } from './cars.js';
import { TRACKS, TRACK_IDS } from './trackdefs.js';

// Initialize Vercel Analytics
inject();

const $ = (id) => document.getElementById(id);

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

const MAPS = {
  race: TRACK_IDS.map((id) => [id, `${TRACKS[id].name} — ${TRACKS[id].desc}`]),
  battle: [
    ['stadium', 'Stadium — arena with cover, jump pads and pickups'],
    ['craters', 'Crater Field — rolling hills and block forts'],
  ],
};

let color = store.get('kb-color', COLORS[Math.floor(Math.random() * COLORS.length)]);
if (!COLORS.includes(color)) color = COLORS[0];
let car = store.get('kb-car', 'hyper');
if (!CARS[car]) car = 'hyper';
let mode = store.get('kb-mode', 'race') === 'battle' ? 'battle' : 'race';
$('name').value = store.get('kb-name', '');

// ---- car picker (thumbnails are re-rendered in the chosen color)
const carPick = $('carPick');
const carBtns = {};
for (const id of CAR_IDS) {
  const b = document.createElement('button');
  b.className = 'carBtn';
  b.innerHTML = `<img alt="" /><span>${CARS[id].name}</span><small>${CARS[id].desc}</small>`;
  b.onclick = () => {
    car = id;
    refreshCars();
  };
  carPick.appendChild(b);
  carBtns[id] = b;
}
function refreshCars(redraw = false) {
  for (const id of CAR_IDS) {
    carBtns[id].classList.toggle('on', id === car);
    if (redraw) {
      try {
        carBtns[id].querySelector('img').src = carThumbnail(id, color);
      } catch {
        // WebGL unavailable: the names still work
      }
    }
  }
}

const swatches = $('colors');
for (const c of COLORS) {
  const b = document.createElement('button');
  b.className = 'swatch' + (c === color ? ' on' : '');
  b.style.background = c;
  b.title = c;
  b.onclick = () => {
    color = c;
    for (const s of swatches.children) s.classList.toggle('on', s === b);
    refreshCars(true);
  };
  swatches.appendChild(b);
}
refreshCars(true);

// ---- mode / map
function refreshMode() {
  for (const b of $('modeSeg').children) b.classList.toggle('on', b.dataset.mode === mode);
  const prev = store.get(`kb-map-${mode}`, MAPS[mode][0][0]);
  $('map').innerHTML = MAPS[mode].map(([id, label]) => `<option value="${id}"${id === prev ? ' selected' : ''}>${label}</option>`).join('');
  $('lapsWrap').classList.toggle('hidden', mode !== 'race');
  $('destructWrap').classList.toggle('hidden', mode !== 'battle');
  $('ctlRace').classList.toggle('hidden', mode !== 'race');
  $('ctlBattle').classList.toggle('hidden', mode !== 'battle');
}
for (const b of $('modeSeg').children) {
  b.onclick = () => {
    mode = b.dataset.mode;
    refreshMode();
  };
}
refreshMode();

$('destruct').checked = store.get('kb-destruct', '1') === '1';

const params = new URLSearchParams(location.search);
if (params.get('room')) {
  $('code').value = params.get('room').toUpperCase();
  $('join').focus();
}

const status = (msg, err = false) => {
  $('menuStatus').textContent = msg;
  $('menuStatus').className = err ? 'err' : '';
};

const buttons = ['host', 'join', 'practice'].map($);
const busy = (b) => buttons.forEach((x) => (x.disabled = b));

function playerInfo() {
  const name = $('name').value.trim().slice(0, 16) || `Racer${Math.floor(Math.random() * 900 + 100)}`;
  store.set('kb-name', name);
  store.set('kb-color', color);
  store.set('kb-car', car);
  store.set('kb-mode', mode);
  store.set(`kb-map-${mode}`, $('map').value);
  return { name, color, car };
}

const sfx = new Sfx();
const touch = isTouchDevice();
if (touch) document.body.classList.add('touch');
// Phones: go fullscreen + landscape. Must run inside the tap.
// (Tilt permission is only requested when tilt steering is switched on.)
const phoneSetup = () => {
  if (!touch) return;
  if (localStorage.getItem('kb-tilt') === '1') requestMotionPermission();
  enterLandscape();
};
for (const id of ['host', 'join', 'practice']) $(id).addEventListener('click', phoneSetup, { capture: true });

function start(net, code, opts) {
  $('menu').classList.add('hidden');
  const info = playerInfo();
  const args = { net, sfx, code, ...info, ...opts };
  if (touch) {
    args.mobile = new MobileInput(opts.mode);
    document.body.classList.add('ingame');
  }
  const game = opts.mode === 'race' ? new RaceGame(args) : new Game(args);
  window.__game = game;
  if (code) history.replaceState(null, '', `?room=${code}`);
}

function hostOpts() {
  store.set('kb-destruct', $('destruct').checked ? '1' : '0');
  return { mode, map: $('map').value, botCount: +$('bots').value, laps: +$('laps').value, destructible: $('destruct').checked };
}

$('host').onclick = async () => {
  sfx.init();
  busy(true);
  status('Creating room…');
  const net = new Net();
  try {
    const code = await net.hostGame();
    start(net, code, hostOpts());
  } catch (e) {
    console.error(e);
    status(`Could not create room: ${e.message || e.type || e}`, true);
    busy(false);
  }
};

$('join').onclick = async () => {
  const code = $('code').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) {
    status('Enter the 5-character room code from your friend.', true);
    return;
  }
  sfx.init();
  busy(true);
  status('Connecting…');
  const net = new Net();
  try {
    await net.joinGame(code);
    status('Connected! Getting the room info…');
    // The host tells us which mode and map the room is using
    const welcome = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The host did not respond.')), 10000);
      net.on('msg', (m) => {
        if (m.t === 'welcome') {
          clearTimeout(timer);
          resolve(m);
        }
      });
      const { name, color, car } = playerInfo();
      net.send({ t: 'hello', name, color, car });
    });
    start(net, code, { mode: welcome.mode, map: welcome.map, laps: welcome.laps, welcome });
  } catch (e) {
    console.error(e);
    net.destroy();
    status(e.message || 'Could not connect.', true);
    busy(false);
  }
};

$('code').addEventListener('keydown', (e) => e.key === 'Enter' && $('join').click());

$('practice').onclick = () => {
  sfx.init();
  const net = new Net();
  net.startOffline();
  const o = hostOpts();
  start(net, null, { ...o, botCount: o.botCount || 3 });
};
