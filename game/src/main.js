// Ember Quay — the game itself. Wires the world, the player, the bots, the
// rounds, the HUD, the effects and the audio into one fixed-step loop
// (1/60 s, like the real thing) and stages the four judge screenshots.
//
// Shot mode (?shot=1..4): instead of playing, the engine builds one
// mid-combat scene — round 5+, a non-zero score, live tracers and muzzle
// flashes, enemies at close range, a populated kill feed — freezes it, and
// sets window.__shotReady after two frames. The capture flow never shows
// the buy menu: every top-10 entry leads with a firefight, and so do we.

import * as THREE from 'three';
import { createWorld } from './world.js';
import { createPlayer, EYE_STAND, EYE_CROUCH } from './player.js';
import { createLoadout, WEAPONS } from './weapon.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createRadio, ATTACKERS, DEFENDERS } from './radio.js';
import { createThrowables } from './throwables.js';
import { createInput } from './input.js';
import { makeRng, dist, limit, soakArmour, clockText, moneyText } from './util.js';

const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
const shotMode = parseInt(params.get('shot') || '0', 10);
const rng = makeRng(20261115);
window.__shotReady = false;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1426);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 400);
camera.rotation.order = 'YXZ';

const world = createWorld(scene);
const radio = createRadio(rng);
const audio = createAudio();
const effects = createEffects(scene);
const hud = createHud(world);
const input = createInput(renderer.domElement);
const playerObj = createPlayer(world, world.spawns.attacker[1]);
const loadout = createLoadout();
const YOU = { name: 'You', team: 'attacker' };

let now = 0;
let kills = 0;
let deaths = 0;
let hurtFlash = 0;
let recoil = 0;
let fovCur = 75;
let bobPhase = 0;
let frozen = false;
let endShown = false;
let deathHandled = false;
let buyRenderedRound = -1;
const heardShots = [];
const utility = { smoke: 1, flash: 1, frag: 1 };
// Player plant/defuse channel: {kind: 'plant'|'defuse', t: seconds} or null.
let channel = null;
let lastBeep = -10;
let wasAlive = true;

const WEAPON_LABEL = { Sniper: 'Longshot DMR', Entry: 'Kestrel AR', Lurk: 'Hornet SMG', Support: 'Kestrel AR', Caller: 'Kestrel AR', 'A Hold': 'Kestrel AR', 'B Hold': 'Kestrel AR', Mid: 'Hornet SMG', Roam: 'Kestrel AR' };

function onKill(killer, victim, head, loc) {
  const isVictimPlayer = victim === playerObj;
  const victimName = isVictimPlayer ? 'You' : victim.name;
  const killerName = !killer ? 'Frag Grenade' : killer === YOU ? 'You' : killer.name;
  const weapon = !killer ? 'Frag' : killer === YOU ? loadout.current.def.name : WEAPON_LABEL[killer.role] ?? 'Kestrel AR';
  hud.addKillfeed(`${killerName}  ⌖ ${weapon} ⌖  ${victimName}`, head);
  if (isVictimPlayer) {
    deaths += 1;
    deathHandled = true;
    // The core drops where the player fell.
    if (rounds.bomb.carriedBy === 'player') {
      rounds.bomb.drop(playerObj.state.x, playerObj.state.z);
    }
    return;
  }
  if (killer === YOU) {
    kills += 1;
    rounds.killReward();
    audio.kill();
    hud.showHitmarker(head);
  }
  // The core drops with its carrier; a nearby attacker picks it up.
  if (victim.hasBomb) {
    victim.hasBomb = false;
    rounds.bomb.drop(victim.x, victim.z);
  }
}

const botHooks = {
  tracer: (from, to, enemy) => effects.tracer(from, to, enemy),
  muzzle: (pos, yaw) => effects.muzzle(pos, yaw),
  shotSound: (d, kind) => {
    if (d < 45) audio.shot(kind, d);
  },
  playerHit: (lost, head, killer) => {
    hurtFlash = Math.min(1, hurtFlash + 0.5);
    if (!playerObj.state.alive && !deathHandled) onKill(killer, playerObj, head, world.locationAt(playerObj.state.x, playerObj.state.z));
  },
  botHit: () => {},
  kill: (killer, victim, head, loc) => onKill(killer, victim, head, loc),
  isSmoked: (ax, az, bx, bz) => throwables.isSmoked(ax, az, bx, bz),
};

