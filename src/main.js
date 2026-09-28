import { inject } from '@vercel/analytics';
import { Net } from './net.js';
import { Game, COLORS } from './game.js';
import { RaceGame } from './race.js';
import { Sfx } from './audio.js';
import { isTouchDevice, requestMotionPermission, enterLandscape, MobileInput } from './mobile.js';
import { CARS, CAR_IDS, carImage, preloadCarImages, statBarsHTML } from './cars.js';
import { TRACKS, TRACK_IDS } from './trackdefs.js';
import { mapPreview } from './preview.js';
import { RULES, RULE_IDS, TOURNAMENTS, randomTournament } from './modes.js';

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
  tourney: Object.entries(TOURNAMENTS).map(([id, t]) => [id, t.name]),
  battle: [
    ['stadium', 'Stadium — arena with cover, jump pads and pickups'],
    ['craters', 'Crater Field — rolling hills and block forts'],
    ['daytona', 'Daytona Speedway — 31° banked tri-oval with an infield to fight in'],
    ['cube', 'Rocket Cube — rounded arena: drive up the walls and over the ceiling'],
  ],
};

let color = store.get('kb-color', COLORS[Math.floor(Math.random() * COLORS.length)]);
if (!COLORS.includes(color)) color = COLORS[0];
let car = store.get('kb-car', 'hyper');
if (!CARS[car]) car = 'hyper';
let mode = ['race', 'gp', 'battle', 'tourney'].includes(store.get('kb-mode', 'race')) ? store.get('kb-mode', 'race') : 'race';
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
        carBtns[id].querySelector('img').src = carImage(id, color);
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
preloadCarImages(color);

