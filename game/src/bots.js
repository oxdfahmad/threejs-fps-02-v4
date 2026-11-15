// Ember Quay — the bots. Five named bots per side, each with a role from
// its team's plan: attackers walk routes to a site, defenders hold angles
// and rotate on sound. A bot perceives (sight + hearing), routes along the
// waypoint graph, holds, engages, flanks on the plant, and talks on the
// radio when it sees, hears or loses something.
//
// The core rides with the Entry. If the carrier falls, the nearest living
// attacker picks it up; at a site the carrier channels the plant, and a
// defender at a planted site channels the defuse.
//
// v4: every bot wears a floating name tag (name + role, team-coloured), the
// way the top entries' screenshots do — a firefight reads at a glance when
// you can see who is shooting whom. The core carrier also shows a gold
// marker on their back.

import * as THREE from 'three';
import { ATTACKERS, DEFENDERS } from './radio.js';
import { soakArmour, limit, dist, distSq, turnTo, wrapAngle, pickOne, roll } from './util.js';

const ROLE_GUN = {
  Entry: { damage: 24, interval: 0.55, spread: 0.05, burst: 3 },
  Lurk: { damage: 20, interval: 0.6, spread: 0.055, burst: 3 },
  Support: { damage: 22, interval: 0.6, spread: 0.05, burst: 3 },
  Sniper: { damage: 46, interval: 1.7, spread: 0.012, burst: 1 },
  Caller: { damage: 24, interval: 0.55, spread: 0.05, burst: 3 },
  'A Hold': { damage: 24, interval: 0.55, spread: 0.045, burst: 3 },
  'B Hold': { damage: 24, interval: 0.55, spread: 0.045, burst: 3 },
  Mid: { damage: 22, interval: 0.6, spread: 0.05, burst: 3 },
  Roam: { damage: 20, interval: 0.6, spread: 0.055, burst: 3 },
};

const ROLE_SPEED = { Entry: 4.3, Lurk: 4.0, Support: 3.8, Sniper: 3.4, Caller: 4.0, 'A Hold': 3.6, 'B Hold': 3.6, Mid: 3.9, Roam: 4.1 };

// Where each defender role waits, as waypoint nodes (see world.js).
const DEFEND_POSTS = { 'A Hold': 12, 'B Hold': 13, Mid: 8, Roam: 16, Sniper: 10 };
const DEFEND_PATROLS = { Roam: [16, 8, 9, 12, 13], Mid: [8, 9, 6, 7] };

function makeTag(name, role, team) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 72;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(12, 14, 20, 0.72)';
  g.beginPath();
  g.roundRect(6, 6, 244, 60, 10);
  g.fill();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 30px system-ui, sans-serif';
  g.fillStyle = team === 'attacker' ? '#ffb08a' : '#9cc4ff';
  g.fillText(name, 128, 26);
  g.font = '20px system-ui, sans-serif';
  g.fillStyle = '#cfc8b8';
  g.fillText(role, 128, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  spr.scale.set(1.7, 0.48, 1);
  return spr;
}