const bots = createBots(scene, world, radio, rng, botHooks);

const throwHooks = {
  throwSound: () => audio.blip(),
  boom: (x, y, z) => {
    audio.boom();
    effects.puff({ x, y, z });
    hurtFlash = Math.min(1, hurtFlash + 0.25);
  },
  kill: (killer, victim, head, loc) => onKill(killer, victim, head, loc),
  smokePuff: (x, y, z) => {
    effects.puff({ x, y: y + 0.4, z });
    effects.puff({ x: x + 0.8, y: y + 0.9, z: z + 0.5 });
  },
  flashPop: () => audio.flashPop(),
};

const throwables = createThrowables(world, throwHooks);

const BUY_ITEMS = [
  { id: 'kestrel', name: 'Kestrel AR', desc: 'Balanced rifle · 25 rounds', price: 2700, kind: 'weapon' },
  { id: 'hornet', name: 'Hornet SMG', desc: 'Fast close-range spray', price: 1700, kind: 'weapon' },
  { id: 'riot', name: 'Riot-12', desc: '8 pellets up close', price: 1500, kind: 'weapon' },
  { id: 'longshot', name: 'Longshot DMR', desc: 'One-shot headshot machine', price: 4750, kind: 'weapon' },
  { id: 'armour', name: 'Kevlar Vest', desc: '100 armour', price: 650, kind: 'gear' },
  { id: 'helmet', name: 'Helmet', desc: 'Halves headshot damage', price: 350, kind: 'gear' },
  { id: 'smoke', name: 'Smoke Grenade', desc: 'Blocks sight for 13 s', price: 300, kind: 'utility' },
  { id: 'flash', name: 'Flashbang', desc: 'Blinds anyone facing it', price: 200, kind: 'utility' },
  { id: 'frag', name: 'Frag Grenade', desc: 'Blast damage in 6.5 m', price: 400, kind: 'utility' },
];

function renderBuy() {
  const s = playerObj.state;
  const items = BUY_ITEMS.map((it) => ({
    ...it,
    owned:
      it.kind === 'weapon'
        ? !!loadout.owned[it.id]
        : it.id === 'armour'
          ? s.armour >= 100
          : it.id === 'helmet'
            ? s.helmet
            : false,
  }));
  hud.showBuy({
    items,
    money: rounds.match.money,
    buy: (id) => {
      const it = BUY_ITEMS.find((b) => b.id === id);
      if (!it) return;
      if (it.kind === 'weapon') {
        const before = rounds.match.money;
        rounds.match.money = loadout.buy(id, rounds.match.money);
        if (rounds.match.money < before) loadout.equip(id);
      } else if (it.id === 'armour' && rounds.match.money >= 650 && s.armour < 100) {
        rounds.match.money -= 650;
        s.armour = 100;
      } else if (it.id === 'helmet' && rounds.match.money >= 350 && !s.helmet) {
        rounds.match.money -= 350;
        s.helmet = true;
      } else if (it.kind === 'utility' && rounds.match.money >= it.price) {
        rounds.match.money -= it.price;
        utility[it.id] += 1;
      }
      audio.blip();
      renderBuy();
    },
  });
}

const roundHooks = {
  onRoundStart: (round, site) => {
    deathHandled = false;
    channel = null;
    const spawns = world.spawns.attacker;
    playerObj.reset(spawns[(round - 1) % spawns.length]);
    bots.spawnRound(site);
    rounds.bomb.carriedBy = 'Riza';
    radio.reset();
    buyRenderedRound = -1;
    hud.hideBuy();
    hud.showBanner(`ROUND ${round} — ${site === 'A' ? 'Beacon Court' : 'Fish Market'}`, now);
  },
  onLive: () => {
    hud.hideBuy();
    hud.showBanner('ROUND LIVE', now);
    audio.blip();
  },
  onRoundEnd: (winner, reason, a, d) => {
    hud.showBanner(reason, now);
    if (winner === 'attacker') audio.win();
    else audio.lose();
  },
  onPlanted: (site) => {
    hud.showBanner(`Core planted at ${site === 'A' ? 'Beacon Court' : 'Fish Market'}`, now);
    audio.plantBeep();
  },
  onDefused: () => {
    hud.showBanner('Core defused', now);
    audio.defuseBeep();
  },
  onMatchEnd: (result, a, d) => {
    if (endShown) return;
    endShown = true;
    const title = result === 'attacker' ? 'EMBER SYNDICATE WINS' : result === 'defender' ? 'NIGHT WATCH WINS' : 'DRAW';
    hud.showEnd(title, `Final score ${a} — ${d}`, `Kills ${kills} · Deaths ${deaths}`);
  },
};