// ---- mode / map
function refreshMode() {
  for (const b of $('modeSeg').children) b.classList.toggle('on', b.dataset.mode === mode);
  const prev = store.get(`kb-map-${mode}`, MAPS[mode][0][0]);
  $('map').innerHTML = MAPS[mode].map(([id, label]) => `<option value="${id}"${id === prev ? ' selected' : ''}>${label}</option>`).join('');
  $('mapLabel').textContent = { race: 'Track', gp: 'Cup', battle: 'Arena', tourney: 'Tournament' }[mode];
  // Grand Prix and tournaments: pick from big medallion cards instead of a dropdown
  const cups = mode === 'gp' || mode === 'tourney', fight = mode === 'battle' || mode === 'tourney';
  $('cupPick').classList.toggle('hidden', !cups);
  $('mapWrap').classList.toggle('hidden', cups);
  $('ruleWrap').classList.toggle('hidden', mode !== 'battle');
  $('ruleDesc').classList.toggle('hidden', mode !== 'battle');
  if (cups) renderCups();
  showPreview();
  $('lapsWrap').classList.toggle('hidden', fight);
  $('destructWrap').classList.toggle('hidden', !fight);
  $('ctlRace').classList.toggle('hidden', fight);
  $('ctlBattle').classList.toggle('hidden', !fight);
}
const CUPS = {
  classic: { icon: '🏁', name: 'Classic Cup', color: 'linear-gradient(145deg, #f0b27a, #b86b2d)' },
  epic: { icon: '⛰️', name: 'Epic Cup', color: 'linear-gradient(145deg, #eef2f7, #8f9aa8)' },
  all: { icon: '🌈', name: 'Everything Cup', color: 'linear-gradient(145deg, #ffe27a, #e0a410)' },
  random: { icon: '🎲', name: 'Random Cup', color: 'linear-gradient(145deg, #c9a2ff, #6a3fd1)' },
};
function renderCups() {
  const box = $('cupPick');
  box.innerHTML = '';
  const tourney = mode === 'tourney';
  for (const [id, c] of Object.entries(tourney ? TOURNAMENTS : CUPS)) {
    const b = document.createElement('button');
    b.className = 'cupBtn' + ($('map').value === id ? ' on' : '');
    const n = tourney ? (c.matches ? `${c.matches.length} matches` : '4 random matches') : id === 'random' ? '4 random tracks' : `${cupMaps(id).length} races`;
    b.innerHTML = `<span class="medal" style="--cup:${c.color}">${c.icon}</span><b>${c.name}</b><small>${n}</small>`;
    b.onclick = () => {
      $('map').value = id;
      renderCups();
      showPreview();
    };
    box.appendChild(b);
  }
}
// Aerial shot of the selected map, rendered from the real map on demand
function showPreview() {
  if (mode === 'gp' && $('map').value === 'random') randomCup = shuffle(TRACK_IDS).slice(0, 4);
  if (mode === 'tourney' && $('map').value === 'random') randomTour = randomTournament();
  const cup = mode === 'gp' ? cupMaps($('map').value) : null;
  const tour = mode === 'tourney' ? tourMatches($('map').value) : null;
  if (mode === 'battle') $('ruleDesc').textContent = `${RULES[$('rule').value]?.icon} ${RULES[$('rule').value]?.desc}`;
  // A cup shows its first track, a tournament its first arena
  const wrap = $('mapPreview'), id = cup ? cup[0] : tour ? tour[0][1] : $('map').value, key = `${mode}:${$('map').value}:${id}`;
  wrap.dataset.key = key;
  wrap.classList.add('loading');
  mapPreview(mode === 'gp' ? 'race' : mode === 'tourney' ? 'battle' : mode, id)
    .then(({ url, facts }) => {
      if (wrap.dataset.key !== key) return;
      wrap.querySelector('.shot').style.backgroundImage = `url(${url})`;
      const arena = (m) => MAPS.battle.find(([a]) => a === m)?.[1].split(' — ')[0] || m;
      wrap.querySelector('.facts').textContent = cup
        ? `${cup.length} races: ${cup.map((m) => TRACKS[m].name).join(' → ')}`
        : tour
          ? `${tour.length} matches: ${tour.map(([r, m]) => `${RULES[r].icon} ${RULES[r].name} (${arena(m)})`).join(' → ')}`
          : facts.join(' · ');
      wrap.classList.remove('loading');
    })
    .catch((e) => {
      console.warn('map preview failed', e);
      if (wrap.dataset.key === key) wrap.classList.add('hidden');
    });
}
$('map').addEventListener('change', showPreview);
$('rule').innerHTML = RULE_IDS.map((id) => `<option value="${id}">${RULES[id].icon} ${RULES[id].name}</option>`).join('');
$('rule').value = RULES[store.get('kb-rule', 'ffa')] ? store.get('kb-rule', 'ffa') : 'ffa';
$('rule').addEventListener('change', () => {
  store.set('kb-rule', $('rule').value);
  showPreview();
});
let randomTour = randomTournament();
const tourMatches = (id) => (id === 'random' ? randomTour : TOURNAMENTS[id]?.matches || TOURNAMENTS.rookie.matches);

$('destruct').checked = store.get('kb-destruct', '1') === '1';

const status = (msg, err = false) => {
  $('menuStatus').textContent = msg;
  $('menuStatus').className = err ? 'err' : '';
};

const buttons = ['join', 'trackOk', 'lobbyGo'].map($);
const busy = (b) => buttons.forEach((x) => (x.disabled = b));

function playerInfo() {
  const name = $('name').value.trim().slice(0, 16) || (playerInfo.auto ||= `Racer${Math.floor(Math.random() * 900 + 100)}`);
  store.set('kb-name', $('name').value.trim().slice(0, 16));
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
for (const id of ['trackOk', 'join', 'lobbyGo']) $(id).addEventListener('click', phoneSetup, { capture: true });

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
    args.mobile = new MobileInput(opts.mode === 'battle' || opts.mode === 'tourney' ? 'battle' : 'race');
    document.body.classList.add('ingame');
  }
  const game = opts.mode === 'battle' || opts.mode === 'tourney' ? new Game(args) : new RaceGame(args);
  window.__game = game;
  window.__sfx = sfx;
  if (code) history.replaceState(null, '', `?room=${code}`);
}

