import { inject } from '@vercel/analytics';
import { Net } from './net.js';
import { Game, COLORS } from './game.js';
import { RaceGame } from './race.js';
import { Sfx } from './audio.js';
import { isTouchDevice, requestMotionPermission, enterLandscape, MobileInput } from './mobile.js';
import { CARS, CAR_IDS, carThumbnail, statBarsHTML } from './cars.js';
import { TRACKS, TRACK_IDS } from './trackdefs.js';
import { mapPreview } from './preview.js';

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

// Grand Prix cups: a run of race tracks, raced back to back for points
const EPIC = TRACK_IDS.filter((id) => TRACKS[id].desc.startsWith('Epic'));
const CLASSIC = TRACK_IDS.filter((id) => !EPIC.includes(id));
let randomCup = [];
const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
function cupMaps(id) {
  if (id === 'classic') return CLASSIC;
  if (id === 'epic') return EPIC;
  if (id === 'all') return TRACK_IDS;
  return randomCup.length ? randomCup : (randomCup = shuffle(TRACK_IDS).slice(0, 4));
}
const MAPS = {
  race: TRACK_IDS.map((id) => [id, `${TRACKS[id].name} — ${TRACKS[id].desc}`]),
  gp: [
    ['classic', `Classic Cup — ${CLASSIC.length} races: ${CLASSIC.map((id) => TRACKS[id].name).join(', ')}`],
    ['epic', `Epic Cup — ${EPIC.length} two-minute tracks: ${EPIC.map((id) => TRACKS[id].name).join(', ')}`],
    ['all', `Everything Cup — all ${TRACK_IDS.length} tracks`],
    ['random', 'Random Cup — 4 random tracks'],
  ],
  battle: [
    ['stadium', 'Stadium — arena with cover, jump pads and pickups'],
    ['craters', 'Crater Field — rolling hills and block forts'],
  ],
};

let color = store.get('kb-color', COLORS[Math.floor(Math.random() * COLORS.length)]);
if (!COLORS.includes(color)) color = COLORS[0];
let car = store.get('kb-car', 'hyper');
if (!CARS[car]) car = 'hyper';
let mode = ['race', 'gp', 'battle'].includes(store.get('kb-mode', 'race')) ? store.get('kb-mode', 'race') : 'race';
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
  $('carStats').innerHTML = `<b>${CARS[car].name}</b>${statBarsHTML(car)}`;
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
  $('mapLabel').textContent = mode === 'gp' ? 'Cup' : 'Map';
  showPreview();
  $('lapsWrap').classList.toggle('hidden', mode === 'battle');
  $('destructWrap').classList.toggle('hidden', mode !== 'battle');
  $('ctlRace').classList.toggle('hidden', mode === 'battle');
  $('ctlBattle').classList.toggle('hidden', mode !== 'battle');
}
// Aerial shot of the selected map, rendered from the real map on demand
function showPreview() {
  if (mode === 'gp' && $('map').value === 'random') randomCup = shuffle(TRACK_IDS).slice(0, 4);
  const cup = mode === 'gp' ? cupMaps($('map').value) : null;
  // A cup shows its first track
  const wrap = $('mapPreview'), id = cup ? cup[0] : $('map').value, key = `${mode}:${$('map').value}:${id}`;
  wrap.dataset.key = key;
  wrap.classList.add('loading');
  mapPreview(mode === 'gp' ? 'race' : mode, id)
    .then(({ url, facts }) => {
      if (wrap.dataset.key !== key) return;
      wrap.querySelector('.shot').style.backgroundImage = `url(${url})`;
      wrap.querySelector('.facts').textContent = cup ? `${cup.length} races: ${cup.map((m) => TRACKS[m].name).join(' → ')}` : facts.join(' · ');
      wrap.classList.remove('loading');
    })
    .catch((e) => {
      console.warn('map preview failed', e);
      if (wrap.dataset.key === key) wrap.classList.add('hidden');
    });
}
$('map').addEventListener('change', showPreview);

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
window.__sfx = sfx;
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

// Music: starts on the first tap/click (browsers block audio before that)
document.addEventListener('pointerdown', () => sfx.init(), { once: true, capture: true });
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyN' && !(e.target instanceof HTMLInputElement)) {
    sfx.init();
    sfx.setMusic(!sfx.musicOn);
  }
});
for (const id of ['musicToggleMenu', 'musicToggle']) {
  const box = $(id);
  box.checked = sfx.musicOn;
  box.addEventListener('change', () => {
    sfx.init();
    sfx.setMusic(box.checked);
  });
}

function start(net, code, opts) {
  $('menu').classList.add('hidden');
  const info = playerInfo();
  const args = { net, sfx, code, ...info, ...opts };
  if (touch) {
    args.mobile = new MobileInput(opts.mode === 'battle' ? 'battle' : 'race');
    document.body.classList.add('ingame');
  }
  const game = opts.mode === 'battle' ? new Game(args) : new RaceGame(args);
  window.__game = game;
  window.__sfx = sfx;
  if (code) history.replaceState(null, '', `?room=${code}`);
}

function hostOpts() {
  store.set('kb-destruct', $('destruct').checked ? '1' : '0');
  // Silly modifiers, chosen by the host and shared with everyone who joins
  const mods = { size: +$('carSize').value, endless: $('endless').checked };
  const gp = mode === 'gp' ? [...cupMaps($('map').value)] : null;
  return { mode, map: gp ? gp[0] : $('map').value, gp, botCount: +$('bots').value, laps: +$('laps').value, destructible: $('destruct').checked, mods };
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
    start(net, code, { mode: welcome.mode, map: welcome.map, laps: welcome.laps, mods: welcome.mods, welcome });
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