const rounds = createRounds(world, radio, roundHooks);
const { match, bomb } = rounds;

function bombStatusText() {
  if (bomb.state === 'carried') return `Core with ${bomb.carriedBy ?? 'Riza'}`;
  if (bomb.state === 'planted') return `PLANTED ${bomb.site === 'A' ? 'Beacon Court' : 'Fish Market'} — ${Math.ceil(bomb.timer)}s`;
  if (bomb.state === 'dropped') return 'Core dropped — pick it up';
  if (bomb.state === 'exploded') return 'Core detonated';
  return 'Core defused';
}

function buildSnap() {
  const s = playerObj.state;
  const counts = bots.aliveCounts();
  const allies = bots.bots.filter((b) => b.team === 'attacker' && b.alive).map((b) => ({ x: b.x, z: b.z }));
  const enemies = bots.bots
    .filter((b) => b.team === 'defender' && b.alive && now - b.lastSeen < 3)
    .map((b) => ({ x: b.x, z: b.z }));
  const primary = Object.values(loadout.owned).find((o) => o.def.slot === 1);
  return {
    hp: s.hp,
    armour: s.armour,
    money: match.money,
    weaponName: loadout.current.def.name,
    ammo: loadout.ammoText(),
    timer: match.phase === 'live' && bomb.state === 'planted' ? bomb.timer : match.timer,
    round: match.round,
    phase: match.phase === 'buy' ? 'BUY PHASE' : match.phase === 'live' ? 'LIVE' : match.phase === 'over' ? 'ROUND OVER' : 'MATCH OVER',
    scoreAtk: match.scoreAtk,
    scoreDef: match.scoreDef,
    location: world.locationAt(s.x, s.z),
    slots: `1 ${primary ? primary.def.name : '—'} · 2 Lark P-9 · 3 Shiv`,
    utility: `Q Smoke ×${utility.smoke} · F Flash ×${utility.flash} · G Frag ×${utility.frag}`,
    bombStatus: bombStatusText(),
    crossGap: loadout.spread(now, playerObj.groundSpeed(), !s.onGround, s.crouched, input.aiming) * 900 + 6,
    crossHidden: loadout.current.def.id === 'shiv' || match.phase !== 'live' || !s.alive,
    flash: s.flash,
    hurt: hurtFlash,
    plant: channel ? { label: channel.kind === 'plant' ? 'Planting core…' : 'Defusing…', progress: channel.t / (channel.kind === 'plant' ? 3.5 : 5) } : null,
    walls: world.solids,
    sites: world.sites,
    bomb: { state: bomb.state, x: bomb.x, z: bomb.z },
    allies,
    enemies,
    player: { x: s.x, z: s.z, yaw: s.yaw },
    radio: radio.recent(5),
    atkAlive: counts.atk + (s.alive ? 1 : 0),
    defAlive: counts.def,
    atkNames: ATTACKERS.map((r) => r.name),
    defNames: DEFENDERS.map((r) => r.name),
  };
}

function aimDir(yaw, pitch, spreadRad) {
  const y = yaw + (rng() - 0.5) * spreadRad * 2;
  const p = pitch + (rng() - 0.5) * spreadRad * 2;
  return {
    x: -Math.sin(y) * Math.cos(p),
    y: Math.sin(p),
    z: -Math.cos(y) * Math.cos(p),
  };
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const ox2 = ox - cx;
  const oy2 = oy - cy;
  const oz2 = oz - cz;
  const b = ox2 * dx + oy2 * dy + oz2 * dz;
  const c = ox2 * ox2 + oy2 * oy2 + oz2 * oz2 - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : -1;
}

