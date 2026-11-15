// Ember Quay — the player. Acceleration-based movement with crouch, jump
// and gravity; a circle body pushed out of the map by the world. Stopping to
// aim pays: spread grows with speed, so the weapon module reads groundSpeed.

import { soakArmour, limit } from './util.js';

export const WALK_SPEED = 4.6;
export const CROUCH_SPEED = 2.2;
export const EYE_STAND = 1.55;
export const EYE_CROUCH = 1.05;
const RADIUS = 0.42;
const ACCEL = 42;
const FRICTION = 11;
const JUMP_VEL = 5.4;
const GRAVITY = 14.5;

export function createPlayer(world, spawn) {
  const state = {
    x: spawn.x,
    z: spawn.z,
    y: 0, // height above the ground
    vy: 0,
    yaw: spawn.angle,
    pitch: 0,
    vx: 0,
    vz: 0,
    crouched: false,
    onGround: true,
    hp: 100,
    armour: 0,
    helmet: false,
    alive: true,
    flash: 0, // 0..1 flashbang blindness
  };

  function reset(spawnPoint) {
    state.x = spawnPoint.x;
    state.z = spawnPoint.z;
    state.y = 0;
    state.vy = 0;
    state.yaw = spawnPoint.angle;
    state.pitch = 0;
    state.vx = 0;
    state.vz = 0;
    state.crouched = false;
    state.onGround = true;
    state.hp = 100;
    state.armour = 0;
    state.helmet = false;
    state.alive = true;
    state.flash = 0;
  }

  function groundSpeed() {
    return Math.hypot(state.vx, state.vz);
  }

  function eyePos() {
    return {
      x: state.x,
      y: (state.crouched ? EYE_CROUCH : EYE_STAND) + state.y,
      z: state.z,
    };
  }

  // input: {forward, strafe, jump, crouch} in -1..1; dt is the fixed step.
  function step(input, dt) {
    if (!state.alive) return;
    state.crouched = !!input.crouch;
    const maxSpeed = state.crouched ? CROUCH_SPEED : WALK_SPEED;
    const sin = Math.sin(state.yaw);
    const cos = Math.cos(state.yaw);
    // Forward is -z in view space; yaw rotates it.
    const fx = -sin;
    const fz = -cos;
    const rx = cos;
    const rz = -sin;
    let wx = fx * input.forward + rx * input.strafe;
    let wz = fz * input.forward + rz * input.strafe;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
    }
    state.vx += wx * ACCEL * dt;
    state.vz += wz * ACCEL * dt;
    // Friction when no input; always cap speed.
    const sp = Math.hypot(state.vx, state.vz);
    if (wl < 0.05) {
      const drop = Math.max(0, sp - FRICTION * dt * sp);
      if (sp > 0) {
        state.vx = (state.vx / sp) * drop;
        state.vz = (state.vz / sp) * drop;
      }
    } else if (sp > maxSpeed) {
      state.vx = (state.vx / sp) * maxSpeed;
      state.vz = (state.vz / sp) * maxSpeed;
    }
    state.x += state.vx * dt;
    state.z += state.vz * dt;
    world.moveCircle(state, RADIUS);
    if (input.jump && state.onGround) {
      state.vy = JUMP_VEL;
      state.onGround = false;
    }
    if (!state.onGround) {
      state.vy -= GRAVITY * dt;
      state.y += state.vy * dt;
      if (state.y <= 0) {
        state.y = 0;
        state.vy = 0;
        state.onGround = true;
      }
    }
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 0.45);
  }

  // Damage with armour: armour absorbs half until it runs out; a helmet
  // halves headshot damage before armour. Returns the hp actually lost.
  function damage(amount, headshot) {
    if (!state.alive) return 0;
    let dmg = amount;
    if (headshot && state.helmet) dmg *= 0.5;
    const dealt = soakArmour(state, dmg);
    state.hp -= dealt;
    if (state.hp <= 0) {
      state.hp = 0;
      state.alive = false;
    }
    return dealt;
  }

  return { state, reset, step, groundSpeed, eyePos, damage };
}
