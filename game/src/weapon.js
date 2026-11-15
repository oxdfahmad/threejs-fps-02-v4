// Ember Quay — the armoury. Six slots: four primaries, a sidearm and a
// blade. Every gun has a price, a role and a weakness; spread grows with
// movement and bloom, shrinks when crouched or aiming, so stopping to aim
// pays. Headshots multiply damage; damage falls off gently with range.

import { limit } from './util.js';

export const WEAPONS = [
  {
    id: 'kestrel', slot: 1, name: 'Kestrel AR', kind: 'rifle', price: 2700,
    damage: 26, headMult: 3.4, rpm: 600, mag: 25, reserve: 75,
    reloadTime: 2.2, spreadBase: 0.011, spreadMove: 0.011, spreadAir: 0.03,
    bloom: 0.0035, auto: true, zoom: 1.25, pellets: 1, range: 60,
  },
  {
    id: 'hornet', slot: 1, name: 'Hornet SMG', kind: 'smg', price: 1700,
    damage: 19, headMult: 3.0, rpm: 820, mag: 28, reserve: 84,
    reloadTime: 1.9, spreadBase: 0.016, spreadMove: 0.016, spreadAir: 0.035,
    bloom: 0.004, auto: true, zoom: 1.15, pellets: 1, range: 34,
  },
  {
    id: 'riot', slot: 1, name: 'Riot-12', kind: 'shotgun', price: 1500,
    damage: 9, headMult: 2.2, rpm: 72, mag: 6, reserve: 18,
    reloadTime: 2.6, spreadBase: 0.05, spreadMove: 0.02, spreadAir: 0.05,
    bloom: 0.01, auto: false, zoom: 1.0, pellets: 8, range: 18,
  },
  {
    id: 'longshot', slot: 1, name: 'Longshot DMR', kind: 'marksman', price: 4750,
    damage: 52, headMult: 3.8, rpm: 95, mag: 5, reserve: 15,
    reloadTime: 2.8, spreadBase: 0.004, spreadMove: 0.02, spreadAir: 0.05,
    bloom: 0.02, auto: false, zoom: 2.2, pellets: 1, range: 90,
  },
  {
    id: 'lark', slot: 2, name: 'Lark P-9', kind: 'pistol', price: 300,
    damage: 22, headMult: 3.2, rpm: 320, mag: 12, reserve: 36,
    reloadTime: 1.5, spreadBase: 0.014, spreadMove: 0.012, spreadAir: 0.03,
    bloom: 0.004, auto: false, zoom: 1.1, pellets: 1, range: 30,
  },
  {
    id: 'shiv', slot: 3, name: 'Shiv', kind: 'melee', price: 0,
    damage: 40, headMult: 1.0, rpm: 90, mag: Infinity, reserve: Infinity,
    reloadTime: 0, spreadBase: 0, spreadMove: 0, spreadAir: 0,
    bloom: 0, auto: false, zoom: 1.0, pellets: 1, range: 2.1,
  },
];

export function weaponById(id) {
  return WEAPONS.find((w) => w.id === id);
}

// Owned set: the player always carries the Lark and the Shiv; primaries are
// bought in the buy menu. current is the equipped weapon object.
export function createLoadout() {
  const owned = {
    lark: { def: weaponById('lark'), mag: 12, reserve: 36 },
    shiv: { def: weaponById('shiv'), mag: Infinity, reserve: Infinity },
  };
  let current = owned.lark;
  let reloading = 0; // seconds left, 0 = not reloading
  let bloom = 0; // accumulated spread from recent shots
  let lastShot = -10;

  function buy(id, money) {
    const def = weaponById(id);
    if (!def || owned[id] || money < def.price) return money;
    owned[id] = { def, mag: def.mag, reserve: def.reserve };
    return money - def.price;
  }

  function equip(id) {
    if (!owned[id]) return false;
    if (current.def.id === id) return true;
    current = owned[id];
    reloading = 0;
    bloom = 0;
    return true;
  }

  function switchSlot(slot) {
    // Slot 1 = the bought primary (or the Lark when none), 2 = pistol, 3 = knife.
    if (slot === 1) {
      const primary = Object.values(owned).find((o) => o.def.slot === 1);
      if (primary) return equip(primary.def.id);
      return equip('lark');
    }
    if (slot === 2) return equip('lark');
    if (slot === 3) return equip('shiv');
    return false;
  }

  function spread(now, moveSpeed, airborne, crouched, aiming) {
    const def = current.def;
    let s = def.spreadBase + def.spreadMove * (moveSpeed / 4.6) + bloom;
    if (airborne) s += def.spreadAir;
    if (crouched) s *= 0.7;
    if (aiming) s *= def.kind === 'marksman' ? 0.3 : 0.55;
    return s;
  }

  function canFire(now) {
    const def = current.def;
    if (reloading > 0) return false;
    if (def.mag !== Infinity && current.mag <= 0) return false;
    return now - lastShot >= 60 / def.rpm;
  }

  function fire(now, moveSpeed, airborne, crouched, aiming) {
    if (!canFire(now)) return null;
    const def = current.def;
    lastShot = now;
    if (def.mag !== Infinity) current.mag -= 1;
    bloom = Math.min(0.05, bloom + def.bloom);
    const s = spread(now, moveSpeed, airborne, crouched, aiming);
    return { def, spread: s, pellets: def.pellets };
  }

  function startReload(now) {
    const def = current.def;
    if (reloading > 0 || def.mag === Infinity) return false;
    if (current.mag >= def.mag || current.reserve <= 0) return false;
    reloading = def.reloadTime;
    return true;
  }

  function update(dt) {
    bloom = Math.max(0, bloom - dt * 0.03);
    if (reloading > 0) {
      reloading -= dt;
      if (reloading <= 0) {
        reloading = 0;
        const def = current.def;
        const need = def.mag - current.mag;
        const take = Math.min(need, current.reserve);
        current.mag += take;
        current.reserve -= take;
      }
    }
  }

  // Damage at a range, with headshot multiplier applied by the caller.
  function damageAt(def, rangeMetres) {
    const falloff = limit(1 - Math.max(0, rangeMetres - 12) * 0.006, 0.55, 1);
    return def.damage * falloff;
  }

  return {
    owned,
    get current() {
      return current;
    },
    get reloading() {
      return reloading;
    },
    buy,
    equip,
    switchSlot,
    spread,
    canFire,
    fire,
    startReload,
    update,
    damageAt,
    ammoText() {
      const def = current.def;
      if (def.mag === Infinity) return '—';
      return `${current.mag} / ${current.reserve}`;
    },
  };
}
