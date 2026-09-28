# Kart Blasters 🏎️💥

A browser-based, peer-to-peer multiplayer car game with three modes:

- **🏁 Race:** Hot Wheels–style stunt tracks with loops, corkscrews, a helix spiral, banked turns, jumps and boost pads. Race your friends and up to 20 AI cars over 1 to 20 laps.
- **🏆 Grand Prix:** race a cup of tracks back to back for championship points (15, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1 down the order). Cups: Classic (the six original tracks), Epic (the two-minute tracks), Everything (every track) and Random (four random tracks). After each race the results show the championship table; the host's button loads the next track for everyone, and the last race crowns a champion.
- **💥 Battle:** a Shell Shockers–style arena. Your car has a roof turret: aim with the mouse and blast your friends and the AI enemy cars with blasters and rockets.

Built with Three.js. Multiplayer is peer-to-peer over WebRTC (PeerJS) with no game server: the host's browser is the hub.

## Menu

The menu is split into sections, one step at a time (a row of steps at the top shows where you are):

1. **Play:** Solo (vs AI, offline), Host online, or Join a friend.
2. **Mode:** Race, Grand Prix, Battle or Tournament.
3. **Car:** a showroom with your car turning on a lit turntable and its stat bars, a carousel of every car along the bottom (click, or use the ◀ ▶ arrows / arrow keys), your paint colour and driver name.
4. **Track / Cup / Arena / Tournament** and the options below. Grand Prix cups are picked from medallion cards: 🏁 Classic, ⛰️ Epic, 🌈 Everything and 🎲 Random. Tracks and arenas are a grid of aerial shots, battle game types are icon tiles, and the options are chips (AI cars, laps, car size) and on/off tiles (endless nitro, wall damage, destructible terrain). Tournaments have their own medal cards (see below). The map shots and car pictures are prerendered (`npm run thumbs` regenerates them after changing a map or car).
5. **Lobby** (online): the room code and invite link, everyone who's joined with their car, the host's settings, and a START button for the host. Friends who join wait here; anyone can change car from the lobby. People who join after the race has started go straight in.

Joining a friend goes: car → room code → lobby. Invite links (`?room=CODE`) skip to the car screen. Arrow keys move between choices, Esc goes back.

The menu music builds as you go: a pad on the first screen, then an arpeggio, bass and hats, the drums and acid line, and the full track with a guitar riff and lead in the lobby (each new part comes in on the next bar).

## Options

