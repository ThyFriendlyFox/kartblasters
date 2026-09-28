import { WEAPONS, SLOTS } from './weapons.js';
import { TEAMS } from './modes.js';

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'),
      hpFill: $('hpFill'),
      hpText: $('hpText'),
      boostFill: $('boostFill'),
      heatFill: $('heatFill'),
      heatLabel: $('heatLabel'),
      rockets: $('rockets'),
      speed: $('speed'),
      feed: $('killfeed'),
      board: $('board'),
      scoreboard: $('scoreboard'),
      center: $('center'),
      sub: $('sub'),
      vignette: $('vignette'),
      hitmarker: $('hitmarker'),
      toast: $('toast'),
      room: $('room'),
      minimap: $('minimap'),
    };
    this.centerUntil = 0;
    this.toastUntil = 0;
    this.last = {};
    this.mapCtx = this.el.minimap.getContext('2d');
  }

  show() {
    this.el.hud.classList.remove('hidden');
  }

  set(key, el, prop, value) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    if (prop === 'text') el.textContent = value;
    else if (prop === 'width') el.style.width = value;
    else if (prop === 'html') el.innerHTML = value;
  }

  stats(k, speed) {
    const hp = Math.max(0, Math.round(k.hp));
    this.set('hpw', this.el.hpFill, 'width', `${(hp / k.maxHp) * 100}%`);
    this.set('hpt', this.el.hpText, 'text', `${hp}`);
    const f = hp / k.maxHp;
    this.el.hpFill.style.background = f > 0.5 ? '#4ade80' : f > 0.25 ? '#facc15' : '#ef4444';
    this.set('boost', this.el.boostFill, 'width', `${Math.round(k.boost * 100)}%`);
    this.set('heat', this.el.heatFill, 'width', `${Math.round(Math.min(1, k.heat) * 100)}%`);
    this.el.heatFill.classList.toggle('over', k.overheated);
    this.set('heatl', this.el.heatLabel, 'text', k.overheated ? 'OVERHEATED' : 'HEAT');
    this.set('rk', this.el.rockets, 'text', `${k.rockets}`);
    this.set('spd', this.el.speed, 'text', `${Math.round(Math.abs(speed) * 3.2)}`);
  }

  room(code, count) {
    if (!code) {
      this.set('room', this.el.room, 'html', '<b>PRACTICE</b> · offline');
      return;
    }
    this.set('room', this.el.room, 'html', `Room <b>${esc(code)}</b> · ${count} online <button id="copyLink">Copy invite link</button>`);
  }

  feed(html) {
    const d = document.createElement('div');
    d.className = 'feed-item';
    d.innerHTML = html;
    this.el.feed.prepend(d);
    while (this.el.feed.children.length > 6) this.el.feed.lastChild.remove();
    setTimeout(() => d.classList.add('fade'), 5000);
    setTimeout(() => d.remove(), 6000);
  }

  killFeed(killer, victim, weapon) {
    const icon = WEAPONS[weapon]?.icon || '⚡';
    if (!killer || killer === victim) {
      this.feed(`<span style="color:${esc(victim.color)}">${esc(victim.name)}</span> 💥 ${weapon === 'wall' ? 'hit the wall too hard' : 'wrecked'}`);
      return;
    }
    this.feed(`<span style="color:${esc(killer.color)}">${esc(killer.name)}</span> ${icon} <span style="color:${esc(victim.color)}">${esc(victim.name)}</span>`);
  }

  center(text, sub = '', ms = 1800) {
    this.el.center.textContent = text;
    this.el.sub.textContent = sub;
    this.centerUntil = ms ? performance.now() + ms : Infinity;
  }

  clearCenter() {
    this.el.center.textContent = '';
    this.el.sub.textContent = '';
    this.centerUntil = 0;
  }

  toast(text) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('on');
    this.toastUntil = performance.now() + 1400;
  }

  damage(amount) {
    const v = this.el.vignette;
    v.style.opacity = String(Math.min(0.85, 0.25 + amount / 60));
    clearTimeout(this.vigT);
    this.vigT = setTimeout(() => (v.style.opacity = '0'), 120);
  }

  hit(kill = false) {
    const h = this.el.hitmarker;
    h.classList.remove('on', 'kill');
    void h.offsetWidth;
    h.classList.add('on');
    if (kill) h.classList.add('kill');
  }

  tick(now) {
    if (this.centerUntil && now > this.centerUntil) this.clearCenter();
    if (this.toastUntil && now > this.toastUntil) {
      this.el.toast.classList.remove('on');
      this.toastUntil = 0;
    }
  }

  sorted(players) {
    return [...players.entries()].sort((a, b) => b[1].kills - a[1].kills || a[1].deaths - b[1].deaths);
  }

  board(players, myId, teams = false) {
    const rows = this.sorted(players).slice(0, 6).map(([id, p], i) =>
      `<div class="row${id === myId ? ' me' : ''}"${teams && p.team != null ? ` style="box-shadow: inset 3px 0 ${TEAMS[p.team].color}; padding-left: 6px"` : ''}><span>${i + 1}.</span><span class="dot" style="background:${esc(p.color)}"></span><span class="nm">${esc(p.name)}</span><b>${p.kills}</b></div>`,
    );
    const html = rows.join('');
    this.set('board', this.el.board, 'html', html);
  }

  scoreboard(players, myId, visible, teams = false) {
    this.el.scoreboard.classList.toggle('hidden', !visible);
    if (!visible) return;
    const list = this.sorted(players);
    if (teams) list.sort((a, b) => (a[1].team ?? 2) - (b[1].team ?? 2));
    const rows = list.map(([id, p]) =>
      `<tr class="${id === myId ? 'me' : ''}"><td><span class="dot" style="background:${esc(teams && p.team != null ? TEAMS[p.team].color : p.color)}"></span>${esc(p.name)}${p.bot ? ' <small>BOT</small>' : ''}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`,
    );
    this.set('sb', this.el.scoreboard, 'html', `<table><tr><th>Driver</th><th>Kills</th><th>Deaths</th></tr>${rows.join('')}</table>`);
  }

  /** Row of weapon slots 1..0: owned ones light up, current one highlighted, with ammo. */
  weaponBar(k) {
    const el = $('weaponBar');
    const key = `${k.weapon}|${k.weapon2}|${SLOTS.map((w) => k.inv[w] || 0).join(',')}`;
    if (this.last.wbar === key) return;
    this.last.wbar = key;
    if (!el.children.length) {
      for (const w of SLOTS) {
        const d = document.createElement('div');
        d.className = 'wslot';
        d.innerHTML = `<b>${WEAPONS[w].key || WEAPONS[w].slot}</b><span>${WEAPONS[w].icon}</span><small></small>`;
        d.title = WEAPONS[w].name;
        el.appendChild(d);
      }
      this.wName = document.createElement('div');
      this.wName.className = 'wname';
      el.appendChild(this.wName);
    }
    SLOTS.forEach((w, i) => {
      const d = el.children[i];
      const owned = w === 'blaster' || k.inv[w] > 0;
      d.classList.toggle('owned', owned);
      d.classList.toggle('on', k.weapon === w);
      d.classList.toggle('off', k.weapon2 === w);
      d.style.setProperty('--wc', WEAPONS[w].color || '#ffffff');
      d.querySelector('small').textContent = w === 'blaster' ? '∞' : owned ? k.inv[w] : '';
    });
    this.wName.textContent = (WEAPONS[k.weapon]?.name || '') + (k.weapon2 ? ` + ${WEAPONS[k.weapon2].name} (left hand)` : '');
  }

  minimap(world, karts, items, me, marks = []) {
    const c = this.el.minimap, g = this.mapCtx, S = c.width;
    const scale = S / (world.half * 2 + 8);
    const tx = (x) => S / 2 - x * scale; // mirror X so the map matches the camera's left/right
    const tz = (z) => S / 2 - z * scale;
    g.clearRect(0, 0, S, S);
    g.fillStyle = 'rgba(20,24,32,0.7)';
    g.fillRect(0, 0, S, S);
    if (world.outline) {
      g.strokeStyle = 'rgba(200,210,230,0.6)';
      g.lineWidth = 2;
      for (const line of world.outline) {
        g.beginPath();
        line.forEach(([x, z], i) => (i ? g.lineTo(tx(x), tz(z)) : g.moveTo(tx(x), tz(z))));
        g.stroke();
      }
    }
    g.fillStyle = 'rgba(200,210,230,0.55)';
    for (const b of world.boxes) {
      if (b.dead) continue;
      g.fillRect(tx(b.maxX), tz(b.maxZ), (b.maxX - b.minX) * scale, (b.maxZ - b.minZ) * scale);
    }
    for (const cy of world.cyls) {
      if (cy.dead) continue;
      g.beginPath();
      g.arc(tx(cy.x), tz(cy.z), Math.max(1.5, cy.r * scale), 0, Math.PI * 2);
      g.fill();
    }
    for (const it of items.values()) {
      if (!it.active) continue;
      g.fillStyle = it.type === 'rocket' ? '#ff4d4d' : it.type === 'health' ? '#4ade80' : '#facc15';
      g.fillRect(tx(it.x) - 2, tz(it.z) - 2, 4, 4);
    }
    // Objectives: bases, flags, zones and bomb sites
    for (const mk of marks) {
      g.strokeStyle = mk.color;
      g.fillStyle = mk.color;
      if (mk.label) {
        g.font = 'bold 11px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.beginPath();
        g.arc(tx(mk.x), tz(mk.z), 7, 0, Math.PI * 2);
        g.globalAlpha = 0.35;
        g.fill();
        g.globalAlpha = 1;
        g.fillStyle = '#fff';
        g.fillText(mk.label, tx(mk.x), tz(mk.z) + 0.5);
      } else {
        g.lineWidth = 2;
        g.beginPath();
        g.arc(tx(mk.x), tz(mk.z), Math.max(4, (mk.r || 4) * scale), 0, Math.PI * 2);
        g.stroke();
      }
    }
    for (const k of karts.values()) {
      if (!k.alive || k === me) continue;
      g.fillStyle = k.teamColor || k.color;
      g.strokeStyle = '#000';
      g.beginPath();
      g.arc(tx(k.pos.x), tz(k.pos.z), 4, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    if (me.alive) {
      const x = tx(me.pos.x), y = tz(me.pos.z);
      g.save();
      g.translate(x, y);
      g.rotate(-me.aimYaw);
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(0, -7);
      g.lineTo(5, 5);
      g.lineTo(-5, 5);
      g.closePath();
      g.fill();
      g.restore();
    }
  }
}