function hostOpts() {
  store.set('kb-destruct', $('destruct').checked ? '1' : '0');
  // Silly modifiers, chosen by the host and shared with everyone who joins
  const mods = { size: +$('carSize').value, endless: $('endless').checked, damage: $('wallDamage').checked };
  const gp = mode === 'gp' ? [...cupMaps($('map').value)] : null;
  if (mode === 'tourney') {
    const matches = tourMatches($('map').value).map((m) => [...m]);
    return { mode, map: matches[0][1], rule: matches[0][0], tour: { id: $('map').value, matches, idx: 0 }, botCount: +$('bots').value, destructible: $('destruct').checked, mods };
  }
  return { mode, map: gp ? gp[0] : $('map').value, gp, rule: $('rule').value, botCount: +$('bots').value, laps: +$('laps').value, destructible: $('destruct').checked, mods };
}

// ================= menu screens =================
// Solo:  start → mode → car → track → (game)
// Host:  start → mode → car → track → lobby → (game)
// Join:  start → car → code → lobby → (game)
// The menu tune gains instruments as you go deeper.
const LAYERS = {
  start: ['pad'],
  mode: ['pad', 'arp'],
  car: ['pad', 'arp', 'bass', 'hat'],
  track: ['pad', 'arp', 'bass', 'hat', 'kick', 'snare', 'ohat', 'acid'],
  code: ['pad', 'arp', 'bass', 'hat', 'kick', 'snare', 'ohat', 'acid'],
  lobby: ['pad', 'arp', 'bass', 'hat', 'kick', 'snare', 'ohat', 'acid', 'riff', 'lead'],
};
const TITLES = { race: ['Select track', 'Track'], gp: ['Select cup', 'Cup'], battle: ['Select arena', 'Arena'], tourney: ['Select tournament', 'Tournament'] };
let path = null; // 'solo' | 'host' | 'join'
let screen = 'start';
const trail = [];

const STEPS = {
  solo: ['start', 'mode', 'car', 'track'],
  host: ['start', 'mode', 'car', 'track', 'lobby'],
  join: ['start', 'car', 'code', 'lobby'],
};
const STEP_NAMES = { start: 'Play', mode: 'Mode', car: 'Car', code: 'Room code', lobby: 'Lobby' };
function renderSteps() {
  const list = STEPS[path] || ['start'];
  const at = list.indexOf(screen);
  $('steps').innerHTML = list
    .map((st, i) => `<li class="${i === at ? 'on' : i < at ? 'done' : ''}">${i < at ? '✓ ' : ''}${st === 'track' ? TITLES[mode][1] : STEP_NAMES[st]}</li>`)
    .join('');
}

function show(name, push = true) {
  if (push && screen !== name) trail.push(screen);
  screen = name;
  renderSteps();
  for (const sc of document.querySelectorAll('#menu .screen')) sc.classList.toggle('on', sc.dataset.screen === name);
  $('back').classList.toggle('hidden', name === 'start');
  if (name === 'start') {
    trail.length = 0;
    closeRoom();
  }
  if (name === 'track') {
    $('trackTitle').textContent = TITLES[mode][0];
    $('trackOk').textContent = path === 'host' ? 'OK! Open the lobby' : 'OK! Start';
  }
  if (name === 'car') $('carOk').textContent = room || guest ? 'OK! Back to the lobby' : 'OK!';
  sfx.musicLayers(LAYERS[name]);
  status('');
  $('menu').scrollTop = 0;
  const first = document.querySelector('#menu .screen.on .row.on, #menu .screen.on .row, #menu .screen.on .carBtn.on');
  first?.focus({ preventScroll: true });
}

$('back').onclick = () => {
  if (screen === 'lobby' && guest) leaveGuest();
  const prev = trail.pop();
  if (prev) show(prev, false);
};

for (const b of document.querySelectorAll('[data-go]')) {
  b.onclick = () => {
    sfx.init();
    path = b.dataset.go;
    show(path === 'join' ? 'car' : 'mode');
  };
}
for (const b of $('modeSeg').children) {
  b.onclick = () => {
    mode = b.dataset.mode;
    refreshMode();
    show('car');
  };
}
refreshMode();

