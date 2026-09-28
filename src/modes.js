import * as THREE from 'three';

/**
 * Battle game types, win conditions and tournaments.
 *
 * The host runs every rule (scores, flags, zones, the bomb, rounds, the
 * clock) and sends the match state to everyone a few times a second plus
 * on every event; guests only draw it. Kills and damage still work the way
 * they always have (the victim reports its own death).
 */

export const RULES = {
  ffa: { name: 'Free for All', icon: '💀', teams: false, target: 15, time: 360, desc: 'Every car for itself. First to 15 kills wins' },
  tdm: { name: 'Team Deathmatch', icon: '⚔️', teams: true, target: 30, time: 420, desc: 'Red vs Blue. First team to 30 kills wins' },
  ctf: { name: 'Capture the Flag', icon: '🚩', teams: true, target: 3, time: 480, desc: 'Steal the enemy flag and drive it home. First to 3 captures' },
  snd: { name: 'Search & Destroy', icon: '💣', teams: true, target: 4, roundTime: 120, fuse: 35, desc: 'One life per round. Attackers plant the bomb, defenders stop them. First to 4 rounds' },
  dom: { name: 'Domination', icon: '🏳️', teams: true, target: 200, time: 480, desc: 'Hold zones A, B and C to score. First to 200 points' },
};
export const RULE_IDS = Object.keys(RULES);

export const TEAMS = [
  { name: 'Red', color: '#ff3b3b', css: '#ff5a5a' },
  { name: 'Blue', color: '#2e8bff', css: '#4fa3ff' },
];

/** Tournaments: battle "cups", a run of matches played for points. */
export const TOURNAMENTS = {
  rookie: {
    icon: '🥉', name: 'Rookie Rumble', color: 'linear-gradient(145deg, #f0b27a, #b86b2d)',
    matches: [['ffa', 'stadium'], ['tdm', 'craters'], ['dom', 'cube']],
  },
  clash: {
    icon: '🥈', name: 'Team Clash', color: 'linear-gradient(145deg, #eef2f7, #8f9aa8)',
    matches: [['tdm', 'stadium'], ['ctf', 'craters'], ['dom', 'daytona'], ['snd', 'cube']],
  },
  grand: {
    icon: '🥇', name: 'Grand Tournament', color: 'linear-gradient(145deg, #ffe27a, #e0a410)',
    matches: [['ffa', 'cube'], ['tdm', 'daytona'], ['ctf', 'stadium'], ['dom', 'craters'], ['snd', 'stadium']],
  },
  random: { icon: '🎲', name: 'Random Tournament', color: 'linear-gradient(145deg, #c9a2ff, #6a3fd1)', matches: null },
};
export function randomTournament() {
  const maps = ['stadium', 'craters', 'daytona', 'cube'];
  const rules = [...RULE_IDS].sort(() => Math.random() - 0.5).slice(0, 4);
  return rules.map((r) => [r, maps[Math.floor(Math.random() * maps.length)]]);
}

// Tournament points for each finish (free for all), and for team results
const FFA_POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
const WIN_POINTS = 10, LOSE_POINTS = 4, DRAW_POINTS = 6, MVP_BONUS = 2;

/** Where the objectives sit on each arena: team bases, Domination zones and bomb sites. */
export function layoutFor(world) {
  switch (world.map) {
    case 'craters':
      return { bases: [[-80, 0], [80, 0]], points: [[-30, -30], [0, 0], [30, 30]], sites: [[0, 40], [0, -40]] };
    case 'daytona':
      return { bases: [[-182, 0], [182, 0]], points: [[0, 77], [12, 2], [0, -93]], sites: [[-60, 77], [60, -90]] };
    case 'cube':
      return { bases: [[-63, 0], [63, 0]], points: [[-35, -25], [0, 0], [35, 25]], sites: [[0, 40], [0, -40]] };
    default:
      return { bases: [[-80, 0], [80, 0]], points: [[-45, -20], [0, 36], [45, 20]], sites: [[0, 55], [0, -55]] };
  }
}

