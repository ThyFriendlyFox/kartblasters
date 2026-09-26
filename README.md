# Kart Blasters 🏎️💥

A browser-based, peer-to-peer multiplayer car game with two modes:

- **🏁 Race:** Hot Wheels–style stunt tracks with loops, corkscrews, a helix spiral, banked turns, jumps and boost pads. Race your friends and AI cars over 1 to 5 laps.
- **💥 Battle:** a Shell Shockers–style arena. Your car has a roof turret: aim with the mouse and blast your friends and the AI enemy cars with blasters and rockets.

Built with Three.js. Multiplayer is peer-to-peer over WebRTC (PeerJS) with no game server: the host's browser is the hub.

## Cars

The menu (and the battle pause screen) shows each car's Acceleration, Top Speed, Boost Power, Grip and Health as bars.

| Car | Style |
| --- | --- |
| Hyper | Balanced wedge-shaped supercar |
| Muscle | Top speed, heavy steering |
| Formula | Grippy and quick, but fragile in battle |
| Buggy | Punchy acceleration, great grip |
| Brute | Slow, but takes a beating (135 HP) |
| Longtail 17 | Gold 1970s long-tail endurance racer: highest top speed, a little less grip (90 HP). Always wears its gold #17 race livery; your color tints one side pinstripe |
| Rockcrawler | Black six-wheeled luxury off-road pickup on knobby tyres: slow, very grippy, toughest in battle (145 HP). Stays black; your color is its wheel rings |
| Sharkbite | Shark-shaped hot rod with open jaws, fins and a chrome blown engine: quick off the line |
| Six Pack | Candy-paint six-wheeler hatch with the engine bursting through the hood, on redline tyres |
| Dice Rod | Two-tone patina rat rod with dice air cleaners and wide whitewalls: punchy, a bit loose |

## Maps

The menu shows an aerial preview of the selected map with its lap length and a rough lap time. The three epic tracks take about two minutes a lap, so a 1-lap race is already a proper outing.

| Map | Mode | Features |
| --- | --- | --- |
| Orange Loop | Race | Classic orange plastic track on stands: loop, green helix, jump |
| Neon Highway | Race | Floating sky city at night: corkscrew, loop, wave section, two jumps |
| Mega Loop Canyon | Race | Desert stunt run: giant loop, double loop, big jump |
| Volcano Spiral | Race | Double helix climbing round a volcano, steep drop into a mega loop |
| Twin Peaks | Race | Two routes (low road or the High Road jump) plus a key-locked corkscrew shortcut |
| Neon Junction | Race | Split-level sky highway (upper waves or Lower Deck) plus a key-locked Express lane |
| Summit Rush | Race (epic, ~2 min lap) | Switchbacks up a snowy mountain, a leap off the summit and a plunge down the far side, plus loops, a corkscrew and a spiral flyover |
| Canyon Colossus | Race (epic, ~2 min lap) | Stacked stunt park on lattice pillars: roads cross over and under each other, three wall rides, a spiral climb to a high line, two corkscrews, loops and a long plunge |
| Skyline Spiral | Race (epic, ~2 min lap) | Neon stunt stack: climbing wall ride, loop, rooftop gaps, a corkscrew, two turns up a skyscraper, a dive onto a banked wall-ride descent, double loop and a wall-ride chicane |
| Stadium | Battle | Walled arena with cover, jump pads, rocket/health/boost pickups |
| Crater Field | Battle | Rolling hills with brick forts and stone pillars |

### Weapons (battle)

Inspired by the Raze flash games. Everyone starts with the Blaster; the rest come from weapon crates around both battle maps (each crate is labeled with its key). Picking up a weapon you already have tops up its ammo. You go back to the Blaster when you die.

| Key | Weapon | What it does |
| --- | --- | --- |
| 1 | Blaster | Unlimited, but overheats if you hold the trigger |
| 2 | Blunderbuss | 8-pellet shotgun blast, short range |
| 3 | Laser Minigun | Very fast, spread-out lasers |
| 4 | Hail Storm | Arcing ice balls that bounce up to 3 times (shoot around corners) |
| 5 | Bubble Blaster | Slow bubbles that home in on the enemy you aim at |
| 6 | Grenade Launcher | Sticky plasma grenades that explode 1 s after landing (they dig craters) |
| 7 | Flamethrower | Short-range fire that sets targets burning |
| 8 | Electro Bolt | On hit, arcs to up to 3 more enemies nearby, even through walls |
| 9 | Focus Beam | Continuous beam that never misses, low damage per tick |
| 0 | Holy Grail | Sniper: a near-instant 85-damage shot, slow reload |