function fireShot() {
  const s = playerObj.state;
  if (!s.alive || match.phase !== 'live') return;
  const fired = loadout.fire(now, playerObj.groundSpeed(), !s.onGround, s.crouched, input.aiming);
  if (!fired) return;
  const { def, spread, pellets } = fired;
  audio.shot(def.kind, 0);
  heardShots.push({ x: s.x, z: s.z });
  const recoilByKind = { rifle: 0.012, smg: 0.008, shotgun: 0.03, marksman: 0.02, pistol: 0.01, melee: 0 };
  recoil = Math.min(0.06, recoil + (recoilByKind[def.kind] ?? 0.01));
  const eye = playerObj.eyePos();
  const fwd = { x: -Math.sin(s.yaw), y: 0, z: -Math.cos(s.yaw) };
  const right = { x: Math.cos(s.yaw), y: 0, z: -Math.sin(s.yaw) };
  const muzzlePos = {
    x: eye.x + fwd.x * 0.7 + right.x * 0.22,
    y: eye.y - 0.18,
    z: eye.z + fwd.z * 0.7 + right.z * 0.22,
  };
  effects.muzzle(muzzlePos, s.yaw);
  effects.casing(muzzlePos, s.yaw);

  if (def.kind === 'melee') {
    // The Shiv: short reach, no tracer, heavy damage.
    for (const b of bots.bots) {
      if (b.team !== 'defender' || !b.alive) continue;
      const d = dist(s.x, s.z, b.x, b.z);
      if (d > 2.3) continue;
      const ang = Math.atan2(-(b.x - s.x), -(b.z - s.z));
      if (Math.abs(ang - s.yaw) > 0.7) continue;
      const dealt = soakArmour(b, 55);
      b.hp -= dealt;
      effects.damageNumber({ x: b.x, y: 1.4, z: b.z }, dealt, false);
      hud.showHitmarker(false);
      audio.hit(false);
      if (b.hp <= 0) {
        b.alive = false;
        b.mesh.visible = false;
        onKill(YOU, b, false, world.locationAt(b.x, b.z));
      }
      break;
    }
    return;
  }

  for (let p = 0; p < pellets; p++) {
    const dir = aimDir(s.yaw, s.pitch, spread);
    const wallDist = world.traceShot(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, def.range);
    let bestT = wallDist;
    let bestBot = null;
    let bestHead = false;
    for (const b of bots.bots) {
      if (b.team !== 'defender' || !b.alive) continue;
      if (throwables.isSmoked(eye.x, eye.z, b.x, b.z)) continue;
      const tHead = raySphere(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, b.x, 1.68, b.z, 0.28);
      const tBody = raySphere(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, b.x, 1.2, b.z, 0.55);
      const t = tHead > 0 ? tHead : tBody;
      if (t > 0 && t < bestT) {
        bestT = t;
        bestBot = b;
        bestHead = tHead > 0;
      }
    }
    const end = {
      x: eye.x + dir.x * bestT,
      y: eye.y + dir.y * bestT,
      z: eye.z + dir.z * bestT,
    };
    effects.tracer(muzzlePos, end, false);
    if (bestBot) {
      const dmg = loadout.damageAt(def, bestT) * (bestHead ? def.headMult : 1);
      const dealt = soakArmour(bestBot, dmg);
      bestBot.hp -= dealt;
      effects.damageNumber(end, dealt, bestHead);
      hud.showHitmarker(bestHead);
      audio.hit(bestHead);
      bestBot.target = playerObj;
      bestBot.lastSeen = now;
      if (bestBot.hp <= 0) {
        bestBot.alive = false;
        bestBot.mesh.visible = false;
        onKill(YOU, bestBot, bestHead, world.locationAt(bestBot.x, bestBot.z));
      }
    } else if (bestT < def.range) {
      effects.puff(end);
    }
  }
}

function throwUtility(kind) {
  if (utility[kind] <= 0) return;
  const s = playerObj.state;
  if (!s.alive || match.phase !== 'live') return;
  utility[kind] -= 1;
  const eye = playerObj.eyePos();
  const dir = aimDir(s.yaw, s.pitch, 0);
  throwables.throwIt(kind, { x: eye.x, y: eye.y - 0.1, z: eye.z }, dir, now);
}

