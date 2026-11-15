// Ember Quay — the radio. Every bot has a name and a role, and talks:
// contacts, rotations, plants, smokes and footsteps, always naming the
// place. The feed is what the HUD shows and what a screenshot proves:
// a team that plans out loud instead of wandering in silence.
//
// Attackers are the Ember Syndicate; defenders are the Night Watch.
// A bot may speak at most once every few seconds; the feed keeps the last
// six lines so the HUD never floods.

import { pickOne } from './util.js';

export const ATTACKERS = [
  { name: 'Rook', role: 'Entry' },
  { name: 'Fable', role: 'Lurk' },
  { name: 'Ivo', role: 'Support' },
  { name: 'Maren', role: 'Sniper' },
  { name: 'Kip', role: 'Caller' },
];

export const DEFENDERS = [
  { name: 'Sol', role: 'A Hold' },
  { name: 'Mira', role: 'B Hold' },
  { name: 'Bram', role: 'Mid' },
  { name: 'Tamsin', role: 'Roam' },
  { name: 'Wren', role: 'Sniper' },
];

const LINES = {
  contact: [
    (n, loc) => `${n}: Contact at ${loc}!`,
    (n, loc) => `${n}: One at ${loc}, holding the angle`,
    (n, loc) => `${n}: Enemy spotted ${loc}`,
  ],
  rotate: [
    (n, loc) => `${n}: Rotating to ${loc}`,
    (n, loc) => `${n}: Falling back to ${loc}`,
    (n, loc) => `${n}: Cover ${loc}, I am moving`,
  ],
  plant: [
    (n, loc) => `${n}: Planting at ${loc} — cover me`,
    (n, loc) => `${n}: Core going down at ${loc}`,
  ],
  pickup: [
    (n, loc) => `${n}: I have the core — escort me`,
    (n, loc) => `${n}: Core is mine, push with me`,
  ],
  planted: [
    (n, loc) => `${n}: Core down at ${loc} — hold the site`,
    (n, loc) => `${n}: Plant is in at ${loc}, watch the lanes`,
  ],
  defuse: [
    (n, loc) => `${n}: Defusing at ${loc}!`,
    (n, loc) => `${n}: On the core at ${loc}, keep them off`,
  ],
  smoke: [
    (n, loc) => `${n}: Smoke on ${loc}`,
    (n, loc) => `${n}: Smoking ${loc}, push through`,
  ],
  flash: [(n, loc) => `${n}: Flashing ${loc}`],
  heard: [
    (n, loc) => `${n}: Footsteps ${loc}`,
    (n, loc) => `${n}: Gunfire heard ${loc}`,
    (n, loc) => `${n}: Something moved at ${loc}`,
  ],
  kill: [
    (n, loc) => `${n}: Got one at ${loc}`,
    (n, loc) => `${n}: Dropped one ${loc}`,
  ],
  down: [
    (n, loc) => `${n}: Down at ${loc}!`,
    (n, loc) => `${n}: I am hit at ${loc}`,
  ],
  plan: [
    (n, loc) => `${n}: Go go, executing ${loc}`,
    (n, loc) => `${n}: Hit ${loc} fast, smoke the lanes`,
    (n, loc) => `${n}: Slow play — take ${loc} together`,
  ],
  hold: [
    (n, loc) => `${n}: Holding ${loc}`,
    (n, loc) => `${n}: Watching ${loc}, quiet so far`,
  ],
};

export function createRadio(rng) {
  const feed = []; // {text, at} newest last
  const lastSpoke = new Map(); // bot name -> last speak time
  const MIN_GAP = 3.5;

  function say(name, role, kind, loc, now) {
    const last = lastSpoke.get(name) ?? -100;
    if (now - last < MIN_GAP) return false;
    const lines = LINES[kind];
    if (!lines) return false;
    const picked = pickOne(rng, lines)(name, loc);
    lastSpoke.set(name, now);
    // The line already carries the name; the feed prefixes the role.
    const body = picked.slice(picked.indexOf(':') + 2);
    feed.push({ text: `[RADIO] ${name} (${role}): ${body}`, at: now });
    if (feed.length > 6) feed.shift();
    return true;
  }

  // The round-opening plan: the caller names the site the team will hit.
  function planCall(now, siteName) {
    const caller = pickOne(rng, ATTACKERS);
    say(caller.name, caller.role, 'plan', siteName, now);
  }

  function recent(n) {
    return feed.slice(-n);
  }

  function reset() {
    feed.length = 0;
    lastSpoke.clear();
  }

  return { feed, say, planCall, recent, reset };
}