Rockets stay on right click / E / Q, with ammo from the red pickups. AI cars grab weapon crates too and pick the best weapon for the range they're fighting at.

### Destructible terrain (battle)

Tick **💣 Destructible terrain** when hosting a battle (on by default). Then:

- rockets blast craters into the ground, and cars roll down into them
- walls, crates, barriers and tire stacks are built from blocks: four blaster hits or one rocket knocks a block out, and anything stacked on top collapses

Everyone sees the same holes. Craters are carved so the result doesn't depend on the order messages arrive in, and players who join mid-game get the full damage history.

## Play with a friend

1. Player 1 picks a car, the mode and the map, then clicks **Create room** and **Copy invite link** at the top of the screen.
2. Player 2 opens the link (or types the 5-letter code), picks a car and clicks **Join room**.
3. In race mode everyone free-drives in the lobby until the host clicks **Start race** (or presses Enter). That starts a countdown for everyone at once.
4. After the race, everyone sees the same results screen, and the host can start the next race. Anyone who joins mid-race spectates the leader and races in the next one.

### Race controls

| Key | Action |
| --- | --- |
| W / S (or arrows) | Gas / brake and reverse |
| A / D | Steer |
| Space | Drift (take corners faster, charges nitro) |
| Shift | Nitro |
| A / D in the air | Spin trick |
| Space in the air | Flip trick |
| R | Recenter on the track |
| Esc | Pause / leave |

Take the jumps fast: if you come up short, you wipe out and respawn past the landing.

**Routes and keys:** on Twin Peaks and Neon Junction the road splits in a Y: it widens, a striped divider appears, and the two roads peel apart. Keep to the side the sign points to and you take that route; later the routes come back together in an inverse Y and merge into one road again. Locked routes (🔒) open once you drive through that track's golden key 🔑, and stay open for you for the rest of the race.

**Tricks:** in the air, tap A/D to spin or Space to flip. You can chain them. Land with the trick finished for a speed boost (bigger combos give a bigger boost). Land mid-trick and you lose speed.

**Drifting:** hold Space while steering. The longer you hold it, the hotter the sparks get: blue, then orange, then pink.

### Battle controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Drive |
| Mouse | Aim turret (click the game to lock the mouse) |
| Left click | Fire the current weapon |
| 1 … 9, 0 (top row) / mouse wheel | Switch weapon |
| Right click / E / Q | Rocket (grab red pickups for ammo) |
| Shift | Boost |
| Space | Drift / handbrake |
| Tab | Scoreboard |
| M | Mute |
| Esc | Pause menu: change your car (takes effect when you next respawn) |

**Practice offline vs AI** runs either mode with no network at all.

### Sound

- **Engines:** every car has its own synthesized engine, built from real firing pulses through an exhaust resonance and a muffler, with a 6-speed gearbox and crackles when you lift off the gas.

  | Car | Engine |
  | --- | --- |
  | Hyper | V12 (smooth) |
  | Muscle | Cross-plane V8 (burble) |
  | Formula | V10 (rasp) |
  | Buggy | Flat-4 (boxer thrum) |
  | Brute | Big-block V8 (deep) |
  | Longtail 17 | Flat-12 (high-revving scream) |
  | Rockcrawler | Twin-turbo V8 (smooth, deep) |
  | Sharkbite, Six Pack | Blown V8 (lumpy cam) |
  | Dice Rod | Rodded old-school V8 (low rumble) |

- **Music:** a procedurally generated soundtrack, with one tune per map style and one for battle. Toggle it with the 🎵 checkbox in the menu or pause screen, or press **N**. **M** mutes everything.

### Playing on a phone

Open the site on your phone and turn it sideways.

- **Drive** with the joystick on the left: sideways steers, up is gas, down is brake.
- **Buttons:** NITRO/BOOST and DRIFT on the right, 🚀 rocket in battle, ⏸ top-left.
- **Battle:** drag a finger anywhere else on the screen to aim the turret; holding the finger down fires. Thumb on the joystick and a finger aiming works at the same time. Tap the weapon bar to switch weapons.
- **Race tricks:** in the air, tap the left or right side of the screen to spin, or DRIFT to flip.
- **Tilt steering (optional):** tap ⏸ and turn on **📱 Tilt steering**. Then rotate the phone like a steering wheel to steer, and tilt it forward for gas or back to brake. "Neutral" is however you're holding it when you tap Play. On iPhone this asks for motion-sensor permission. The choice is remembered.

Tilt needs HTTPS, which Vercel provides.

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
