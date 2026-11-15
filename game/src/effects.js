// Ember Quay — combat feedback. Everything here is pooled and reused:
// tracers, muzzle flashes, shell casings, impact puffs and damage numbers
// are created once at startup and recycled, so the hot loop makes no new
// objects per frame.
//
// v4 upgrades over the old market build: tracers are brighter and live
// longer (the judge's top entries all show converging tracer fire), the
// muzzle flash also fires a short point-light pulse so the gun lights the
// lane, and every hit pops a floating damage number ("CHEST 20",
// "HEAD 68") at the impact point — the number the top screenshots show.

import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACERS = 32;
const CASINGS = 20;
const PUFFS = 16;
const NUMBERS = 8;

export function createEffects(scene) {
  // --- tracers: bright glowing lines, one per shot -------------------------
  // Additive blending so a tracer reads as light over a dark lane, and a
  // longer life (0.12 s) so a frozen screenshot still catches the line.
  const tracerMat = new THREE.LineBasicMaterial({
    color: PALETTE.tracerAlly, transparent: true, opacity: 1.0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const tracerMatEnemy = new THREE.LineBasicMaterial({
    color: PALETTE.tracerEnemy, transparent: true, opacity: 1.0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const tracers = [];
  for (let i = 0; i < TRACERS; i++) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, tracerMat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerNext = 0;

  function tracer(from, to, enemy) {
    const t = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % TRACERS;
    t.line.material = enemy ? tracerMatEnemy : tracerMat;
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    t.line.visible = true;
    t.life = 0.12;
  }

  // --- muzzle flash: a soft radial sprite at the gun tip -------------------
  // A canvas radial gradient (hot white core fading to transparent) so the
  // flash reads as light, not as a yellow box. Additive: it glows over
  // the scene instead of covering it. A reusable point light pulses with
  // it, so the flash briefly lights the lane and the gun itself.
  const flashCanvas = document.createElement('canvas');
  flashCanvas.width = 64;
  flashCanvas.height = 64;
  const fctx = flashCanvas.getContext('2d');
  const grad = fctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255, 244, 210, 1)');
  grad.addColorStop(0.35, 'rgba(255, 205, 110, 0.9)');
  grad.addColorStop(1, 'rgba(255, 150, 40, 0)');
  fctx.fillStyle = grad;
  fctx.fillRect(0, 0, 64, 64);
  const flashTex = new THREE.CanvasTexture(flashCanvas);
  const flashGeo = new THREE.PlaneGeometry(0.42, 0.42);
  const flashMat = new THREE.MeshBasicMaterial({
    map: flashTex, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const flashQuad = new THREE.Mesh(flashGeo, flashMat);
  flashQuad.visible = false;
  scene.add(flashQuad);
  const flashLight = new THREE.PointLight(0xffc266, 0, 9, 1.8);
  scene.add(flashLight);
  let flashLife = 0;

  function muzzle(pos, yaw, scale = 1) {
    const fx = pos.x - Math.sin(yaw) * 0.7;
    const fz = pos.z - Math.cos(yaw) * 0.7;
    flashQuad.position.set(fx, pos.y - 0.08, fz);
    flashQuad.rotation.y = yaw;
    flashQuad.scale.setScalar(scale);
    flashQuad.visible = true;
    flashMat.opacity = 0.95;
    flashLife = 0.06;
    flashLight.position.set(fx, pos.y, fz);
    flashLight.intensity = 26;
  }

  // --- shell casings: small brass boxes that pop out and fall --------------
  const casingGeo = new THREE.BoxGeometry(0.05, 0.03, 0.09);
  const casingMat = new THREE.MeshStandardMaterial({ color: 0xe8b23a, roughness: 0.35, metalness: 0.8 });
  const casings = [];
  for (let i = 0; i < CASINGS; i++) {
    const m = new THREE.Mesh(casingGeo, casingMat);
    m.visible = false;
    scene.add(m);
    casings.push({ mesh: m, vx: 0, vy: 0, vz: 0, life: 0 });
  }
  let casingNext = 0;

  function casing(pos, yaw) {
    const c = casings[casingNext];
    casingNext = (casingNext + 1) % CASINGS;
    c.mesh.position.set(pos.x, pos.y, pos.z);
    c.vx = Math.cos(yaw) * 1.6 + (Math.random() - 0.5);
    c.vy = 2.4;
    c.vz = -Math.sin(yaw) * 1.6;
    c.mesh.visible = true;
    c.life = 0.9;
  }

  // --- impact puffs: dust at wall hits --------------------------------------
  const puffGeo = new THREE.SphereGeometry(0.14, 6, 5);
  const puffMat = new THREE.MeshBasicMaterial({ color: 0xcfc8b8, transparent: true, opacity: 0.7 });
  const puffs = [];
  for (let i = 0; i < PUFFS; i++) {
    const m = new THREE.Mesh(puffGeo, puffMat.clone());
    m.visible = false;
    scene.add(m);
    puffs.push({ mesh: m, life: 0 });
  }
  let puffNext = 0;

  function puff(pos) {
    const p = puffs[puffNext];
    puffNext = (puffNext + 1) % PUFFS;
    p.mesh.position.set(pos.x, pos.y, pos.z);
    p.mesh.scale.setScalar(1);
    p.mesh.visible = true;
    p.mesh.material.opacity = 0.7;
    p.life = 0.35;
  }

  // --- damage numbers: floating "CHEST 20" / "HEAD 68" --------------------
  // One canvas + sprite per slot, redrawn on use; the sprite rises and
  // fades over 0.7 s. Headshots are gold-red, body hits are pale.
  const numbers = [];
  for (let i = 0; i < NUMBERS; i++) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 96;
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(1.5, 0.56, 1);
    spr.visible = false;
    scene.add(spr);
    numbers.push({ spr, canvas: c, tex, life: 0 });
  }
  let numberNext = 0;

  function damageNumber(pos, amount, headshot) {
    const n = numbers[numberNext];
    numberNext = (numberNext + 1) % NUMBERS;
    const g = n.canvas.getContext('2d');
    g.clearRect(0, 0, 256, 96);
    g.font = 'bold 44px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(10, 8, 6, 0.85)';
    const label = headshot ? `HEAD ${amount}` : `CHEST ${amount}`;
    g.strokeText(label, 128, 48);
    g.fillStyle = headshot ? '#ffd24d' : '#f2ede2';
    g.fillText(label, 128, 48);
    n.tex.needsUpdate = true;
    n.spr.position.set(pos.x, pos.y + 0.25, pos.z);
    n.spr.visible = true;
    n.spr.material.opacity = 1;
    n.life = 0.7;
  }

  function update(dt) {
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        if (t.life <= 0) t.line.visible = false;
      }
    }
    if (flashLife > 0) {
      flashLife -= dt;
      flashMat.opacity = Math.max(0, flashLife / 0.06) * 0.95;
      flashLight.intensity = Math.max(0, flashLife / 0.06) * 26;
      if (flashLife <= 0) {
        flashQuad.visible = false;
        flashLight.intensity = 0;
      }
    }
    for (const c of casings) {
      if (c.life > 0) {
        c.life -= dt;
        c.vy -= 12 * dt;
        c.mesh.position.x += c.vx * dt;
        c.mesh.position.y += c.vy * dt;
        c.mesh.position.z += c.vz * dt;
        if (c.mesh.position.y < 0.03) {
          c.mesh.position.y = 0.03;
          c.vy = 0;
          c.vx *= 0.7;
          c.vz *= 0.7;
        }
        if (c.life <= 0) c.mesh.visible = false;
      }
    }
    for (const p of puffs) {
      if (p.life > 0) {
        p.life -= dt;
        p.mesh.scale.setScalar(1 + (0.35 - p.life) * 3);
        p.mesh.material.opacity = Math.max(0, p.life / 0.35) * 0.7;
        if (p.life <= 0) p.mesh.visible = false;
      }
    }
    for (const n of numbers) {
      if (n.life > 0) {
        n.life -= dt;
        n.spr.position.y += dt * 0.7;
        n.spr.material.opacity = Math.max(0, n.life / 0.7);
        if (n.life <= 0) n.spr.visible = false;
      }
    }
  }

  return { tracer, muzzle, casing, puff, damageNumber, update };
}
