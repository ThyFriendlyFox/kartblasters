# Kart Blasters 🏎️💥

A browser-based, peer-to-peer multiplayer go-kart combat game, similar in spirit to Shell Shockers. You drive a kart with a turret on top, aim with the mouse, and blast your friends and the AI enemy karts.

- **3D** with Three.js, third-person camera that follows your turret
- **P2P multiplayer** over WebRTC (PeerJS). No game server: the host's browser is the hub
- **Enemy bot karts** that chase, circle-strafe, grab pickups and shoot back
- Blaster (can overheat), rockets with splash damage, boost, drifting, jump pads
- Pickups for rockets, health and boost. Kill feed, scoreboard, minimap, synthesized sound

## Play

1. Player 1 clicks **Create room**, picks how many bots, then clicks **Copy invite link** at the top of the screen.
2. Player 2 opens the link (or types the 5-letter code) and clicks **Join room**.
3. Click the game to lock the mouse.

| Control | Action |
| --- | --- |
| W A S D / arrows | Drive |
| Mouse | Aim turret |
| Left click | Blaster |
| Right click / E / Q | Rocket |
| Shift | Boost |
| Space | Drift / handbrake |
| Tab | Scoreboard |
| M | Mute |
| Esc | Free the cursor |

**Practice offline vs bots** needs no network at all.

## Run locally

```bash
npm install
npm run dev
```

## Deploy to Vercel

The project is a static Vite site, so no server config is needed.

- **Dashboard:** import the GitHub repo at vercel.com/new. Vercel detects Vite automatically (build `npm run build`, output `dist`).
- **CLI:** `npm i -g vercel && vercel --prod`

## How the networking works

- The room code maps to a PeerJS id on the free public PeerJS signaling server (`0.peerjs.com`). That server only introduces the two browsers. Gameplay traffic goes directly browser-to-browser over a WebRTC data channel.
- Star topology: the host relays messages between guests, runs the bots and owns the pickups.
- Each player simulates their own kart. Hits are decided by the victim, and bot damage is decided by the shooter, so shooting feels responsive with no lag compensation.
- If the host closes the tab, the room ends.

### Optional: your own signaling server

To avoid depending on the public PeerJS server, run [`peer`](https://github.com/peers/peerjs-server) somewhere and set these at build time (for example in Vercel project env vars):

```
VITE_PEER_HOST=your-peer-server.example.com
VITE_PEER_PORT=443
VITE_PEER_PATH=/
VITE_PEER_SECURE=true
```

### Connection trouble?

WebRTC uses STUN to punch through home routers, which works for most people. Some strict networks (certain corporate, school or mobile carrier NATs) need a TURN relay server. If you can't connect, try a different network or add TURN servers via `VITE_ICE_SERVERS` (a JSON array of RTCIceServer objects).