const ZONE_R = 8, FLAG_R = 4.5, SITE_R = 7, DEFUSE_R = 6;
const PLANT_TIME = 3, DEFUSE_TIME = 5, FLAG_RETURN = 25, SND_BREAK = 5;
const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

export class Match {
  /**
   * game: the battle Game; rule: a RULES id; tour: { id, matches, idx } or null.
   * state: the host's state to resume from (guests get it from the welcome).
   */
  constructor(game, rule, tour = null, state = null) {
    this.game = game;
    this.rule = RULES[rule] ? rule : 'ffa';
    this.def = RULES[this.rule];
    this.teams = this.def.teams;
    this.tour = tour;
    this.layout = layoutFor(game.world);
    this.sendT = 0;
    this.s = state || this.freshState();
    this.buildScene();
    this.buildHud();
  }

  freshState() {
    const d = this.def;
    const s = { scores: [0, 0], time: d.time || 0, over: null };
    if (this.rule === 'ctf') s.flags = [0, 1].map((t) => ({ st: 'home', x: this.layout.bases[t][0], z: this.layout.bases[t][1], by: null, at: 0 }));
    if (this.rule === 'dom') s.pts = this.layout.points.map(() => ({ own: -1, p: 0 }));
    if (this.rule === 'snd') s.snd = { round: 1, att: 0, phase: 'live', t: d.roundTime, bomb: null, fuse: 0, plant: 0, defuse: 0, brk: 0 };
    return s;
  }

  // ---------------------------------------------------------------- teams

  teamOf(id) {
    return this.teams ? this.game.players.get(id)?.team ?? null : null;
  }

  /** Can a hurt b? (no friendly fire in team modes; you can always hurt yourself) */
  hostile(a, b) {
    if (!this.teams || a === b) return true;
    const ta = this.teamOf(a), tb = this.teamOf(b);
    return ta == null || tb == null || ta !== tb;
  }

  /** Host: put a newcomer on the smaller team. */
  pickTeam() {
    const n = [0, 0];
    for (const p of this.game.players.values()) if (p.team === 0 || p.team === 1) n[p.team]++;
    return n[0] <= n[1] ? 0 : 1;
  }

