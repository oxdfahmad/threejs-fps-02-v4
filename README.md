# Ember Quay — a harbour tactical FPS

A round-based tactical FPS in the Counter-Strike shape, built on three.js
0.187.0 (vendored, no network): five attackers of the **Ember Syndicate**
against five of the **Night Watch** on one hero map — a lantern-lit harbour
quay at dusk with three lanes (Gull Lane, Quay Walk, Net Loft) and two sites
(Beacon Court, Fish Market).

## What is in the game

- **Rounds:** 12 rounds, first to 7. Buy phase, then a live phase that ends
  by elimination, by the core exploding, by a defuse, or by the clock.
- **The core:** the Entry bot carries it; if they fall, the nearest attacker
  takes it — or you pick it up yourself, walk it to a site and hold E to
  plant (3.5 s). A planted core ticks 40 s; a defender channels 5 s to
  defuse.
- **Money:** kills pay $300, wins $3,250, losses $1,900 plus a streak bonus.
  The buy menu (during the buy phase) sells four primaries, armour,
  a helmet and three throwables.
- **Gunplay:** hitscan bodies with headshots, recoil and bloom that
  punish firing on the move, ADS (right mouse), crouching, acceleration,
  jumping, collision with the map. Tracers, muzzle flashes, ejected
  casings and floating damage numbers make every shot readable.
- **Bots:** five named bots per side with roles (Entry, Lurk, Support,
  Sniper, Caller / A Hold, B Hold, Mid, Roam, Sniper). They follow routes,
  hold positions, react to sight and to the sound of gunfire, rotate to
  retake a planted site, and talk on the radio — contacts, rotations,
  plants and footsteps, always naming the place. Every bot wears a
  floating name tag with their name and role.
- **HUD:** team bar with named teams and the round clock, a live minimap
  (walls, sites, the core, allies, seen enemies, your facing), a roster,
  the current location name, kill feed with weapon names and headshot
  tags, radio feed, health/armour/money, loadout and throwables.
- **The map:** a red-white beacon tower with a sweeping light, a gantry
  crane, string lights across every lane, giant chalk site letters,
  hazard-striped barriers, a cobbled quay, a dry fountain in Tide Plaza,
  and a low sun over the harbour water past the east parapet. Mid-map
  blocks break the long sightlines into 10–20 m lanes, so fights happen
  close — the way the best tactical shooters read.
- **Sound:** WebAudio synthesis only — rifle cracks, a marksman report,
  hit and kill tones, reload clicks, plant beeps, footsteps.

## How to play

Open `game/index.html` in a browser (or `node serve.ts` and visit
http://localhost:8080). Click to lock the mouse and start.

- WASD move · Space jump · C / Ctrl crouch · mouse look
- Click shoot · right mouse aim down sights · R reload
- 1 / 2 / 3 switch weapon (primary / Lark P-9 / Shiv)
- 4–7 buy a primary during the buy phase
- E (hold) plant the core / defuse it · Q smoke · F flash · G frag
- M mute

## Screenshots

The four screenshots are real renders of this code, staged mid-round in
live firefights (`?shot=1` Tide Plaza, `?shot=2` Gull Lane,
`?shot=3` the plant at Beacon Court, `?shot=4` Net Loft). No shot shows
a menu: every one opens on combat, mid-round, with a non-zero score.

## Files

- `game/index.html` — page + HUD
- `game/src/main.js` — game loop, shooting, staging
- `game/src/world.js` — Ember Quay (map, sky, landmarks, waypoints)
- `game/src/bots.js` — named bots with roles and name tags
- `game/src/player.js`, `weapon.js`, `rounds.js`, `radio.js`,
  `throwables.js`, `effects.js`, `hud.js`, `audio.js`, `input.js`,
  `util.js`, `palette.js`
- `game/vendor/three/` — three.js 0.187.0, vendored byte-for-byte
- `main.ts` — hand-in program (copies game + screenshots, writes dossier)
- `serve.ts` — local static server for playtesting