export function createBots(scene, world, radio, rng, hooks) {
  const bots = [];
  const geoms = {
    body: new THREE.BoxGeometry(0.62, 0.85, 0.34),
    head: new THREE.BoxGeometry(0.34, 0.32, 0.32),
    gun: new THREE.BoxGeometry(0.09, 0.12, 0.85),
    gunLong: new THREE.BoxGeometry(0.07, 0.1, 1.25),
    legs: new THREE.BoxGeometry(0.5, 0.6, 0.3),
    bombBox: new THREE.BoxGeometry(0.3, 0.22, 0.16),
  };
  const mats = {
    atkBody: new THREE.MeshStandardMaterial({ color: 0xc05a2e, roughness: 0.85 }),
    defBody: new THREE.MeshStandardMaterial({ color: 0x3a5a8a, roughness: 0.85 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xd9a986, roughness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.6, metalness: 0.3 }),
    bomb: new THREE.MeshStandardMaterial({ color: 0xffd24d, roughness: 0.5, emissive: 0xaa7700, emissiveIntensity: 0.6 }),
  };

  function buildMesh(team, isSniper, name, role) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(geoms.body, team === 'attacker' ? mats.atkBody : mats.defBody);
    body.position.y = 1.05;
    const head = new THREE.Mesh(geoms.head, mats.skin);
    head.position.y = 1.68;
    const legs = new THREE.Mesh(geoms.legs, mats.dark);
    legs.position.y = 0.32;
    const gun = new THREE.Mesh(isSniper ? geoms.gunLong : geoms.gun, mats.dark);
    gun.position.set(0.26, 1.2, 0.42);
    const bombBox = new THREE.Mesh(geoms.bombBox, mats.bomb);
    bombBox.position.set(0, 1.35, -0.26);
    bombBox.visible = false;
    const tag = makeTag(name, role, team);
    tag.position.y = 2.12;
    group.add(body, head, legs, gun, bombBox, tag);
    return { group, gun, bombBox, tag };
  }

  function spawn(team, spawnPoint, role, name) {
    const isSniper = role === 'Sniper';
    const parts = buildMesh(team, isSniper, name, role);
    parts.group.position.set(spawnPoint.x, 0, spawnPoint.z);
    scene.add(parts.group);
    const bot = {
      name, role, team,
      x: spawnPoint.x, z: spawnPoint.z, yaw: spawnPoint.angle,
      hp: 100, armour: team === 'defender' ? 25 : 0, alive: true,
      state: 'ROUTE', route: [], routeIndex: 0, holdNode: -1, patrol: null, patrolIndex: 0,
      target: null, lastSeen: -10, shootAt: 0,
      scanT: rng() * 2, perceiveT: rng() * 0.15,
      speed: ROLE_SPEED[role] ?? 3.8,
      gun: ROLE_GUN[role],
      hasBomb: false, channel: 0, channelKind: null,
      retakeSite: null, // which planted site this bot is converging on
      heardAt: -10, heardX: 0, heardZ: 0,
      mesh: parts.group, gunMesh: parts.gun, bombBox: parts.bombBox, tag: parts.tag,
      walkPhase: rng() * 6,
    };
    bots.push(bot);
    return bot;
  }

  function spawnRound(attackSite) {
    for (const b of bots) scene.remove(b.mesh);
    bots.length = 0;
    const atkSpawns = world.spawns.attacker;
    const defSpawns = world.spawns.defender;
    ATTACKERS.forEach((r, i) => {
      const bot = spawn('attacker', atkSpawns[i % atkSpawns.length], r.role, r.name);
      bot.hasBomb = r.role === 'Entry';
    });
    DEFENDERS.forEach((r, i) => {
      const bot = spawn('defender', defSpawns[i % defSpawns.length], r.role, r.name);
      bot.holdNode = DEFEND_POSTS[r.role];
      bot.patrol = DEFEND_PATROLS[r.role] ?? null;
      bot.state = 'ROUTE';
      bot.route = world.findPath(world.nearestNode(bot.x, bot.z), bot.holdNode);
      bot.routeIndex = 0;
    });
    // Attackers walk to the called site; the Lurk takes the flank lane
    // first, then rotates between the flank and the site.
    const siteNode = attackSite === 'A' ? 12 : 13;
    for (const bot of bots) {
      if (bot.team !== 'attacker') continue;
      bot.siteNode = siteNode;
      const dest = bot.role === 'Lurk' ? (attackSite === 'A' ? 17 : 18) : siteNode;
      bot.route = world.findPath(world.nearestNode(bot.x, bot.z), dest);
      bot.routeIndex = 0;
      bot.state = 'ROUTE';
    }
  }

  function locationOf(bot) {
    return world.locationAt(bot.x, bot.z);
  }

  function say(bot, kind, now) {
    radio.say(bot.name, bot.role, kind, locationOf(bot), now);
  }

  function enemiesOf(bot, player) {
    const list = [];
    for (const other of bots) {
      if (other.team !== bot.team && other.alive) list.push(other);
    }
    // The player is the sixth attacker: only the Night Watch sees them
    // as an enemy. Their own team never shoots at them.
    if (player.state.alive && bot.team === 'defender') list.push(player);
    return list;
  }

  function isPlayer(e) {
    // Bots carry their AI state as a string ('ROUTE' / 'HOLD' /
    // 'ENGAGE'), so `e.state !== undefined` is true for every bot too
    // and every bot enemy used to read as a player with a NaN position.
    // The player is the only entity with a damage() method.
    return typeof e.damage === 'function';
  }

  function enemyPos(e) {
    return isPlayer(e) ? { x: e.state.x, z: e.state.z, y: 1.4 } : { x: e.x, z: e.z, y: 1.4 };
  }

  // Sight range: 28 m, so a bot cannot snipe across the whole 64 m map
  // from its post — the enemy has to close to the site before contact.
  // The quay's mid blocks break the lanes anyway, so most fights open
  // at 10–20 m, the way the top screenshots show them.
  const SIGHT_RANGE = 28;
  function perceive(bot, now, player, dt) {
    // Stagger perception so all bots never think on the same step.
    bot.perceiveT -= dt;
    if (bot.perceiveT > 0) return;
    bot.perceiveT = 0.15;
    let best = null;
    let bestD = Infinity;
    for (const e of enemiesOf(bot, player)) {
      const p = enemyPos(e);
      const d = dist(bot.x, bot.z, p.x, p.z);
      if (d > SIGHT_RANGE) continue;
      const ang = Math.atan2(-(p.x - bot.x), -(p.z - bot.z));
      const diff = Math.abs(turnTo(bot.yaw, ang));
      if (d > 6 && diff > 1.35) continue; // outside the view cone
      if (!world.hasSight(bot.x, bot.z, p.x, p.z)) continue;
      if (hooks.isSmoked && hooks.isSmoked(bot.x, bot.z, p.x, p.z)) continue;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (best) {
      if (!bot.target) say(bot, 'contact', now);
      bot.target = best;
      bot.lastSeen = now;
    } else if (bot.target && now - bot.lastSeen > 1.6) {
      bot.target = null;
    }
  }

  function hear(bot, x, z, now) {
    const d = dist(bot.x, bot.z, x, z);
    if (d > 30 || !bot.alive) return;
    bot.heardAt = now;
    bot.heardX = x;
    bot.heardZ = z;
    if (now - (bot.lastHeardSay ?? -100) > 9) {
      bot.lastHeardSay = now;
      say(bot, 'heard', now);
    }
  }

  function shootAt(bot, target, now, dt) {
    const p = enemyPos(target);
    const d = dist(bot.x, bot.z, p.x, p.z);
    const aimYaw = Math.atan2(-(p.x - bot.x), -(p.z - bot.z));
    bot.yaw += turnTo(bot.yaw, aimYaw) * Math.min(1, dt * 10);
    if (now < bot.shootAt) return;
    bot.shootAt = now + bot.gun.interval;
    const moving = isPlayer(target) ? target.groundSpeed() > 1.5 : true;
    const crouched = isPlayer(target) ? target.state.crouched : false;
    let hitP = 0.62 - d * 0.011 - (moving ? 0.12 : 0) + (crouched ? 0.05 : 0);
    hitP = limit(hitP, 0.08, 0.75);
    const from = { x: bot.x, y: 1.45, z: bot.z };
    hooks.tracer(from, { x: p.x, y: p.y, z: p.z }, bot.team === 'defender');
    hooks.muzzle(from, bot.yaw);
    hooks.shotSound(d, bot.gun.damage > 40 ? 'marksman' : 'rifle');
    if (!roll(rng, hitP)) return;
    const head = roll(rng, 0.12);
    const dmg = bot.gun.damage * (head ? 3.2 : 1);
    if (isPlayer(target)) {
      const lost = target.damage(dmg, head);
      hooks.playerHit(lost, head, bot);
    } else {
      const dealt = soakArmour(target, dmg);
      target.hp -= dealt;
      hooks.botHit(target, dealt, head);
      if (target.hp <= 0 && target.alive) {
        target.alive = false;
        target.mesh.visible = false;
        hooks.kill(bot, target, head, locationOf(target));
        say(bot, 'kill', now);
      }
    }
  }

  function moveToward(bot, tx, tz, dt) {
    const dx = tx - bot.x;
    const dz = tz - bot.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.25) return true;
    const want = Math.atan2(-dx, -dz);
    bot.yaw += turnTo(bot.yaw, want) * Math.min(1, dt * 6);
    const stepLen = bot.speed * dt;
    const p = { x: bot.x + (dx / d) * stepLen, z: bot.z + (dz / d) * stepLen };
    world.moveCircle(p, 0.42);
    bot.x = p.x;
    bot.z = p.z;
    bot.walkPhase += dt * 9;
    return false;
  }

  function update(dt, now, ctx) {
    const { player, bomb } = ctx;
    for (const bot of bots) {
      if (!bot.alive) continue;
      // A flashed bot stands confused: no sight, no shots, no orders.
      if (now < (bot.flashUntil ?? 0)) {
        bot.target = null;
        bot.mesh.position.set(bot.x, 0, bot.z);
        bot.mesh.rotation.y = bot.yaw;
        continue;
      }
      // A dead player is not a target any more.
      if (bot.target && isPlayer(bot.target) && !player.state.alive) bot.target = null;
      perceive(bot, now, player, dt);
      // Hearing: the player's recent shots and the bomb's beeps.
      for (const s of ctx.shots) hear(bot, s.x, s.z, now);
      bot.mesh.position.set(bot.x, 0, bot.z);
      bot.mesh.rotation.y = bot.yaw;
      bot.mesh.position.y = Math.abs(Math.sin(bot.walkPhase)) * 0.04;
      bot.bombBox.visible = bot.hasBomb;

      // The objective comes first: a carrier at the site plants even
      // while a defender is in sight (teammates cover), and a defender
      // at a planted site defuses under fire. If this check ran after
      // the ENGAGE branch, the carrier would fight instead of planting
      // whenever anyone was visible — and once the last defender died
      // the round ended, so the plant window never existed at all.
      if (bot.hasBomb && bomb.state === 'carried') {
        const site = bomb.site === 'A' ? world.sites.A : world.sites.B;
        if (dist(bot.x, bot.z, site.x, site.z) < 4.5) {
          bot.channelKind = 'plant';
          bot.channel += dt;
          say(bot, 'plant', now);
          if (bot.channel >= 3.5) {
            bomb.plant(site);
            bot.hasBomb = false;
            bot.channel = 0;
            bot.channelKind = null;
          }
          continue;
        }
      }
      if (bot.team === 'defender' && bomb.state === 'planted') {
        const site = bomb.site === 'A' ? world.sites.A : world.sites.B;
        if (dist(bot.x, bot.z, site.x, site.z) < 3.5) {
          bot.channelKind = 'defuse';
          bot.channel += dt;
          say(bot, 'defuse', now);
          if (bot.channel >= 5) {
            bomb.defuse();
            bot.channel = 0;
            bot.channelKind = null;
          }
          continue;
        }
      }

      if (bot.target) {
        bot.state = 'ENGAGE';
        // Attackers close the distance while they fight. Standing
        // still at max sight range turns a round into a 25 m staring
        // contest: the carrier never reaches the site, the defenders
        // die at their posts, and the round ends by elimination with
        // the core unplanted. Defenders hold their angle instead —
        // that is their job.
        if (bot.team === 'attacker') {
          const tp = enemyPos(bot.target);
          if (dist(bot.x, bot.z, tp.x, tp.z) > 12) moveToward(bot, tp.x, tp.z, dt);
        }
        shootAt(bot, bot.target, now, dt);
        continue;
      }

      // The target is gone (dead, lost, or the player died): fall back
      // to the route or the post instead of standing frozen in ENGAGE.
      if (bot.state === 'ENGAGE') {
        bot.state = bot.routeIndex < bot.route.length ? 'ROUTE' : 'HOLD';
      }

      // Retake: once the core is planted, living defenders converge on
      // the planted site instead of holding their posts. One re-plot
      // per plant (retakeSite), so the radio call does not spam.
      if (bot.team === 'defender' && bomb.state === 'planted' && !bot.target) {
        const siteNode = bomb.site === 'A' ? 12 : 13;
        const dest = world.nodes[siteNode];
        if (dist(bot.x, bot.z, dest.x, dest.z) > 4 && bot.retakeSite !== bomb.site) {
          bot.retakeSite = bomb.site;
          bot.state = 'ROUTE';
          bot.route = world.findPath(world.nearestNode(bot.x, bot.z), siteNode);
          bot.routeIndex = 0;
          say(bot, 'rotate', now);
        }
      }

      // The player carries the core: attackers escort them instead of
      // walking their own route, re-plotting toward the player as they move.
      if (bot.team === 'attacker' && bomb.carriedBy === 'player') {
        bot.followT = (bot.followT ?? 0) - dt;
        if (bot.followT <= 0) {
          bot.followT = 1.1 + (bots.indexOf(bot) % 5) * 0.12;
          bot.state = 'ROUTE';
          bot.route = world.findPath(world.nearestNode(bot.x, bot.z), world.nearestNode(player.state.x, player.state.z));
          bot.routeIndex = 0;
        }
      }

      if (bot.state === 'ROUTE') {
        if (bot.routeIndex < bot.route.length) {
          const node = world.nodes[bot.route[bot.routeIndex]];
          if (moveToward(bot, node.x, node.z, dt)) bot.routeIndex += 1;
        } else {
          bot.state = 'HOLD';
          bot.scanT = 0;
          if (bot.team === 'attacker' && bot.role === 'Lurk') {
            // The Lurk keeps moving: rotate between the flank lane and
            // the site instead of camping the flank node all round.
            bot.patrol = bot.patrol ?? [bot.route[bot.route.length - 1] ?? 0, bot.siteNode];
          }
        }
      } else if (bot.state === 'HOLD') {
        // Watch the lane: slow scan, and rotate toward recent sound.
        bot.scanT += dt;
        if (now - bot.heardAt < 2) {
          const want = Math.atan2(-(bot.heardX - bot.x), -(bot.heardZ - bot.z));
          bot.yaw += turnTo(bot.yaw, want) * Math.min(1, dt * 5);
        } else {
          bot.yaw += Math.sin(bot.scanT * 0.5) * dt * 0.5;
        }
        if (bot.patrol && bomb.state !== 'planted') {
          // No patrolling mid-retake: hold the planted site.
          bot.state = 'ROUTE';
          const next = bot.patrol[bot.patrolIndex % bot.patrol.length];
          bot.patrolIndex += 1;
          bot.route = world.findPath(world.nearestNode(bot.x, bot.z), next);
          bot.routeIndex = 0;
        }
      }
    }
    // The bomb drops with its carrier and is picked up by the nearest
    // living attacker standing close to it.
    if (bomb.state === 'dropped') {
      let best = null;
      let bestD = 3.5;
      for (const bot of bots) {
        if (bot.team === 'attacker' && bot.alive) {
          const d = dist(bot.x, bot.z, bomb.x, bomb.z);
          if (d < bestD) {
            bestD = d;
            best = bot;
          }
        }
      }
      if (best) {
        best.hasBomb = true;
        bomb.carry();
        bomb.carriedBy = best.name;
        say(best, 'pickup', now);
      }
    }
  }

  function aliveCounts() {
    let atk = 0;
    let def = 0;
    for (const b of bots) {
      if (!b.alive) continue;
      if (b.team === 'attacker') atk += 1;
      else def += 1;
    }
    return { atk, def };
  }

  function carrier() {
    return bots.find((b) => b.hasBomb && b.alive) ?? null;
  }

  return { bots, spawnRound, update, hear, aliveCounts, carrier };
}