  /** Spawn near your base in team modes (Search & Destroy: attackers and defenders swap ends). */
  spawnFor(k) {
    const t = this.teamOf(k.id);
    if (t == null) return null;
    let side = t;
    if (this.rule === 'snd') side = t === this.s.snd.att ? 0 : 1;
    const [bx, bz] = this.layout.bases[side];
    const w = this.game.world;
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 12;
      const x = bx + Math.cos(a) * r, z = bz + Math.sin(a) * r;
      if (!w.blocked?.(x, w.groundAt(x, z) + 1, z) && Math.abs(x) < w.half - 4 && Math.abs(z) < w.half - 4) return { x, z, yaw: Math.atan2(-x, -z) };
    }
    return { x: bx, z: bz, yaw: Math.atan2(-bx, -bz) };
  }

  /** Search & Destroy: no respawning until the next round. */
  get oneLife() {
    return this.rule === 'snd';
  }

  // ---------------------------------------------------------------- host logic

  aliveOf(team) {
    const out = [];
    for (const [id, k] of this.game.karts) if (k.alive && this.teamOf(id) === team) out.push(k);
    return out;
  }

  membersOf(team) {
    let n = 0;
    for (const id of this.game.karts.keys()) if (this.teamOf(id) === team) n++;
    return n;
  }

  announce(text, sub = '', color = '#ffd23f', sfx = 'lap') {
    const m = { t: 'ann', text, sub, color, sfx };
    this.game.net.send(m);
    this.onAnnounce(m);
  }

  onAnnounce(m) {
    this.game.hud.center(String(m.text).slice(0, 60), String(m.sub || '').slice(0, 80), 2600);
    const el = document.getElementById('center');
    if (el) el.style.color = /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '';
    clearTimeout(this.colorT);
    this.colorT = setTimeout(() => el && (el.style.color = ''), 2700);
    if (m.sfx) this.game.sfx.play(m.sfx, 0.8);
  }

  sync(now, force = false) {
    if (!force && now - this.sendT < 250) return;
    this.sendT = now;
    this.game.net.send({ t: 'obj', s: this.s });
  }

  /** Host: run the rules. */
  hostTick(dt, now) {
    const s = this.s;
    if (s.over) return this.sync(now);
    if (this.rule === 'snd') this.tickSnd(dt, now);
    else {
      s.time -= dt;
      if (this.rule === 'ctf') this.tickCtf(now);
      if (this.rule === 'dom') this.tickDom(dt);
      this.checkScoreWin();
      if (!s.over && s.time <= 0) this.finish(this.leader(), 'Time!');
    }
    this.sync(now);
  }

  /** Who's ahead: a team index, a player id (free for all), or null for a draw. */
  leader() {
    if (!this.teams) {
      const ranked = [...this.game.players].sort((a, b) => b[1].kills - a[1].kills);
      if (!ranked.length || (ranked[1] && ranked[1][1].kills === ranked[0][1].kills)) return null;
      return ranked[0][0];
    }
    const [r, b] = this.s.scores;
    return r === b ? null : r > b ? 0 : 1;
  }

  checkScoreWin() {
    const t = this.def.target;
    if (!this.teams) {
      for (const [id, p] of this.game.players) if (p.kills >= t) return this.finish(id, `${p.name} reached ${t} kills`);
      return;
    }
    for (const team of [0, 1]) if (this.s.scores[team] >= t) return this.finish(team, '');
  }

  /** Host: a kart was wrecked (called for every kill). */
  onKill(m) {
    const s = this.s;
    if (s.over) return;
    if (this.rule === 'tdm') {
      const tk = this.teamOf(m.by), tv = this.teamOf(m.v);
      if (tk != null && tv != null && tk !== tv) s.scores[tk]++;
    }
    if (this.rule === 'ctf') for (const f of s.flags) if (f.st === 'carried' && f.by === m.v) this.dropFlag(f, performance.now());
    this.checkScoreWin();
    this.sync(performance.now(), true);
  }

  // Capture the flag
  dropFlag(f, now) {
    const k = this.game.karts.get(f.by);
    if (k) {
      f.x = k.pos.x;
      f.z = k.pos.z;
    }
    f.st = 'dropped';
    f.by = null;
    f.at = now;
  }

  tickCtf(now) {
    const { flags } = this.s, bases = this.layout.bases;
    for (const f of flags) {
      if (f.st === 'carried') {
        const k = this.game.karts.get(f.by);
        if (!k || !k.alive) this.dropFlag(f, now);
        else {
          f.x = k.pos.x;
          f.z = k.pos.z;
        }
      }
      if (f.st === 'dropped' && now - f.at > FLAG_RETURN * 1000) this.flagHome(f, flags.indexOf(f));
    }
    for (const [id, k] of this.game.karts) {
      if (!k.alive) continue;
      const t = this.teamOf(id);
      if (t == null) continue;
      const mine = flags[t], theirs = flags[1 - t];
      const near = (f, r) => Math.hypot(k.pos.x - f.x, k.pos.z - f.z) < r && k.pos.y - this.game.world.groundAt(f.x, f.z) < 6;
      const name = this.game.players.get(id)?.name || 'Someone';
      if (theirs.st !== 'carried' && near(theirs, FLAG_R)) {
        theirs.st = 'carried';
        theirs.by = id;
        this.announce(`${TEAMS[t].name.toUpperCase()} HAS THE ${TEAMS[1 - t].name.toUpperCase()} FLAG`, `${name} took it`, TEAMS[t].color, 'pickup');
      }
      if (mine.st === 'dropped' && near(mine, FLAG_R)) {
        this.flagHome(mine, t);
        this.announce(`${TEAMS[t].name.toUpperCase()} FLAG RETURNED`, `by ${name}`, TEAMS[t].color, 'pickup');
      }
      if (theirs.st === 'carried' && theirs.by === id && mine.st === 'home' && Math.hypot(k.pos.x - bases[t][0], k.pos.z - bases[t][1]) < 6) {
        this.s.scores[t]++;
        this.flagHome(theirs, 1 - t);
        this.announce(`${TEAMS[t].name.toUpperCase()} SCORES!`, `${name} captured the flag · ${this.s.scores[0]} - ${this.s.scores[1]}`, TEAMS[t].color, 'kill');
      }
    }
  }

  flagHome(f, team) {
    f.st = 'home';
    f.by = null;
    [f.x, f.z] = this.layout.bases[team];
  }

  // Domination
  tickDom(dt) {
    const s = this.s;
    this.domClock = (this.domClock || 0) + dt;
    this.layout.points.forEach(([x, z], i) => {
      const pt = s.pts[i];
      const n = [0, 0];
      for (const [id, k] of this.game.karts) {
        if (!k.alive) continue;
        const t = this.teamOf(id);
        if (t == null) continue;
        if (Math.hypot(k.pos.x - x, k.pos.z - z) < ZONE_R && Math.abs(k.pos.y - this.game.world.groundAt(x, z)) < 7) n[t]++;
      }
      if (n[0] && n[1]) return; // contested: nothing moves
      const t = n[0] ? 0 : n[1] ? 1 : -1;
      if (t < 0) return;
      // The bar runs from -1 (red owns it) to +1 (blue owns it): about 4 s to
      // neutralise and 4 more to take it, quicker with more cars on it
      const dir = t === 0 ? -1 : 1, before = pt.own;
      pt.p = Math.max(-1, Math.min(1, pt.p + dir * dt * (0.25 + 0.06 * Math.min(4, n[t] - 1))));
      if (pt.p <= -1) pt.own = 0;
      else if (pt.p >= 1) pt.own = 1;
      else if ((pt.own === 0 && pt.p > 0) || (pt.own === 1 && pt.p < 0)) pt.own = -1;
      if (pt.own !== before && pt.own >= 0) this.announce(`${TEAMS[t].name.toUpperCase()} TOOK ${'ABC'[i]}`, '', TEAMS[t].color, 'pickup');
      else if (pt.own !== before) this.announce(`${'ABC'[i]} IS NEUTRAL`, '', '#dddddd', 'beep');
    });
    while (this.domClock >= 1) {
      this.domClock -= 1;
      for (const pt of s.pts) if (pt.own >= 0) s.scores[pt.own]++;
    }
  }

  // Search and destroy
  tickSnd(dt, now) {
    const s = this.s, r = s.snd;
    const att = r.att, def = 1 - att;
    if (r.phase === 'post') {
      r.brk -= dt;
      if (r.brk <= 0) this.startRound(r.round + 1, 1 - att);
      return;
    }
    const attAlive = this.aliveOf(att), defAlive = this.aliveOf(def);
    if (r.phase === 'live') {
      r.t -= dt;
      const planter = attAlive.find((k) => this.layout.sites.some(([x, z]) => Math.hypot(k.pos.x - x, k.pos.z - z) < SITE_R));
      if (planter) {
        r.plant += dt;
        if (r.plant >= PLANT_TIME) {
          const site = this.layout.sites.findIndex(([x, z]) => Math.hypot(planter.pos.x - x, planter.pos.z - z) < SITE_R);
          r.phase = 'planted';
          r.bomb = site;
          r.fuse = this.def.fuse;
          r.plant = 0;
          this.announce('BOMB PLANTED', `Site ${'AB'[site]} · ${this.def.fuse} seconds to defuse`, '#ff7b1c', 'beep');
        }
      } else r.plant = Math.max(0, r.plant - dt * 2);
      if (this.membersOf(att) && !attAlive.length) return this.endRound(def, 'Attackers wiped out');
      if (this.membersOf(def) && !defAlive.length) return this.endRound(att, 'Defenders wiped out');
      if (r.t <= 0) return this.endRound(def, 'Time ran out');
    } else if (r.phase === 'planted') {
      r.fuse -= dt;
      const [bx, bz] = this.layout.sites[r.bomb];
      if (defAlive.some((k) => Math.hypot(k.pos.x - bx, k.pos.z - bz) < DEFUSE_R)) {
        r.defuse += dt;
        if (r.defuse >= DEFUSE_TIME) return this.endRound(def, 'Bomb defused');
      } else r.defuse = Math.max(0, r.defuse - dt * 2);
      if (r.fuse <= 0) {
        const m = { t: 'boom', x: bx, z: bz };
        this.game.net.send(m);
        this.onBoom(m);
        return this.endRound(att, 'The bomb went off');
      }
      if (this.membersOf(def) && !defAlive.length) return this.endRound(att, 'Defenders wiped out');
    }
  }

  endRound(team, why) {
    const s = this.s, r = s.snd;
    s.scores[team]++;
    r.phase = 'post';
    r.brk = SND_BREAK;
    this.announce(`${TEAMS[team].name.toUpperCase()} WINS ROUND ${r.round}`, `${why} · ${s.scores[0]} - ${s.scores[1]}`, TEAMS[team].color, 'lap');
    if (s.scores[team] >= this.def.target) this.finish(team, why);
  }

  startRound(round, att) {
    const r = this.s.snd;
    Object.assign(r, { round, att, phase: 'live', t: this.def.roundTime, bomb: null, fuse: 0, plant: 0, defuse: 0, brk: 0 });
    const m = { t: 'rnd', round, att };
    this.game.net.send(m);
    this.onRound(m);
    this.sync(performance.now(), true);
  }

  /** Everyone: a new Search and Destroy round, everybody back in. */
  onRound(m) {
    if (!this.game.net.isHost) Object.assign(this.s.snd, { round: m.round, att: m.att, phase: 'live' });
    const g = this.game;
    if (g.joined) g.spawnKart(g.me);
    if (g.net.isHost) for (const { kart } of g.bots) g.spawnKart(kart);
    const mine = this.teamOf(g.me.id);
    this.onAnnounce({ text: `ROUND ${m.round}`, sub: mine == null ? '' : mine === m.att ? '💣 You attack: plant the bomb at site A or B' : '🛡️ You defend: stop the bomb', color: '#ffd23f', sfx: 'go' });
  }

  onBoom(m) {
    const g = this.game, pos = new THREE.Vector3(+m.x, g.world.groundAt(+m.x, +m.z) + 1, +m.z);
    for (let i = 0; i < 4; i++) g.fx.explosion(pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 3, (Math.random() - 0.5) * 8)), '#ff7b1c', 1.6);
    g.sfx.play('explode', 1);
    g.shake = Math.max(g.shake, 1);
  }

  /** Host: the match is decided. Award tournament points and tell everyone. */
  finish(winner, why) {
    const s = this.s;
    if (s.over) return;
    const pts = this.points(winner);
    s.over = { winner, why, pts };
    const m = { t: 'mend', over: s.over, scores: s.scores };
    this.game.net.send(m);
    this.game.onMatchEnd(m);
  }

  points(winner) {
    const out = {};
    const ranked = [...this.game.players].sort((a, b) => b[1].kills - a[1].kills || a[1].deaths - b[1].deaths);
    if (!this.teams) {
      ranked.forEach(([id], i) => (out[id] = FFA_POINTS[i] || 0));
      return out;
    }
    for (const [id] of ranked) {
      const t = this.teamOf(id);
      out[id] = winner == null ? DRAW_POINTS : t === winner ? WIN_POINTS : LOSE_POINTS;
    }
    if (ranked[0] && ranked[0][1].kills > 0) out[ranked[0][0]] += MVP_BONUS;
    return out;
  }

  // ---------------------------------------------------------------- bots

  /** Host: where a bot should head for the objective ({ x, z, urgent }), or null to just fight. */
  botGoal(k) {
    const t = this.teamOf(k.id), s = this.s;
    if (t == null || s.over) return null;
    const role = ((k.id.charCodeAt(k.id.length - 1) || 0) + (this.s.snd?.round || 0)) % 2; // half attack, half defend
    if (this.rule === 'ctf') {
      const mine = s.flags[t], theirs = s.flags[1 - t];
      if (theirs.st === 'carried' && theirs.by === k.id) return { x: this.layout.bases[t][0], z: this.layout.bases[t][1], urgent: true };
      if (mine.st !== 'home' && (role || mine.st === 'dropped')) return { x: mine.x, z: mine.z, urgent: true };
      if (role && mine.st === 'home') return { x: mine.x, z: mine.z, urgent: false };
      return { x: theirs.x, z: theirs.z, urgent: theirs.st !== 'carried' };
    }
    if (this.rule === 'dom') {
      let best = null, bestD = Infinity;
      this.layout.points.forEach(([x, z], i) => {
        if (s.pts[i].own === t && Math.abs(s.pts[i].p) >= 1) return;
        const d = Math.hypot(k.pos.x - x, k.pos.z - z) * (role ? 1 : 0.6 + i * 0.2);
        if (d < bestD) { bestD = d; best = { x, z, urgent: d < 40 }; }
      });
      if (best) return best;
      const [x, z] = this.layout.points[(k.id.length + role) % 3];
      return { x, z, urgent: false };
    }
    if (this.rule === 'snd') {
      const r = s.snd;
      if (r.phase === 'post') return null;
      if (r.phase === 'planted') {
        const [x, z] = this.layout.sites[r.bomb];
        return { x, z, urgent: t !== r.att || Math.random() < 0.5 };
      }
      const [x, z] = this.layout.sites[role];
      return { x, z, urgent: t === r.att };
    }
    return null;
  }

  // ---------------------------------------------------------------- drawing

  buildScene() {
    const g = this.game, scene = g.scene, w = g.world;
    this.group = new THREE.Group();
    scene.add(this.group);
    const ring = (x, z, r, color, opacity = 0.55) => {
      const y = w.groundAt(x, z);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.4, 48, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
      m.position.set(x, y + 0.7, z);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(x, y + 0.08, z);
      this.group.add(m, floor);
      return { wall: m, floor };
    };
    const label = (text, color, x, z, h = 9) => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const x2 = c.getContext('2d');
      x2.font = 'bold 96px system-ui, sans-serif';
      x2.textAlign = 'center';
      x2.lineWidth = 10;
      x2.strokeStyle = 'rgba(0,0,0,0.8)';
      x2.strokeText(text, 64, 98);
      x2.fillStyle = color;
      x2.fillText(text, 64, 98);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      sp.scale.set(4, 4, 1);
      sp.position.set(x, w.groundAt(x, z) + h, z);
      sp.renderOrder = 5;
      this.group.add(sp);
      return sp;
    };
    if (this.teams && this.rule !== 'snd') this.layout.bases.forEach(([x, z], t) => ring(x, z, 6, TEAMS[t].color, 0.35));
    if (this.rule === 'ctf') {
      this.flagMeshes = [0, 1].map((t) => {
        const f = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 8), new THREE.MeshStandardMaterial({ color: '#dddddd', metalness: 0.6 }));
        pole.position.y = 3;
        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.6, 6, 2), new THREE.MeshBasicMaterial({ color: TEAMS[t].color, side: THREE.DoubleSide }));
        cloth.position.set(1.3, 5.1, 0);
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: TEAMS[t].color }));
        glow.position.y = 6.2;
        f.add(pole, cloth, glow);
        f.userData.cloth = cloth;
        this.group.add(f);
        return f;
      });
    }
    if (this.rule === 'dom') {
      this.zones = this.layout.points.map(([x, z], i) => ({ ...ring(x, z, ZONE_R, '#dddddd'), label: label('ABC'[i], '#ffffff', x, z) }));
    }
    if (this.rule === 'snd') {
      this.sites = this.layout.sites.map(([x, z], i) => ({ ...ring(x, z, SITE_R, '#ff9f1c', 0.45), label: label('AB'[i], '#ff9f1c', x, z) }));
      const bomb = new THREE.Group();
      bomb.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1.1), new THREE.MeshStandardMaterial({ color: '#2b2f36' })));
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff2020' }));
      light.position.y = 0.6;
      bomb.add(light);
      bomb.userData.light = light;
      bomb.visible = false;
      this.bombMesh = bomb;
      this.group.add(bomb);
    }
  }

  buildHud() {
    let el = document.getElementById('objBar');
    if (!el) {
      el = document.createElement('div');
      el.id = 'objBar';
      document.getElementById('hud').appendChild(el);
    }
    this.bar = el;
  }

  /** Everyone: draw the objectives and the score bar. */
  render(dt, now) {
    const s = this.s, g = this.game, w = g.world;
    if (this.flagMeshes) {
      s.flags.forEach((f, t) => {
        const m = this.flagMeshes[t];
        const k = f.st === 'carried' ? g.karts.get(f.by) : null;
        if (k) m.position.copy(k.pos).add(new THREE.Vector3(0, 1.2, 0));
        else m.position.set(f.x, w.groundAt(f.x, f.z), f.z);
        m.userData.cloth.rotation.y = Math.sin(now * 0.006 + t) * 0.35;
        m.rotation.y += dt * (f.st === 'dropped' ? 2 : 0.4);
      });
    }
    if (this.zones) {
      this.zones.forEach((zn, i) => {
        const pt = s.pts[i], c = pt.own >= 0 ? TEAMS[pt.own].color : '#dddddd';
        zn.wall.material.color.set(c);
        zn.floor.material.color.set(Math.abs(pt.p) > 0.01 ? TEAMS[pt.p < 0 ? 0 : 1].color : '#dddddd');
        zn.floor.material.opacity = 0.1 + 0.3 * Math.abs(pt.p);
        zn.wall.scale.y = 0.6 + 0.4 * Math.abs(Math.sin(now * 0.003 + i));
      });
    }
    if (this.bombMesh) {
      const r = s.snd;
      this.bombMesh.visible = r.phase === 'planted' && r.bomb != null;
      if (this.bombMesh.visible) {
        const [x, z] = this.layout.sites[r.bomb];
        this.bombMesh.position.set(x, w.groundAt(x, z) + 0.45, z);
        this.bombMesh.userData.light.visible = Math.floor(now / (r.fuse < 10 ? 120 : 400)) % 2 === 0;
      }
    }
    this.drawBar(now);
  }

  drawBar() {
    const s = this.s, d = this.def, g = this.game;
    let mid = '';
    if (this.rule === 'ctf') {
      const st = (f) => (f.st === 'home' ? '🏠' : f.st === 'carried' ? '🏃' : '⚠️');
      mid = `🚩 ${st(s.flags[0])} · ${st(s.flags[1])}`;
    } else if (this.rule === 'dom') {
      mid = s.pts.map((pt, i) => `<i class="zone" style="background:${pt.own >= 0 ? TEAMS[pt.own].css : '#666'}">${'ABC'[i]}</i>`).join('');
    } else if (this.rule === 'snd') {
      const r = s.snd, mine = this.teamOf(g.me.id);
      const role = mine == null ? '' : mine === r.att ? '💣 ATTACK' : '🛡️ DEFEND';
      const act = r.phase === 'planted' ? `BOMB ${'AB'[r.bomb]} ${Math.ceil(r.fuse)}s${r.defuse > 0 ? ` · defusing ${Math.round((r.defuse / DEFUSE_TIME) * 100)}%` : ''}` : r.plant > 0 ? `planting ${Math.round((r.plant / PLANT_TIME) * 100)}%` : fmt(r.t);
      mid = `R${r.round} · ${role} · ${act}`;
    } else if (!this.teams) {
      const me = g.players.get(g.me.id);
      mid = `First to ${d.target} · you ${me?.kills ?? 0}`;
    }
    const clock = this.rule === 'snd' ? '' : `<b class="clock">${fmt(s.time)}</b>`;
    const score = this.teams
      ? `<b style="color:${TEAMS[0].css}">${s.scores[0]}</b><span class="vs">${d.icon} ${d.name}</span><b style="color:${TEAMS[1].css}">${s.scores[1]}</b>`
      : `<span class="vs">${d.icon} ${d.name}</span>`;
    const html = `<div class="sc">${score}</div><div class="mid">${[mid, clock].filter(Boolean).join(' · ')}</div>`;
    if (html !== this.lastBar) {
      this.bar.innerHTML = html;
      this.lastBar = html;
    }
  }

  /** Objective markers for the minimap. */
  marks() {
    const s = this.s, out = [];
    if (this.teams && this.rule !== 'snd') this.layout.bases.forEach(([x, z], t) => out.push({ x, z, color: TEAMS[t].color, r: 4 }));
    if (s.flags) s.flags.forEach((f, t) => {
      const k = f.st === 'carried' ? this.game.karts.get(f.by) : null;
      out.push({ x: k ? k.pos.x : f.x, z: k ? k.pos.z : f.z, color: TEAMS[t].color, label: '⚑' });
    });
    if (s.pts) this.layout.points.forEach(([x, z], i) => out.push({ x, z, color: s.pts[i].own >= 0 ? TEAMS[s.pts[i].own].color : '#dddddd', label: 'ABC'[i] }));
    if (s.snd) this.layout.sites.forEach(([x, z], i) => out.push({ x, z, color: s.snd.bomb === i ? '#ff3b3b' : '#ff9f1c', label: 'AB'[i] }));
    return out;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.map?.dispose();
      o.material?.dispose?.();
    });
  }
}