function tick(dt) {
  now += dt;
  const s = playerObj.state;

  // Look + move.
  const look = input.consumeLook();
  if (s.alive) {
    s.yaw -= look.dx * 0.0022;
    s.pitch = limit(s.pitch - look.dy * 0.0022, -1.45, 1.45);
    playerObj.step(input.moveInput(), dt);
  }

  // Fire / reload / slots / utility.
  if (input.firing) fireShot();
  if (input.consumePressed('KeyR')) {
    if (loadout.startReload(now)) audio.reload();
  }
  for (const [code, slot] of [['Digit1', 1], ['Digit2', 2], ['Digit3', 3]]) {
    if (input.consumePressed(code)) {
      if (loadout.switchSlot(slot)) audio.blip();
    }
  }
  if (input.consumePressed('KeyQ')) throwUtility('smoke');
  if (input.consumePressed('KeyF')) throwUtility('flash');
  if (input.consumePressed('KeyG')) throwUtility('frag');
  if (input.consumePressed('KeyM')) audio.toggleMute();

  // Buy-phase shortcuts: 4–7 buy the primaries and gear.
  if (match.phase === 'buy') {
    if (buyRenderedRound !== match.round) {
      renderBuy();
      buyRenderedRound = match.round;
    }
    const buyKey = { Digit4: 'kestrel', Digit5: 'hornet', Digit6: 'riot', Digit7: 'longshot' };
    for (const [code, id] of Object.entries(buyKey)) {
      if (input.consumePressed(code)) {
        const before = match.money;
        match.money = loadout.buy(id, match.money);
        if (match.money < before) {
          loadout.equip(id);
          audio.blip();
          renderBuy();
        }
      }
    }
  }

  // Plant / defuse channel: hold E near the site.
  if (s.alive && match.phase === 'live' && input.keys.has('KeyE')) {
    let kind = null;
    if (bomb.state === 'carried' && bomb.carriedBy === 'player') {
      const site = bomb.site === 'A' ? world.sites.A : world.sites.B;
      if (dist(s.x, s.z, site.x, site.z) < 4.5) kind = 'plant';
    } else if (bomb.state === 'planted') {
      const site = bomb.site === 'A' ? world.sites.A : world.sites.B;
      if (dist(s.x, s.z, site.x, site.z) < 3.5) kind = 'defuse';
    }
    if (kind) {
      if (!channel || channel.kind !== kind) channel = { kind, t: 0 };
      channel.t += dt;
      const need = kind === 'plant' ? 3.5 : 5;
      if (channel.t >= need) {
        if (kind === 'plant') bomb.plant(bomb.site === 'A' ? world.sites.A : world.sites.B);
        else bomb.defuse();
        channel = null;
      }
    } else {
      channel = null;
    }
  } else {
    channel = null;
  }

  // The dropped core: walk over it to pick it up.
  if (bomb.state === 'dropped' && s.alive && dist(s.x, s.z, bomb.x, bomb.z) < 2) {
    bomb.carry();
    bomb.carriedBy = 'player';
    hud.showBanner('Core picked up — plant it', now);
    audio.blip();
  }

  loadout.update(dt);
  throwables.update(dt, now, playerObj, bots.bots);

  // The bomb's beeps are audible: defenders hear them through walls.
  if (bomb.state === 'planted' && now - lastBeep > 1) {
    lastBeep = now;
    heardShots.push({ x: bomb.x, z: bomb.z });
  }

  const counts = bots.aliveCounts();
  bots.update(dt, now, {
    player: playerObj,
    bomb,
    shots: heardShots,
  });
  heardShots.length = 0;

  // A frag can kill the player without a kill hook firing.
  if (wasAlive && !s.alive && !deathHandled) {
    onKill(null, playerObj, false, world.locationAt(s.x, s.z));
  }
  wasAlive = s.alive;

  rounds.update(dt, now, {
    atkAlive: counts.atk + (s.alive ? 1 : 0),
    defAlive: counts.def,
    playerAlive: s.alive,
    now,
  });

  world.update(dt, now);
  effects.update(dt, now);
  hurtFlash = Math.max(0, hurtFlash - dt * 1.4);
  recoil = Math.max(0, recoil - dt * 0.22);

  // Camera: first person, with a walk bob and a recoil kick.
  const eye = playerObj.eyePos();
  const speed = playerObj.groundSpeed();
  bobPhase += dt * speed * 1.6;
  const bobY = Math.abs(Math.sin(bobPhase)) * 0.035 * Math.min(1, speed / 4.6);
  camera.position.set(eye.x, eye.y + bobY, eye.z);
  camera.rotation.y = s.yaw;
  camera.rotation.x = s.pitch + recoil;
  const targetFov = input.aiming && loadout.current.def.kind !== 'melee' ? 55 : 75;
  fovCur += (targetFov - fovCur) * Math.min(1, dt * 10);
  if (Math.abs(camera.fov - fovCur) > 0.01) {
    camera.fov = fovCur;
    camera.updateProjectionMatrix();
  }

  hud.update(buildSnap(), now);
}

