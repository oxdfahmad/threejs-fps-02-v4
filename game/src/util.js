// Ember Quay — small shared helpers: numbers, angles, seeded chance.
// Nothing here knows about the game; every module above imports from here.

// Keep v inside [lo, hi].
export function limit(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export function mix(a, b, t) {
  return a + (b - a) * t;
}

// Wrap an angle in radians to (-PI, PI].
export function wrapAngle(a) {
  const TAU = Math.PI * 2;
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return a;
}

// Shortest signed turn from angle a to angle b, in (-PI, PI].
export function turnTo(a, b) {
  return wrapAngle(b - a);
}

// Deterministic RNG (mulberry32). One instance per match, seeded so a
// screenshot run replays the same bot behaviour every time.
export function makeRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickOne(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

export function roll(rng, p) {
  return rng() < p;
}

// Squared distance on the ground plane (x/z only). Hot path: no sqrt.
export function distSq(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

export function dist(ax, az, bx, bz) {
  return Math.sqrt(distSq(ax, az, bx, bz));
}

// Armour absorbs half of a hit until it runs out. Mutates target.armour
// and returns the hp damage actually dealt (at least 1). Shared by the
// player, bot-vs-bot fire and the player's shots so the rule lives once.
export function soakArmour(target, dmg) {
  let dealt = dmg;
  if (target.armour > 0) {
    const absorbed = Math.min(target.armour, dealt * 0.5);
    target.armour -= absorbed;
    dealt -= absorbed;
  }
  return Math.max(1, Math.round(dealt));
}

// Format seconds as M:SS for the round clock.
export function clockText(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const rest = String(s % 60).padStart(2, '0');
  return `${m}:${rest}`;
}

export function moneyText(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}