$('carOk').onclick = () => {
  if (room) return openLobby(); // host changing car from the lobby
  if (guest) {
    sendHello(); // guest changing car: tell the host, back to the lobby
    return show('lobby');
  }
  show(path === 'join' ? 'code' : 'track');
};
$('trackOk').onclick = () => (path === 'host' ? openLobby() : startSolo());
$('lobbyCar').onclick = () => show('car');

function startSolo() {
  sfx.init();
  const net = new Net();
  net.startOffline();
  const o = hostOpts();
  start(net, null, { ...o, botCount: o.botCount || 3 });
}

// ---------------- lobby ----------------
let room = null; // host: { net, code, players: Map(id -> { name, color, car }) }
let guest = null; // guest: { net, code }
const thumbs = new Map();
const thumb = (c, col) => {
  const k = `${c}|${col}`;
  if (!thumbs.has(k)) {
    try {
      thumbs.set(k, carImage(c, col));
    } catch {
      thumbs.set(k, '');
    }
  }
  return thumbs.get(k);
};

function settingsSummary(o) {
  const fight = o.mode === 'battle' || o.mode === 'tourney';
  const where = o.mode === 'gp'
    ? MAPS.gp.find(([id]) => id === $('map').value)?.[1].split(' — ')[0]
    : o.mode === 'tourney'
      ? `${TOURNAMENTS[o.tour.id]?.icon} ${TOURNAMENTS[o.tour.id]?.name} (${o.tour.matches.length} matches)`
      : o.mode === 'battle'
        ? `${RULES[o.rule]?.icon} ${RULES[o.rule]?.name} · ${MAPS.battle.find(([id]) => id === o.map)?.[1].split(' — ')[0]}`
        : TRACKS[o.map]?.name;
  const bits = [
    { race: '🏁 Race', gp: '🏆 Grand Prix', battle: '💥 Battle', tourney: '🎖️ Tournament' }[o.mode],
    where,
    !fight && `${o.laps} lap${o.laps > 1 ? 's' : ''}`,
    `${o.botCount || 'no'} AI`,
    o.mods.size > 1.5 && '🐘 Giant cars',
    o.mods.size < 0.8 && '🐭 Tiny cars',
    o.mods.endless && '♾️ Endless nitro',
    o.mods.damage && '💥 Wall damage',
    fight && o.destructible && '💣 Destructible',
  ];
  return { text: bits.filter(Boolean).join(' · '), bots: o.botCount };
}

function lobbyState() {
  const me = playerInfo();
  return {
    t: 'lobby',
    code: room.code,
    host: room.net.myId,
    players: [[room.net.myId, me.name, me.color, me.car], ...[...room.players].map(([id, p]) => [id, p.name, p.color, p.car])],
    settings: settingsSummary(hostOpts()),
  };
}

function renderLobby(m, isHost) {
  const myId = isHost ? room.net.myId : guest?.net.myId;
  const link = `${location.origin}${location.pathname}?room=${m.code}`;
  $('lobbyInfo').innerHTML = `<div class="roomCode"><small>ROOM CODE</small><b>${esc(m.code)}</b>${isHost ? '<button id="copyRoom" class="ghost">📋 Copy invite link</button>' : ''}</div><p class="settings">${esc(m.settings.text)}</p>`;
  if (isHost) $('copyRoom').onclick = () => navigator.clipboard?.writeText(link).then(() => status('Invite link copied!'), () => status(link));
  const cards = m.players.map(([id, name, col, c]) => {
    const tags = [id === m.host && 'HOST', id === myId && 'YOU'].filter(Boolean).map((t) => `<em>${t}</em>`).join('');
    return `<div class="pCard${id === myId ? ' me' : ''}"><img alt="" src="${thumb(CARS[c] ? c : 'hyper', col)}" /><span class="dot" style="background:${esc(col)}"></span><b>${esc(name)}</b><small>${esc(CARS[c]?.name || '')}</small>${tags}</div>`;
  });
  if (m.settings.bots) cards.push(`<div class="pCard ai"><i>🤖</i><b>+${m.settings.bots} AI</b><small>computer drivers</small></div>`);
  $('lobbyPlayers').innerHTML = cards.join('');
  $('lobbyGo').classList.toggle('hidden', !isHost);
  $('lobbyWait').textContent = isHost ? `Share the code with your friends, then press START. ${m.players.length} player${m.players.length > 1 ? 's' : ''} in the room.` : 'Waiting for the host to start…';
}
const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

