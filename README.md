# Kart Blasters 🏎️💥

A browser-based, peer-to-peer multiplayer car game with two modes:

- **🏁 Race:** Hot Wheels–style stunt tracks with loops, corkscrews, a helix spiral, banked turns, jumps and boost pads. Race your friends and AI cars over 1 to 5 laps.
- **💥 Battle:** a Shell Shockers–style arena. Your car has a roof turret: aim with the mouse and blast your friends and the AI enemy cars with blasters and rockets.

Built with Three.js. Multiplayer is peer-to-peer over WebRTC (PeerJS) with no game server: the host's browser is the hub.

## Cars

| Car | Style |
| --- | --- |
| Hyper | Balanced wedge-shaped supercar |
| Muscle | Top speed, heavy steering |
| Formula | Grippy and quick, but fragile in battle |
| Buggy | Punchy acceleration, great grip |
| Brute | Slow, but takes a beating (135 HP) |

## Maps

| Map | Mode | Features |
| --- | --- | --- |
| Orange Loop | Race | Classic orange plastic track on stands: loop, green helix, jump |
| Neon Highway | Race | Floating sky city at night: corkscrew, loop, wave section, two jumps |
| Stadium | Battle | Walled arena with cover, jump pads, rocket/health/boost pickups |

## Play with a friend

1. Player 1 picks a car, the mode and the map, then clicks **Create room** and **Copy invite link** at the top of the screen.
2. Player 2 opens the link (or types the 5-letter code), picks a car and clicks **Join room**.
3. In race mode the host presses **Enter** to start the countdown. Until then everyone can free-drive.

### Race controls

| Key | Action |
| --- | --- |
| W / S (or arrows) | Gas / brake and reverse |
| A / D | Steer |
| Space | Drift (take corners faster, charges nitro) |
| Shift | Nitro |
| R | Recenter on the track |
| Esc | Pause / leave |

Take the jumps fast: if you come up short, you wipe out and respawn before the ramp.

### Battle controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Drive |
| Mouse | Aim turret (click the game to lock the mouse) |
| Left click | Blaster (can overheat) |
| Right click / E / Q | Rocket (grab red pickups for ammo) |
| Shift | Boost |
| Space | Drift / handbrake |
| Tab | Scoreboard |
| M | Mute |

**Practice offline vs AI** runs either mode with no network at all.

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
- Star topology: the host relays messages between guests, runs the AI cars, starts races and owns battle pickups.
- Each player simulates their own car and streams its state 20 times a second. In battle, hits are decided by the victim and bot damage by the shooter, so shooting feels responsive with no lag compensation.
- Race cars drive in track space (distance along the track plus sideways offset), so they stick to loops and corkscrews. Remote cars are smoothed along the track curve.
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