- **AI cars:** none up to 20 (race and battle). Big fields line up three abreast.
- **Laps:** 1 up to 20.
- **Car size:** 🐭 Tiny, Normal or 🐘 Giant for everyone (the camera, lane limits and battle collisions scale to match).
- **♾️ Endless nitro:** boost never runs out.
- **💥 Wall damage:** hitting walls damages your car, and the harder the hit (how fast you're going into the wall) the bigger the damage: a light scrape is free, a firm knock costs around 10-25 HP, a head-on slam can wreck you in one go. Races show a health bar; battered cars smoke, then burn; at zero you're wrecked and respawn fully repaired. In battle, walls and cover hurt too, on top of weapon damage.

The host's choices apply to everyone who joins.

## Achievements

Just for fun: achievements pop up as you earn them (things like *Clean Lap: complete a lap without hitting the wall!*, *Drift King*, *Frequent Flyer*, *Ceiling Walker*, *Slipstreamer*, *Photo Finish*, *Grand Champion*, and battle ones like *Double Trouble* and *Rocket Science*). Nothing is saved: they last until you reload the page, and the ones you have show on the results screen.

## Cars

The menu (and the battle pause screen) shows each car's Acceleration, Top Speed, Boost Power, Grip, Handling and Health as bars. Grip is how much sideways force the tyres hold at speed; Handling is how tightly the car can turn.

| Car | Style |
| --- | --- |
| Hyper | 1980s folded-paper wedge supercar with a turbo, in your color: black louvred rear window, cross-spoke alloys, contrasting pinstripes and door script, TURBO plates. Balanced |
| Muscle | 1960s muscle coupe in your color: stacked headlamps, split grille, hood scoop, chrome trim, Rally wheels on redline tyres. Top speed, heavy steering |
| Formula | Stadium-style open-wheel F1 (red and white, big wings, slick tyres): grippy and quick, but fragile in battle |
| Buggy | Rail dune buggy: tube frame and roll cage in your color, woodgrain side panels, twin-tube front beam, flat-4 with twin air cleaners, big knobby rear tyres and an orange whip flag. Punchy acceleration, great grip |
| Brute | Armoured mine-protected 4x4 in your color: V-shaped hull, crew box with ports and cooling fans, spare wheels on the flanks, huge tyres. Slow, but takes a beating (135 HP) |
| Longtail 17 | 1970s long-tail endurance racer in your color with its #17 race livery (red sills, black side stripe, gold wheels): very high top speed, a little less grip (90 HP) |
| Rockcrawler | Six-wheeled luxury off-road pickup in your color, with carbon flares, on knobby tyres: slow, very grippy, toughest in battle (145 HP) |
| Sharkbite | Shark-shaped hot rod with open jaws, fins and a chrome blown engine: quick off the line |
| Six Pack | Candy-paint six-wheeler hatch with the engine bursting through the hood, on redline tyres |
| Dice Rod | Two-tone patina rat rod with dice air cleaners and wide whitewalls: punchy, a bit loose |
| Soundbreaker | Twin-jet land speed record car: needle nose with a striped probe, two jet nacelles with chrome intakes, body and nacelles in your color with a black swept T-tail fin, solid aluminium wheels. Highest top speed and boost, but the slowest acceleration and very low handling: it rules the long epic tracks and struggles on tight ones (120 HP) |

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
| Lagoon Bay | Race (~40 s lap) | Tropical stunt lap inspired by a Trackmania Turbo lagoon track: a sandy beach run, a jump over a red tower, a concrete bridge between karst rocks, then a dark half-pipe over the sea (red rails, cyan lights) that snakes through wall rides, a giant red loop and a corkscrew, before a jungle bridge past a crane drops you back onto the beach for a final jump |
| Summit Rush | Race (epic, ~2 min lap) | Switchbacks up a snowy mountain, a leap off the summit and a plunge down the far side, plus loops, a corkscrew and a spiral flyover |
| Canyon Colossus | Race (epic, ~2 min lap) | Stacked stunt park on lattice pillars: roads cross over and under each other, three wall rides, a spiral climb to a high line, two corkscrews, loops and a long plunge |
| Skyline Spiral | Race (epic, ~2 min lap) | Neon stunt stack: climbing wall ride, loop, rooftop gaps, a corkscrew, two turns up a skyscraper, a dive onto a banked wall-ride descent, double loop and a wall-ride chicane |
| Chaos Crossing | Race (epic, ~2 min lap) | The two stunt parks tangled together: a Canyon-style main line with roads crossing over and under each other, plus two forks into Skyline-style routes, SKY TOWER (a double spiral climb and a dive back in) and WALL STACK (a stacked, climbing wall-ride hairpin that passes over itself) |
| Gyrosphere | Race (epic, ~1:30 lap) | A cartoon stadium course on the inside of a giant sphere: no straights, the road winds across the floor, up the walls and upside-down over the ceiling, criss-crossing itself (over/unders plus open through-junctions with no walls). All three kinds of loop: vertical loops, corkscrews and banked helix spirals, plus jumps, rolling hills and bumpy roller sections. Three CHORD routes fork off the wall and cut through the middle of the sphere to another part of the course: LOOP CHORD (a loop in mid-air), TWIST CHORD (a double corkscrew) and SKY CHORD |
| Stadium | Battle | Walled arena with cover, jump pads, rocket/health/boost pickups |
| Crater Field | Battle | Rolling hills with brick forts and stone pillars |
| Daytona Speedway | Battle | A scaled-down superspeedway: 31° banked turns, an 18° tri-oval dogleg and a 3° back straight inside a SAFER wall and catch fence, with grandstands, and an infield (pit road, garages, Lake Lloyd, barriers) to fight in |
| Rocket Cube | Battle | Rocket League style arena with rounded edges: drive up the walls and over the ceiling. Your tyres grip harder the faster you go, so walls are easy, but only a boosting car can stay on the ceiling; slow down and gravity pulls you off |

### Battle game types

Pick one on the arena screen. Every game type has a win condition and a time limit (whoever's ahead when time runs out wins; level scores are a draw). The score, clock and objective status sit in a bar at the top of the screen, the objectives are on the minimap, and the match ends on a results screen (the host can start a rematch).

| Game type | How to win |
| --- | --- |
| 💀 Free for All | Every car for itself. First to 15 kills (6 min) |
| ⚔️ Team Deathmatch | Red vs Blue. First team to 30 kills (7 min) |
| 🚩 Capture the Flag | Drive over the enemy flag to grab it and bring it back to your base while your own flag is at home. Wreck a carrier to drop their flag; touch your dropped flag to send it home (it goes back by itself after 25 s). First to 3 captures (8 min) |
| 💣 Search & Destroy | One life per round. Attackers plant the bomb by holding a car inside site A or B for 3 s; defenders stop them, or defuse a planted bomb by staying next to it for 5 s. The bomb goes off after 35 s. Wipe out the other team, blow the bomb, defuse it or run out the 2-minute clock (defenders win). Sides swap every round; first to 4 rounds |
| 🏳️ Domination | Park in zones A, B and C to take them (more cars take them faster; both teams inside means nobody does). Every zone you hold scores a point a second. First to 200 (8 min) |

In team games everyone is dealt into Red or Blue (people first, then AI, kept even), cars get a ring and name tag in their team colour, and there's no friendly fire. AI cars play the objective: they run flags home, chase your carrier, hold zones, plant and defuse.

### Tournaments

Battle's version of a Grand Prix: a run of matches on different arenas and game types, played for points. After each match there's a results screen with the standings, then the next match starts by itself.

| Tournament | Matches |
| --- | --- |
| 🥉 Rookie Rumble | Free for All (Stadium) → Team Deathmatch (Crater Field) → Domination (Rocket Cube) |
| 🥈 Team Clash | Team Deathmatch (Stadium) → Capture the Flag (Crater Field) → Domination (Daytona) → Search & Destroy (Rocket Cube) |
| 🥇 Grand Tournament | Free for All (Rocket Cube) → Team Deathmatch (Daytona) → Capture the Flag (Stadium) → Domination (Crater Field) → Search & Destroy (Stadium) |
| 🎲 Random Tournament | 4 random game types on random arenas |

Points: in Free for All, 10-8-6-5-4-3-2-1 by kills; in team games the winning team gets 10 each and the losers 4 (6 each for a draw), plus 2 for the match's top fragger.

### Weapons (battle)

Inspired by the Raze flash games. Everyone starts with the Blaster; the rest come from weapon crates around every battle map (each crate is labeled with its key). Picking up a weapon you already have tops up its ammo. You go back to the Blaster when you die.

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
| - | Needler | Rapid pink needles that home in and stick. Get 7 stuck in one car within 3 seconds and they set off a supercombine explosion (70 damage) |

Every weapon's projectiles fly at their own speed, from drifting bubbles (26) and seeking needles (58) up through the Blaster (105), shotgun pellets (170) and minigun lasers (240) to the Holy Grail (640); the ranges are the same as before.

**Dual wielding** ✌️ is automatic: you always hold two guns and left click fires both. You start with twin Blasters (which overheat twice as fast). Pick up a gun and it goes in a hand holding a Blaster; switch weapons (1–0, -, wheel) and the gun you were holding moves to your left hand. Each hand has its own fire rate and uses its own ammo; when one runs dry that hand grabs another gun you own (or a Blaster). The HUD marks the left-hand gun with an L. AI cars dual wield their two favourite weapons for the range.

Rockets stay on right click / E / Q, with ammo from the red pickups. AI cars grab weapon crates too and pick the best weapon for the range they're fighting at.

### Destructible terrain (battle)

Tick **💣 Destructible terrain** when hosting a battle (on by default). Then:

- rockets blast craters into the ground, and cars roll down into them
- walls, crates, barriers and tire stacks are built from blocks: four blaster hits or one rocket knocks a block out, and anything stacked on top collapses

Everyone sees the same holes. Craters are carved so the result doesn't depend on the order messages arrive in, and players who join mid-game get the full damage history.

### Finishing a race

The race keeps going until every player has crossed the line; the AI gets 15 more seconds after the last human finishes. Anyone still racing after that gets an estimated time from their pace so far (shown as `~1:23.45`) and is ranked by it. Once you've finished you can watch the others; the host can press Enter (or **End race now**) to wrap up early. A safety timeout (a minute after the first finisher, or half the winning time if that's longer) stops an idle player holding everyone up.

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

**Drafting:** tuck in close behind a car ahead (lined up with it, both at speed) and its slipstream pulls you along: after a moment you get more top speed, quicker acceleration and a trickle of nitro. Wind lines stream past your car and 💨 SLIPSTREAM shows on screen while it works. It works in battle mode too.

### Battle controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Drive |
| Mouse | Aim turret (click the game to lock the mouse) |
| Left click | Fire the current weapon |
| 1 … 9, 0 (top row) / mouse wheel | Switch weapon |
| Right click / E / Q | Rocket (grab red pickups for ammo) |
| Shift | Boost |
| Space | Drift while steering (as in race mode: the tail swings out, sparks heat up, nitro charges) / handbrake when slow |
| Tab | Scoreboard |
| M | Mute |
| Esc | Pause menu: change your car (takes effect when you next respawn) |

**Practice offline vs AI** runs either mode with no network at all.

### Sound

- **Engines:** every car has its own synthesized engine, built from real firing pulses through an exhaust resonance and a muffler, with a 6-speed gearbox and crackles when you lift off the gas.

  | Car | Engine |
  | --- | --- |
  | Hyper | Turbo inline-4 |
  | Muscle | Cross-plane V8 (burble) |
  | Formula | V10 (rasp) |
  | Buggy | Flat-4 (boxer thrum) |
  | Brute | Turbo-diesel straight-6 (deep clatter) |
  | Longtail 17 | Flat-12 (high-revving scream) |
  | Rockcrawler | Twin-turbo V8 (smooth, deep) |
  | Sharkbite, Six Pack | Blown V8 (lumpy cam) |
  | Dice Rod | Rodded old-school V8 (low rumble) |
  | Soundbreaker | Twin jet (turbine whine and roar) |

- **Music:** a procedurally generated soundtrack inspired by early-2000s arcade-racer electronica. Every time a map (or battle arena) loads it gets a brand new random song (the key, tempo, chords, grooves and hook are rolled fresh; a toast shows what's playing) in one of three styles: **Vapor** (misty city-at-night: echoing arpeggios over a rolling bass, broken beats and noise risers), **Space** (pumping four-on-the-floor, a squelchy acid line and spacey echoes) or **Beasts** (hard breakbeat drums and distorted power-chord guitar riffs). Neon Junction keeps its own signature tune. Toggle music with the 🎵 checkbox in the menu or pause screen, or press **N**. **M** mutes everything.

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

WebRTC uses STUN to punch through home routers, which works for most people. Some strict networks (certain corporate, school or mobile carrier NATs) need a TURN relay server, which passes the game traffic along when two players can't reach each other directly.

**Cloudflare TURN (built in):** the game asks its own `/api/turn` function (`api/turn.js`, a Vercel serverless function) for short-lived Cloudflare TURN credentials before connecting. Your Cloudflare API token stays on the server; players only ever see credentials that expire after 12 hours. To turn it on:

1. In the Cloudflare dashboard, create a TURN key (Realtime → TURN). It gives you a **Turn Token ID** and an **API Token**.
2. In Vercel: Project → Settings → Environment Variables, add (for Production, and Preview if you like):
   - `CLOUDFLARE_TURN_KEY_ID` = the Turn Token ID
   - `CLOUDFLARE_TURN_API_TOKEN` = the API Token

   No `VITE_` prefix: these must stay server-side.
3. Redeploy. Check it works by opening `https://your-site/api/turn`: you should see an `iceServers` list with `turn.cloudflare.com` addresses.

If `/api/turn` isn't set up (or you're running locally), the game falls back to `VITE_ICE_SERVERS` if you set one (a JSON array of RTCIceServer objects, baked into the public page, so only use credentials you don't mind being public), and otherwise to PeerJS's default STUN servers.

## Promo ad

Watch it: [`public/kart-blasters-ad.mp4`](public/kart-blasters-ad.mp4), also served by the deployed site at `/kart-blasters-ad.mp4`.

`tools/ad/` renders a ~34 s beat-synced promo video from the real game (tracks, cars, arena and music engine) with motion-graphics titles on top:

```bash
npx vite --host 127.0.0.1 --port 5174 &
node tools/ad/render.mjs kart-blasters-ad.mp4 --w 1920 --h 1080   # needs ffmpeg on PATH (or --ffmpeg /path/to/ffmpeg)
```

Fonts: Russo One and Bungee (SIL Open Font License).