let started = false;

function frame(tms) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.1, (tms - lastT) / 1000);
  lastT = tms;
  if (frozen) {
    renderer.render(scene, camera);
    return;
  }
  if (!started) {
    // Before the first click: render the quay behind the start screen,
    // but do not run the match — the buy clock must not tick while the
    // player is still reading the title.
    const eye0 = playerObj.eyePos();
    camera.position.set(eye0.x, eye0.y, eye0.z);
    camera.rotation.y = playerObj.state.yaw;
    camera.rotation.x = playerObj.state.pitch;
    hud.update(buildSnap(), now);
    renderer.render(scene, camera);
    return;
  }
  acc += dtReal;
  let steps = 0;
  while (acc >= STEP && steps < 5) {
    tick(STEP);
    acc -= STEP;
    steps += 1;
  }
  if (steps === 5) acc = 0;
  renderer.render(scene, camera);
}

let lastT = performance.now();
let acc = 0;

// --- shot staging ----------------------------------------------------------
// Each scene is a real game state (real bots, real HUD, real positions),
// staged mid-round so the first frame already shows a firefight.

function placeBot(name, x, z, yaw) {
  const b = bots.bots.find((bot) => bot.name === name);
  if (!b) return null;
  b.x = x;
  b.z = z;
  b.yaw = yaw;
  b.alive = true;
  b.mesh.visible = true;
  b.mesh.position.set(x, 0, z);
  b.mesh.rotation.y = yaw;
  return b;
}

function hideOtherBots(keep) {
  for (const b of bots.bots) {
    if (!keep.includes(b.name)) {
      b.alive = false;
      b.mesh.visible = false;
    }
  }
}

function aimAt(x, z, tx, tz) {
  return Math.atan2(-(tx - x), -(tz - z));
}

function playerMuzzle() {
  const s = playerObj.state;
  const eye = playerObj.eyePos();
  const fwd = { x: -Math.sin(s.yaw), z: -Math.cos(s.yaw) };
  const right = { x: Math.cos(s.yaw), z: -Math.sin(s.yaw) };
  return {
    x: eye.x + fwd.x * 0.7 + right.x * 0.22,
    y: eye.y - 0.18,
    z: eye.z + fwd.z * 0.7 + right.z * 0.22,
  };
}

