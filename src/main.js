import { Net } from './net.js';
import { Game, COLORS } from './game.js';
import { Sfx } from './audio.js';

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

let color = store.get('kb-color', COLORS[Math.floor(Math.random() * COLORS.length)]);
if (!COLORS.includes(color)) color = COLORS[0];
$('name').value = store.get('kb-name', '');

const swatches = $('colors');
for (const c of COLORS) {
  const b = document.createElement('button');
  b.className = 'swatch' + (c === color ? ' on' : '');
  b.style.background = c;
  b.title = c;
  b.onclick = () => {
    color = c;
    for (const s of swatches.children) s.classList.toggle('on', s === b);
  };
  swatches.appendChild(b);
}

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
  return { name, color };
}

const sfx = new Sfx();

function start(net, code, botCount) {
  $('menu').classList.add('hidden');
  const { name, color } = playerInfo();
  const game = new Game({ net, name, color, botCount, sfx, code });
  window.__game = game;
  if (code) history.replaceState(null, '', `?room=${code}`);
}

$('host').onclick = async () => {
  sfx.init();
  busy(true);
  status('Creating room…');
  const net = new Net();
  try {
    const code = await net.hostGame();
    start(net, code, +$('bots').value);
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
    start(net, code, 0);
  } catch (e) {
    console.error(e);
    status(e.message || 'Could not connect.', true);
    busy(false);
  }
};

$('code').addEventListener('keydown', (e) => e.key === 'Enter' && $('join').click());

$('practice').onclick = () => {
  sfx.init();
  const net = new Net();
  net.startOffline();
  start(net, null, +$('bots').value || 4);
};