async function openLobby() {
  if (!room) {
    sfx.init();
    busy(true);
    status('Creating room…');
    const net = new Net();
    try {
      const code = await net.hostGame();
      room = { net, code, players: new Map() };
    } catch (e) {
      console.error(e);
      status(`Could not create room: ${e.message || e.type || e}`, true);
      busy(false);
      return;
    }
    busy(false);
    // Until the race starts, the menu answers people joining
    room.net.on('msg', (m, from) => {
      if (m.t !== 'hello' || !room) return;
      room.players.set(from, { name: String(m.name || 'Racer').slice(0, 16), color: m.color, car: CARS[m.car] ? m.car : 'hyper' });
      broadcastLobby();
    });
    room.net.on('leave', (id) => {
      room?.players.delete(id);
      if (room) broadcastLobby();
    });
  }
  if (screen !== 'lobby') show('lobby');
  broadcastLobby();
}
function broadcastLobby() {
  const m = lobbyState();
  room.net.send(m);
  renderLobby(m, true);
}
function closeRoom() {
  room?.net.destroy();
  room = null;
}

$('lobbyGo').onclick = () => {
  if (!room) return;
  const { net, code } = room;
  room = null;
  net.send({ t: 'lstart' }); // everyone in the lobby says hello to the game and gets pulled in
  start(net, code, hostOpts());
};

function sendHello() {
  const { name, color: col, car: c } = playerInfo();
  guest?.net.send({ t: 'hello', name, color: col, car: c });
}
function leaveGuest() {
  guest?.net.destroy();
  guest = null;
}

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
  } catch (e) {
    console.error(e);
    net.destroy();
    status(e.message || 'Could not connect.', true);
    busy(false);
    return;
  }
  guest = { net, code };
  status('Connected! Getting the room info…');
  const timer = setTimeout(() => {
    if (guest?.net === net && screen === 'code') {
      leaveGuest();
      status('The host did not respond.', true);
      busy(false);
    }
  }, 10000);
  net.on('closed', () => {
    if (guest?.net !== net) return;
    guest = null;
    show('code', false);
    status('The host closed the room.', true);
  });
  net.on('msg', (m) => {
    if (guest?.net !== net) return;
    if (m.t === 'lobby') {
      // Host is still in the menu: wait in the lobby
      clearTimeout(timer);
      busy(false);
      if (screen === 'code') show('lobby');
      renderLobby(m, false);
    } else if (m.t === 'lstart') {
      status('Starting…');
      sendHello(); // the game itself answers with a welcome
    } else if (m.t === 'welcome') {
      // Host is in a game (just started, or we joined late): jump in
      clearTimeout(timer);
      guest = null;
      busy(false);
      start(net, code, { mode: m.mode, map: m.map, laps: m.laps, mods: m.mods, welcome: m });
    }
  });
  sendHello();
};
$('code').addEventListener('keydown', (e) => e.key === 'Enter' && $('join').click());

// Keyboard: arrows move between choices, Esc goes back
document.addEventListener('keydown', (e) => {
  if ($('menu').classList.contains('hidden')) return;
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
  if (e.key === 'Escape' || (e.key === 'Backspace' && !typing)) {
    if (!$('back').classList.contains('hidden')) $('back').click();
    return;
  }
  if (typing || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
  const rows = [...document.querySelectorAll('#menu .screen.on .row')];
  if (!rows.length) return;
  e.preventDefault();
  const i = rows.indexOf(document.activeElement);
  rows[(i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length].focus();
});

// Invite links (?room=CODE) go straight into joining
const params = new URLSearchParams(location.search);
if (params.get('room')) {
  $('code').value = params.get('room').toUpperCase();
  path = 'join';
  trail.push('start');
  show('car', false);
} else show('start', false);
