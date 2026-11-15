// Ember Quay — throwables. Three kinds, all ballistic: a frag that hurts,
// a smoke that blinds sight, a flash that blinds eyes. Smoke is a volume
// the bots' sight check asks about; a flash blinds by distance, line of
// sight and whether the victim was looking at it.

import { limit, dist, distSq } from './util.js';

const GRAVITY = 9.5;

export function createThrowables(world, hooks) {
  const flying = []; // {kind, x,y,z, vx,vy,vz, at}
  const smokes = []; // {x, z, r, until}

  function throwIt(kind, from, dir, now) {
    flying.push({
      kind,
      x: from.x, y: from.y, z: from.z,
      vx: dir.x * 13, vy: dir.y * 13 + 2.4, vz: dir.z * 13,
      at: now,
    });
    hooks.throwSound(kind);
  }

  function isSmoked(ax, az, bx, bz) {
    for (const s of smokes) {
      // Segment vs circle: does the sight line pass through the smoke?
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz;
      let t = len2 > 0 ? ((s.x - ax) * dx + (s.z - az) * dz) / len2 : 0;
      t = limit(t, 0, 1);
      const cx = ax + dx * t;
      const cz = az + dz * t;
      if (distSq(cx, cz, s.x, s.z) < s.r * s.r) return true;
    }
    return false;
  }

  function detonate(f, now, player, botsList) {
    if (f.kind === 'frag') {
      hooks.boom(f.x, f.y, f.z);
      const hurt = (e, ex, ez) => {
        const d = dist(ex, ez, f.x, f.z);
        if (d > 6.5) return;
        const dmg = Math.round(95 * (1 - d / 7.5));
        if (e === player) {
          player.damage(Math.max(8, dmg), false);
        } else {
          e.hp -= Math.max(8, dmg);
          if (e.hp <= 0 && e.alive) {
            e.alive = false;
            e.mesh.visible = false;
            hooks.kill(null, e, false, world.locationAt(e.x, e.z));
          }
        }
      };
      if (player.state.alive) hurt(player, player.state.x, player.state.z);
      for (const b of botsList) if (b.alive) hurt(b, b.x, b.z);
    } else if (f.kind === 'smoke') {
      smokes.push({ x: f.x, z: f.z, r: 4.2, until: now + 13 });
      hooks.smokePuff(f.x, f.y, f.z);
    } else if (f.kind === 'flash') {
      hooks.flashPop(f.x, f.y, f.z);
      const blind = (ex, ez, viewYaw) => {
        const d = dist(ex, ez, f.x, f.z);
        if (d > 26) return 0;
        if (!world.hasSight(ex, ez, f.x, f.z)) return 0;
        // Facing the pop matters most: dot of view dir vs direction to pop.
        const dx = f.x - ex;
        const dz = f.z - ez;
        const len = Math.hypot(dx, dz) || 1;
        const vx = -Math.sin(viewYaw);
        const vz = -Math.cos(viewYaw);
        const facing = (dx / len) * vx + (dz / len) * vz;
        const base = limit(1 - d / 26, 0.15, 1);
        return facing > 0.2 ? base : base * 0.35;
      };
      if (player.state.alive) {
        const p = player.state;
        const amount = blind(p.x, p.z, p.yaw);
        if (amount > 0) player.state.flash = Math.max(player.state.flash, amount);
      }
      for (const b of botsList) {
        if (!b.alive) continue;
        const amount = blind(b.x, b.z, b.yaw);
        if (amount > 0.4) {
          b.flashUntil = now + amount * 2.2;
          b.target = null;
        }
      }
    }
  }

  function update(dt, now, player, botsList) {
    for (let i = flying.length - 1; i >= 0; i--) {
      const f = flying[i];
      f.vy -= GRAVITY * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      if (f.y <= 0.12) {
        f.y = 0.12;
        f.vy = -f.vy * 0.3;
        f.vx *= 0.6;
        f.vz *= 0.6;
        if (Math.abs(f.vy) < 0.8 || now - f.at > 2.2) {
          flying.splice(i, 1);
          detonate(f, now, player, botsList);
        }
      }
    }
    for (let i = smokes.length - 1; i >= 0; i--) {
      if (now > smokes[i].until) smokes.splice(i, 1);
    }
  }

  return { throwIt, update, isSmoked, smokes, flying };
}