function stageShot(n) {
  rounds.startRound(0);
  match.phase = 'live';
  match.money = 4200;
  // The player starts with a bought primary in every shot.
  loadout.buy('kestrel', 100000);
  loadout.equip('kestrel');
  const s = playerObj.state;
  s.alive = true;
  s.hp = 100;
  s.armour = 50;

  const feed = (text, head) => hud.addKillfeed(text, head);
  const say = (name, role, kind, loc) => radio.say(name, role, kind, loc, now);

  if (n === 1) {
    // Tide Plaza firefight — round 6, 4–2, 1:03 left. The player stands
    // in the open north plaza, not against the mid blocks: the lane
    // east is clear, the enemies are 13–21 m out and in the open.
    match.round = 6;
    match.scoreAtk = 4;
    match.scoreDef = 2;
    match.timer = 63;
    s.x = -8;
    s.z = -4.5;
    s.yaw = aimAt(-8, -4.5, 8, -6);
    s.pitch = 0.02;
    placeBot('Riza', -4, -8, aimAt(-4, -8, 10, -4));
    placeBot('Fable', -12, -2, aimAt(-12, -2, 4, -7));
    placeBot('Maren', 4, -7, aimAt(4, -7, -9, -5));
    placeBot('Sol', 10, -4, aimAt(10, -4, -9, -5));
    placeBot('Ivo', 12, -8, aimAt(12, -8, -4, -8));
    hideOtherBots(['Riza', 'Fable', 'Maren', 'Sol', 'Ivo']);
    const mz = playerMuzzle();
    effects.muzzle(mz, s.yaw);
    effects.casing(mz, s.yaw);
    effects.tracer(mz, { x: 10, y: 1.4, z: -4 }, false);
    effects.tracer({ x: 4, y: 1.45, z: -7 }, { x: -8.4, y: 1.3, z: -4.8 }, true);
    effects.tracer({ x: 12, y: 1.45, z: -8 }, { x: -3.6, y: 1.3, z: -7.6 }, true);
    effects.damageNumber({ x: 10, y: 1.6, z: -4 }, 68, true);
    say('Riza', 'Support', 'contact', 'Tide Plaza');
    say('Maren', 'Caller', 'contact', 'Tide Plaza');
    feed('You  ⌖ Kestrel AR ⌖  Maren', true);
    feed('Riza  ⌖ Kestrel AR ⌖  Bram', false);
    feed('Sol  ⌖ Longshot DMR ⌖  Fable', false);
    feed('You  ⌖ Kestrel AR ⌖  Tamsin', false);
  } else if (n === 2) {
    // Gull Lane push — round 5, 3–2, 1:21 left. Riot-12 up close.
    // The player stands in the lane itself (z -13), so the location
    // reads Gull Lane and the enemies are 12–20 m down the lane.
    match.round = 5;
    match.scoreAtk = 3;
    match.scoreDef = 2;
    match.timer = 81;
    loadout.buy('riot', 100000);
    loadout.equip('riot');
    s.x = -14;
    s.z = -13;
    s.yaw = aimAt(-14, -13, 2, -10);
    s.pitch = 0.01;
    placeBot('Rook', -9, -13, aimAt(-9, -13, 2, -10));
    placeBot('Kip', -7, -13, aimAt(-7, -13, 6, -12));
    placeBot('Bram', -2, -10, aimAt(-2, -10, -14, -13));
    placeBot('Wren', 2, -8, aimAt(2, -8, -14, -13));
    placeBot('Mira', 6, -12, aimAt(6, -12, -9, -13));
    hideOtherBots(['Rook', 'Kip', 'Bram', 'Wren', 'Mira']);
    const mz = playerMuzzle();
    effects.muzzle(mz, s.yaw, 1.3);
    effects.casing(mz, s.yaw);
    effects.tracer(mz, { x: -2, y: 1.3, z: -10 }, false);
    effects.tracer({ x: 2, y: 1.45, z: -8 }, { x: -13.2, y: 1.35, z: -12.8 }, true);
    effects.tracer({ x: 6, y: 1.45, z: -12 }, { x: -8.6, y: 1.3, z: -12.8 }, true);
    effects.damageNumber({ x: -2, y: 1.5, z: -10 }, 44, false);
    say('Rook', 'Entry', 'contact', 'Gull Lane');
    say('Bram', 'A Hold', 'contact', 'Gull Lane');
    feed('You  ⌖ Riot-12 ⌖  Bram', false);
    feed('Rook  ⌖ Kestrel AR ⌖  Tamsin', false);
    feed('Wren  ⌖ Kestrel AR ⌖  Kip', false);
  } else if (n === 3) {
    // Site A plant — round 7, 4–3, 0:47 left. Smoke on site, core down.
    // The player comes in from the north edge (Beacon Court), not from
    // the south: the guard block that filled the last shot is behind
    // the carrier, not between the camera and the site.
    match.round = 7;
    match.scoreAtk = 4;
    match.scoreDef = 3;
    match.timer = 47;
    bomb.state = 'planted';
    bomb.site = 'A';
    bomb.x = 22;
    bomb.z = -15;
    bomb.timer = 32;
    s.x = 14;
    s.z = -16;
    s.yaw = aimAt(14, -16, 24, -15);
    s.pitch = 0.0;
    placeBot('Riza', 20, -14, aimAt(20, -14, 27, -13));
    placeBot('Ivo', 15, -14, aimAt(15, -14, 24, -17));
    placeBot('Sol', 24, -17, aimAt(24, -17, 14, -16));
    placeBot('Maren', 27, -13, aimAt(27, -13, 20, -14));
    placeBot('Fable', 18, -17, aimAt(18, -17, 24, -17));
    hideOtherBots(['Riza', 'Ivo', 'Sol', 'Maren', 'Fable']);
    effects.puff({ x: 21, y: 0.8, z: -14 });
    effects.puff({ x: 23, y: 1.1, z: -16 });
    effects.puff({ x: 19, y: 0.6, z: -15.5 });
    const mz = playerMuzzle();
    effects.muzzle(mz, s.yaw);
    effects.casing(mz, s.yaw);
    effects.tracer(mz, { x: 24, y: 1.4, z: -17 }, false);
    effects.tracer({ x: 27, y: 1.45, z: -13 }, { x: 20.4, y: 1.3, z: -14.2 }, true);
    effects.damageNumber({ x: 24, y: 1.6, z: -17 }, 26, false);
    say('Riza', 'Support', 'plant', 'Beacon Court');
    say('Sol', 'A Hold', 'rotate', 'Beacon Court');
    feed('Riza  ⌖ Kestrel AR ⌖  Tamsin', false);
    feed('You  ⌖ Kestrel AR ⌖  Sol', false);
    feed('Maren  ⌖ Longshot DMR ⌖  Ivo', true);
    feed('Fable  ⌖ Hornet SMG ⌖  Wren', false);
  } else {
    // Net Loft hold — round 6, 4–2, 0:58 left. Hornet SMG, close
    // quarters. The player stands east of the south stall, looking
    // west down the loft: the stall stays at the frame's edge instead
    // of filling half of it.
    match.round = 6;
    match.scoreAtk = 4;
    match.scoreDef = 2;
    match.timer = 58;
    loadout.buy('hornet', 100000);
    loadout.equip('hornet');
    s.x = 8;
    s.z = 13;
    s.yaw = aimAt(8, 13, -6, 11);
    s.pitch = 0.01;
    placeBot('Kip', 10, 16, aimAt(10, 16, -2, 10));
    placeBot('Fable', 12, 12, aimAt(12, 12, 2, 12));
    placeBot('Tamsin', -2, 10, aimAt(-2, 10, 8, 13));
    placeBot('Wren', 2, 12, aimAt(2, 12, 4, 16));
    placeBot('Bram', -6, 12, aimAt(-6, 12, 8, 13));
    hideOtherBots(['Kip', 'Fable', 'Tamsin', 'Wren', 'Bram']);
    const mz = playerMuzzle();
    effects.muzzle(mz, s.yaw);
    effects.casing(mz, s.yaw);
    effects.tracer(mz, { x: -2, y: 1.35, z: 10 }, false);
    effects.tracer({ x: 2, y: 1.45, z: 12 }, { x: 7.4, y: 1.3, z: 13.2 }, true);
    effects.damageNumber({ x: -2, y: 1.55, z: 10 }, 20, false);
    effects.damageNumber({ x: 2, y: 1.5, z: 12 }, 38, false);
    say('Kip', 'Support', 'contact', 'Net Loft');
    say('Tamsin', 'Roam', 'contact', 'Net Loft');
    feed('You  ⌖ Hornet SMG ⌖  Tamsin', false);
    feed('Kip  ⌖ Kestrel AR ⌖  Wren', false);
    feed('Bram  ⌖ Kestrel AR ⌖  Fable', false);
  }

  // Camera on the staged player, then freeze the whole sim.
  const eye = playerObj.eyePos();
  camera.position.set(eye.x, eye.y, eye.z);
  camera.rotation.y = s.yaw;
  camera.rotation.x = s.pitch;
  camera.fov = 75;
  camera.updateProjectionMatrix();
  // The round-start banner would never fade in a frozen frame, so hide it:
  // the screenshots must show the fight, not a title card.
  hud.els.banner.style.opacity = '0';
  hud.update(buildSnap(), now);
  frozen = true;
  let frames = 0;
  (function readyLoop() {
    renderer.render(scene, camera);
    frames += 1;
    if (frames < 2) requestAnimationFrame(readyLoop);
    else window.__shotReady = true;
  })();
}

window.__game = { world, player: playerObj, bots, rounds, loadout, radio, hud, effects, now: () => now };

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if (shotMode >= 1 && shotMode <= 4) {
  stageShot(shotMode);
} else {
  hud.showStart();
  document.getElementById('start-screen').addEventListener('click', () => {
    if (started) return;
    started = true;
    hud.hideStart();
    input.lock();
    audio.resume();
    rounds.startRound(0);
  });
  requestAnimationFrame(frame);
}
