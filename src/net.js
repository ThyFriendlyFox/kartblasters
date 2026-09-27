import Peer from 'peerjs';

// Room codes map to a PeerJS id on the free public signaling server.
// Game traffic itself goes directly between browsers over WebRTC.
const PREFIX = 'kartblasters-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ICE servers (STUN + TURN relays). Preferred: short-lived Cloudflare TURN
// credentials from our own /api/turn function (see api/turn.js). Fallback:
// a fixed list in VITE_ICE_SERVERS, else PeerJS's default STUN servers.
let ice = null; // { at, servers }
async function iceServers() {
  if (ice && performance.now() - ice.at < 6 * 3600e3) return ice.servers;
  let servers = null;
  try {
    const r = await fetch('/api/turn', { signal: AbortSignal.timeout(4000) });
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) servers = (await r.json()).iceServers || null;
  } catch {
    // Offline, local dev, or TURN not set up: fall through
  }
  if (!servers?.length && import.meta.env.VITE_ICE_SERVERS) {
    try {
      servers = JSON.parse(import.meta.env.VITE_ICE_SERVERS);
    } catch {
      console.warn('Invalid VITE_ICE_SERVERS');
    }
  }
  ice = { at: performance.now(), servers: servers?.length ? servers : null };
  return ice.servers;
}

// Optional self-hosted signaling server via Vite env vars (see README).
async function peerOptions() {
  const env = import.meta.env;
  const opts = { debug: 1 };
  if (env.VITE_PEER_HOST) {
    opts.host = env.VITE_PEER_HOST;
    if (env.VITE_PEER_PORT) opts.port = +env.VITE_PEER_PORT;
    opts.path = env.VITE_PEER_PATH || '/';
    opts.secure = env.VITE_PEER_SECURE !== 'false';
  }
  const servers = await iceServers();
  if (servers) opts.config = { iceServers: servers };
  return opts;
}

// Messages the host forwards to every other peer after handling them.
const RELAY = new Set(['s', 'f', 'h', 'k', 'fin', 'dig', 'blk', 'car', 'zap', 'bm']);

export function makeCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

/**
 * Star topology: the host is the hub. Clients send to the host; the host
 * handles messages and relays them to everyone else. With `offline` the
 * host has no network at all (practice mode).
 */
export class Net {
  constructor() {
    this.peer = null;
    this.isHost = false;
    this.offline = false;
    this.conns = new Map();
    this.hostConn = null;
    this.myId = null;
    this.handlers = { msg() {}, leave() {}, closed() {} };
  }

  on(ev, fn) {
    this.handlers[ev] = fn;
  }

  startOffline() {
    this.isHost = true;
    this.offline = true;
    this.myId = 'me';
  }

  async hostGame() {
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = makeCode();
      try {
        await this._openHost(code);
        return code;
      } catch (err) {
        if (err?.type !== 'unavailable-id') throw err;
      }
    }
    throw new Error('Could not reserve a room code, try again.');
  }

  async _openHost(code) {
    const opts = await peerOptions();
    return new Promise((resolve, reject) => {
      this.isHost = true;
      const peer = new Peer(PREFIX + code, opts);
      let opened = false;
      peer.on('open', (id) => {
        opened = true;
        this.peer = peer;
        this.myId = id;
        resolve();
      });
      peer.on('error', (err) => {
        if (!opened) {
          peer.destroy();
          reject(err);
        } else console.warn('peer error', err);
      });
      // Losing the signaling server doesn't kill existing connections; try to get back for new joiners.
      peer.on('disconnected', () => {
        if (!peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 1000);
      });
      peer.on('connection', (conn) => {
        conn.on('open', () => this.conns.set(conn.peer, conn));
        conn.on('data', (data) => this._fromClient(conn, data));
        conn.on('close', () => this._drop(conn.peer));
        conn.on('error', () => this._drop(conn.peer));
      });
    });
  }

  async joinGame(code) {
    const opts = await peerOptions();
    return new Promise((resolve, reject) => {
      const peer = new Peer(opts);
      this.peer = peer;
      let done = false;
      const fail = (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        peer.destroy();
        reject(err);
      };
      const timer = setTimeout(() => fail(new Error('Timed out connecting to the host.')), 15000);
      peer.on('open', (id) => {
        this.myId = id;
        const conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true, serialization: 'json' });
        this.hostConn = conn;
        conn.on('open', () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve();
        });
        conn.on('data', (d) => this.handlers.msg(d, d.i));
        conn.on('close', () => done && this.handlers.closed());
        conn.on('error', (e) => (done ? console.warn(e) : fail(e)));
      });
      peer.on('error', (err) => {
        if (err?.type === 'peer-unavailable') fail(new Error(`Room "${code}" not found.`));
        else if (!done) fail(err);
        else console.warn('peer error', err);
      });
    });
  }

  _fromClient(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    msg.i = conn.peer; // never trust the sender's claimed id
    if (RELAY.has(msg.t)) {
      for (const [id, c] of this.conns) if (id !== conn.peer && c.open) c.send(msg);
    }
    this.handlers.msg(msg, conn.peer);
  }

  _drop(id) {
    if (!this.conns.has(id)) return;
    this.conns.delete(id);
    this.handlers.leave(id);
    this.send({ t: 'leave', id });
  }

  /** Send to everybody else in the room. */
  send(msg) {
    msg.i = this.myId;
    if (this.offline) return;
    if (this.isHost) {
      for (const c of this.conns.values()) if (c.open) c.send(msg);
    } else if (this.hostConn?.open) {
      this.hostConn.send(msg);
    }
  }

  sendTo(id, msg) {
    msg.i = this.myId;
    const c = this.conns.get(id);
    if (c?.open) c.send(msg);
  }

  sendExcept(id, msg) {
    msg.i = this.myId;
    for (const [cid, c] of this.conns) if (cid !== id && c.open) c.send(msg);
  }

  /** Send a request only the host handles (the host handles its own synchronously). */
  toHost(msg) {
    msg.i = this.myId;
    if (this.isHost) this.handlers.msg(msg, this.myId);
    else if (this.hostConn?.open) this.hostConn.send(msg);
  }

  get peerCount() {
    return this.conns.size;
  }

  destroy() {
    try {
      this.peer?.destroy();
    } catch {}
  }
}