/** The results panel: this match's table plus tournament standings. */
export function resultsHTML(game, over) {
  const m = game.match, teams = m.teams;
  const rows = [...game.players]
    .sort((a, b) => b[1].kills - a[1].kills || a[1].deaths - b[1].deaths)
    .map(([id, p]) => {
      const t = teams ? p.team : null;
      const got = over.pts?.[id] ?? 0;
      return `<tr class="${id === game.me.id ? 'me' : ''}"><td><span class="dot" style="background:${esc(t != null ? TEAMS[t].color : p.color)}"></span>${esc(p.name)}${p.bot ? ' <small>BOT</small>' : ''}</td><td>${p.kills} / ${p.deaths}</td><td>${m.tour ? `+${got}` : ''}</td></tr>`;
    });
  let head;
  if (over.winner == null) head = 'DRAW';
  else if (teams) head = `${TEAMS[over.winner].name.toUpperCase()} TEAM WINS`;
  else head = `${esc(game.players.get(over.winner)?.name || '?').toUpperCase()} WINS`;
  const score = teams ? `<p class="bigScore"><b style="color:${TEAMS[0].css}">${m.s.scores[0]}</b> – <b style="color:${TEAMS[1].css}">${m.s.scores[1]}</b></p>` : '';
  let tour = '';
  if (m.tour) {
    const ranked = [...game.players].sort((a, b) => (b[1].tp || 0) - (a[1].tp || 0));
    const last = m.tour.idx >= m.tour.matches.length - 1;
    tour = `<h3>${TOURNAMENTS[m.tour.id]?.icon || '🏆'} ${esc(TOURNAMENTS[m.tour.id]?.name || 'Tournament')} · match ${m.tour.idx + 1}/${m.tour.matches.length}${last ? ' · FINAL STANDINGS' : ''}</h3><table class="gp">${ranked
      .map(([id, p], i) => `<tr class="${id === game.me.id ? 'me' : ''}"><td>${i === 0 && last ? '👑' : `${i + 1}.`}</td><td><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}</td><td><b>${p.tp || 0}</b></td></tr>`)
      .join('')}</table>`;
  }
  return { head, body: `${score}<p class="why">${esc(over.why || '')}</p><table><tr><th>Driver</th><th>K / D</th><th>${m.tour ? 'Pts' : ''}</th></tr>${rows.join('')}</table>${tour}` };
}
