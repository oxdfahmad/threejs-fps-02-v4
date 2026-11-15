// Ember Quay — the harbour at dusk. One hero map: a lantern-lit quay on
// the water's edge with three lanes, two sites and named corners everywhere,
// so a radio callout ("Contact at Gull Lane!") always means a place the
// player can see.
//
// Layout (metres, x east, z south; the quay is 64 x 44):
//   west end: Quay Gate (attacker spawn)      east end: Harbour Office
//   Site A Beacon Court: north-east           Site B Fish Market: south-east
//   Mid: Tide Plaza with a dry fountain       Flank: Crane Yard (west)
//   Lanes: Gull Lane (north, long), Quay Walk (mid), Net Loft (south),
//   Rope Alley (north-south connector), Tide Plaza (centre crossing).
//
// Landmarks the top entries all have and the old market lacked: a red-white
// beacon tower on the north-east corner, a gantry crane over the east side,
// string lights across every lane, giant chalk site letters, hazard-striped
// barriers at the chokes, and a gradient dusk sky with a low sun over the
// harbour water — visible over the low east parapet.
//
// Collision is circles vs axis-aligned boxes. Tall boxes block movement and
// sight; low crates block movement only, so a player can shoot over them.

import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { limit, distSq } from './util.js';

const EYE = 1.55; // eye height used for sight traces

// Named zones, as rectangles. locationAt() returns the first match; the
// whole map falls back to "Ember Quay".
const ZONES = [
  { name: 'Quay Gate', minX: -32, maxX: -22, minZ: -22, maxZ: 22 },
  { name: 'Beacon Court', minX: 14, maxX: 32, minZ: -22, maxZ: -8 },
  { name: 'Fish Market', minX: 14, maxX: 32, minZ: 8, maxZ: 22 },
  { name: 'Harbour Office', minX: 24, maxX: 32, minZ: -8, maxZ: 8 },
  { name: 'Gull Lane', minX: -22, maxX: 14, minZ: -22, maxZ: -12 },
  { name: 'Net Loft', minX: -22, maxX: 14, minZ: 12, maxZ: 22 },
  { name: 'Tide Plaza', minX: -8, maxX: 8, minZ: -8, maxZ: 8 },
  { name: 'Rope Alley', minX: 4, maxX: 12, minZ: -12, maxZ: 12 },
  { name: 'Crane Yard', minX: -22, maxX: -12, minZ: -8, maxZ: 8 },
];

function signTexture(lines, fg, bg) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 192);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.font = 'bold 64px system-ui, sans-serif';
  g.fillText(lines[0], 256, 84);
  g.font = '28px system-ui, sans-serif';
  g.fillText(lines[1], 256, 140);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function letterTexture(letter) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#1e1812';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#f2e8d0';
  g.lineWidth = 10;
  g.strokeRect(10, 10, 236, 236);
  g.fillStyle = '#f2e8d0';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 170px system-ui, sans-serif';
  g.fillText(letter, 128, 138);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function hazardTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#e8b23a';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#1e1812';
  for (let x = -64; x < 256; x += 64) {
    g.beginPath();
    g.moveTo(x, 64);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 64, 0);
    g.lineTo(x + 32, 64);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function cobbleTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#2e2a24';
  g.fillRect(0, 0, 512, 512);
  const shades = ['#4a4238', '#52483c', '#453d33', '#57493a', '#3e382f'];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const off = row % 2 ? 32 : 0;
      const x = col * 64 + off - 32;
      const y = row * 64;
      g.fillStyle = shades[(row * 7 + col * 3) % shades.length];
      g.beginPath();
      g.roundRect(x + 3, y + 3, 58, 58, 10);
      g.fill();
      g.fillStyle = 'rgba(255, 220, 170, 0.06)';
      g.beginPath();
      g.roundRect(x + 3, y + 3, 58, 18, 10);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 6);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function stripeTexture() {
  // Red-white horizontal bands for the beacon tower.
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  for (let i = 0; i < 6; i++) {
    g.fillStyle = i % 2 === 0 ? '#d23a2a' : '#f2ede2';
    g.fillRect(0, i * 43, 128, 43);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255, 230, 180, 1)');
  grad.addColorStop(0.4, 'rgba(255, 180, 90, 0.5)');
  grad.addColorStop(1, 'rgba(255, 150, 50, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  for (const [x, y, r, a] of [[70, 70, 46, 0.5], [130, 55, 58, 0.45], [190, 75, 44, 0.5], [110, 85, 40, 0.4]]) {
    const grad = g.createRadialGradient(x, y, 2, x, y, r);
    grad.addColorStop(0, `rgba(255, 220, 200, ${a})`);
    grad.addColorStop(1, 'rgba(255, 220, 200, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 128);
  }
  return new THREE.CanvasTexture(c);
}

export function createWorld(scene) {
  const solids = []; // block movement AND sight: {minX,maxX,minZ,maxZ,h}
  const lows = []; // block movement only (crates, counters)

  const mats = {};
  const mat = (color, opts = {}) => {
    const key = color + JSON.stringify(opts);
    if (!mats[key]) {
      mats[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05, ...opts });
    }
    return mats[key];
  };

  function box(x, z, w, d, h, color, list, y = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y + h / 2, z);
    scene.add(m);
    list.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
    return m;
  }

  // --- ground, sky, light -------------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 44),
    new THREE.MeshStandardMaterial({ map: cobbleTexture(), roughness: 0.85, metalness: 0.08 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  scene.fog = new THREE.Fog(PALETTE.fog, 32, 110);

  // Gradient dusk dome: indigo overhead, purple mid, ember at the horizon.
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(PALETTE.skyTop) },
      mid: { value: new THREE.Color(PALETTE.skyMid) },
      low: { value: new THREE.Color(PALETTE.skyLow) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 low;',
      'void main(){',
      '  float h = normalize(vP).y;',
      '  vec3 c = h > 0.22 ? mix(mid, top, smoothstep(0.22, 0.65, h)) : mix(low, mid, smoothstep(-0.06, 0.22, h));',
      '  gl_FragColor = vec4(c, 1.0);',
      '}',
    ].join('\n'),
  });
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(150, 24, 16), skyMat);
  scene.add(skyDome);

  // Low sun over the harbour water, east, with a glow halo.
  const sunTex = glowTexture();
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(5.5, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false }),
  );
  sunDisc.position.set(78, 8, -4);
  sunDisc.rotation.y = -Math.PI / 2;
  scene.add(sunDisc);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunTex, transparent: true, opacity: 0.9, depthWrite: false, fog: false,
  }));
  sunGlow.scale.set(34, 34, 1);
  sunGlow.position.set(78, 8, -4);
  scene.add(sunGlow);

  // Harbour water beyond the low east parapet.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 60),
    new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: 0.15, metalness: 0.55 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(78, 0.08, 0);
  scene.add(water);

  // Drifting dusk clouds.
  const cloudTex = cloudTexture();
  const clouds = [];
  for (const [x, y, z, w] of [[-40, 34, -50, 42], [10, 40, -60, 55], [55, 30, 30, 46], [-10, 36, 55, 50], [70, 26, -35, 38]]) {
    const cl = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w * 0.5),
      new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0.75, depthWrite: false, fog: false }),
    );
    cl.position.set(x, y, z);
    cl.rotation.y = Math.atan2(-x, -z);
    scene.add(cl);
    clouds.push(cl);
  }

  const hemi = new THREE.HemisphereLight(0x8a7ec0, 0x2a2118, 0.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb347, 1.5);
  sun.position.set(-30, 22, -12);
  scene.add(sun);
  const quayLight = new THREE.PointLight(0xffb347, 30, 26, 1.6);
  quayLight.position.set(0, 4.2, 0);
  scene.add(quayLight);
  const siteLight = new THREE.PointLight(0xffc266, 22, 20, 1.6);
  siteLight.position.set(20, 4.5, -14);
  scene.add(siteLight);

  // --- perimeter ----------------------------------------------------------
  // North, south and west walls are full height; the east parapet is low
  // (2.4 m) so the water and the sun read over it from the sites.
  box(0, -22.5, 66, 1, 4.5, PALETTE.wallPlaster, solids);
  box(0, 22.5, 66, 1, 4.5, PALETTE.wallPlaster, solids);
  box(-32.5, 0, 1, 46, 4.5, PALETTE.wallPlaster, solids);
  box(32.5, 0, 1, 46, 2.4, PALETTE.wallPlaster, solids);

  // --- stall blocks (tall, block sight) -----------------------------------
  // North row: Gull Lane stalls with a gap at the long lane.
  box(-16, -17, 12, 6, 3.2, PALETTE.wallBrick, solids);
  box(2, -17, 10, 6, 3.2, PALETTE.wallBrick, solids);
  // South row: Net Loft stalls.
  box(-16, 17, 12, 6, 3.2, PALETTE.wallBrick, solids);
  box(2, 17, 10, 6, 3.2, PALETTE.wallBrick, solids);
  // East blocks guarding the sites.
  box(20, -11, 8, 4, 3.4, PALETTE.wallBrick, solids);
  box(20, 11, 8, 4, 3.4, PALETTE.wallBrick, solids);
  box(28, 0, 4, 12, 3.4, PALETTE.wallBrick, solids);
  // West blocks by Crane Yard.
  box(-24, -6, 6, 8, 3.0, PALETTE.wallBrick, solids);
  box(-24, 8, 6, 6, 3.0, PALETTE.wallBrick, solids);
  // Mid blocks break the long sightlines into 10–20 m lanes: fights happen
  // close here, the way the top entries' screenshots do.
  box(-4, 0, 3, 4, 2.8, PALETTE.wallBrick, solids);
  box(5, 0, 3, 4, 2.8, PALETTE.wallBrick, solids);

  // --- low cover: crates, counters, barrels (shoot over, not through) ----
  const crate = (x, z, w = 1.6, d = 1.6, h = 1.1) => box(x, z, w, d, h, PALETTE.wood, lows);
  crate(-8, -6);
  crate(-8, 6);
  crate(8, -6);
  crate(8, 6);
  crate(-2, -11, 2.2, 1.4, 1.0);
  crate(-2, 11, 2.2, 1.4, 1.0);
  crate(14, -3, 1.6, 1.6, 1.1);
  crate(14, 3, 1.6, 1.6, 1.1);
  crate(-18, 0, 2.4, 1.2, 1.0); // fish stall counter
  crate(26, -16, 2.0, 2.0, 1.0);
  crate(26, 16, 2.0, 2.0, 1.0);
  crate(-28, -14, 1.8, 1.8, 1.1);
  crate(-28, 14, 1.8, 1.8, 1.1);
  crate(-12, -2, 1.4, 1.4, 1.0);
  crate(-12, 2, 1.4, 1.4, 1.0);
  crate(10, -2, 1.4, 1.4, 1.0);
  crate(10, 2, 1.4, 1.4, 1.0);
  // Barrel clusters (round, short). The east pairs sit by the sites, NOT
  // on the lane from the defender spawn to the east nodes: barrels there
  // wedged with the east block's west face into a pocket a bot could
  // never slide out of, and the defenders died at their own spawn.
  const barrelGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.05, 10);
  const barrelMat = mat(0x7a6a4a, { roughness: 0.7, metalness: 0.35 });
  for (const [x, z] of [[17, -18], [17.9, -17.2], [17, 18], [17.9, 17.2], [-26, 0], [-26.9, 0.9]]) {
    const b = new THREE.Mesh(barrelGeo, barrelMat);
    b.position.set(x, 0.53, z);
    scene.add(b);
    lows.push({ minX: x - 0.55, maxX: x + 0.55, minZ: z - 0.55, maxZ: z + 0.55, h: 1.05 });
  }

  // --- awnings over the stall rows (visual, no collision) -----------------
  function awning(x, z, w, d, color) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), mat(color));
    m.position.set(x, 3.45, z);
    m.rotation.z = 0.06;
    scene.add(m);
  }
  awning(-16, -17, 12.6, 7, PALETTE.clothRed);
  awning(2, -17, 10.6, 7, PALETTE.clothTeal);
  awning(-16, 17, 12.6, 7, PALETTE.clothTeal);
  awning(2, 17, 10.6, 7, PALETTE.clothRed);

  // --- Tide Plaza fountain (dry basin, low rim) ---------------------------
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.8, 0.5, 18),
    mat(PALETTE.groundDark),
  );
  rim.position.set(0, 0.25, 0);
  scene.add(rim);
  lows.push({ minX: -2.6, maxX: 2.6, minZ: -2.6, maxZ: 2.6, h: 0.5 });
  const basin = new THREE.Mesh(
    new THREE.CircleGeometry(2.2, 18),
    new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: 0.2, metalness: 0.4 }),
  );
  basin.rotation.x = -Math.PI / 2;
  basin.position.set(0, 0.42, 0);
  scene.add(basin);

  // --- beacon tower (red-white, north-east landmark) ----------------------
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.8, 13, 14),
    new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.7 }),
  );
  tower.position.set(28, 6.5, -18);
  scene.add(tower);
  solids.push({ minX: 26.3, maxX: 29.7, minZ: -19.7, maxZ: -16.3, h: 13 });
  const beaconCap = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.5, 0.8, 14),
    mat(PALETTE.metal),
  );
  beaconCap.position.set(28, 13.4, -18);
  scene.add(beaconCap);
  const beaconLamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffe0a8, emissive: 0xffc266, emissiveIntensity: 2.2 }),
  );
  beaconLamp.position.set(28, 14.1, -18);
  scene.add(beaconLamp);
  const beaconBeam = new THREE.SpotLight(0xffd9a0, 90, 70, 0.22, 0.5, 1.4);
  beaconBeam.position.set(28, 14, -18);
  scene.add(beaconBeam);
  const beamTarget = new THREE.Object3D();
  scene.add(beamTarget);
  beaconBeam.target = beamTarget;

  // --- gantry crane over the east side (visual steel, legs are solid) -----
  const craneMat = mat(0x3a3f45, { roughness: 0.55, metalness: 0.6 });
  for (const [x, z] of [[24, -8], [24, 8]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 9, 0.9), craneMat);
    leg.position.set(x, 4.5, z);
    scene.add(leg);
    solids.push({ minX: x - 0.45, maxX: x + 0.45, minZ: z - 0.45, maxZ: z + 0.45, h: 9 });
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 20), craneMat);
  beam.position.set(24, 9.2, 0);
  scene.add(beam);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, 0.7), craneMat);
  hook.position.set(24, 7.6, -3);
  scene.add(hook);

  // --- string lights across the lanes --------------------------------------
  const bulbGeo = new THREE.SphereGeometry(0.09, 6, 5);
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffe0a8, emissive: 0xffb347, emissiveIntensity: 2.0, roughness: 0.5,
  });
  const wireMat = new THREE.LineBasicMaterial({ color: 0x1e1812 });
  function stringLights(x0, z0, x1, z1, sag = 0.9) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      const y = 3.9 - sag * 4 * t * (1 - t);
      pts.push(new THREE.Vector3(x, y, z));
      if (i > 0 && i < 10) {
        const bulb = new THREE.Mesh(bulbGeo, bulbMat);
        bulb.position.set(x, y - 0.12, z);
        scene.add(bulb);
      }
    }
    const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat);
    scene.add(wire);
  }
  stringLights(-22, -12, -2, -12);
  stringLights(-2, -12, 16, -12);
  stringLights(-22, 12, -2, 12);
  stringLights(-2, 12, 16, 12);
  stringLights(-12, -8, -12, 8);
  stringLights(4, -12, 4, 12);

  // --- lanterns (emissive paper balls on posts) ---------------------------
  const lanterns = [];
  const lanternGeo = new THREE.SphereGeometry(0.32, 10, 8);
  const lanternMat = new THREE.MeshStandardMaterial({
    color: PALETTE.lanternPaper, emissive: PALETTE.lantern, emissiveIntensity: 1.6, roughness: 0.6,
  });
  const postMat = mat(PALETTE.metal);
  for (const [x, z] of [[-20, -8], [-20, 8], [-8, -13], [-8, 13], [8, -13], [8, 13], [20, -6], [20, 6], [0, -4], [0, 4]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.6, 6), postMat);
    post.position.set(x, 1.8, z);
    scene.add(post);
    const lamp = new THREE.Mesh(lanternGeo, lanternMat);
    lamp.position.set(x, 3.8, z);
    scene.add(lamp);
    lanterns.push(lamp);
  }

  // --- hazard barriers at the lane chokes (low, shoot over) ----------------
  const hzTex = hazardTexture();
  const hzMat = new THREE.MeshStandardMaterial({ map: hzTex, roughness: 0.8 });
  for (const [x, z, ry] of [[-14, -12, 0], [-14, 12, 0], [10, -12, 0], [10, 12, 0]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.55, 0.35), hzMat);
    bar.position.set(x, 0.28, z);
    bar.rotation.y = ry;
    scene.add(bar);
    lows.push({ minX: x - 1.2, maxX: x + 1.2, minZ: z - 0.18, maxZ: z + 0.18, h: 0.55 });
  }

  // --- site signs + giant chalk letters ------------------------------------
  function sign(x, z, ry, lines) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(5.4, 2.0),
      new THREE.MeshStandardMaterial({ map: signTexture(lines, '#f5e9c8', '#241a12'), roughness: 0.85 }),
    );
    m.position.set(x, 3.4, z);
    m.rotation.y = ry;
    scene.add(m);
  }
  sign(20, -21.8, 0, ['BEACON COURT', 'SITE A — plant here']);
  sign(20, 21.8, Math.PI, ['FISH MARKET', 'SITE B — plant here']);
  sign(-31.8, 0, Math.PI / 2, ['EMBER QUAY', 'harbour — round 1 of 12']);
  function bigLetter(x, z, ry, letter) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 4.2),
      new THREE.MeshStandardMaterial({ map: letterTexture(letter), roughness: 0.85 }),
    );
    m.position.set(x, 2.6, z);
    m.rotation.y = ry;
    scene.add(m);
  }
  bigLetter(14.5, -21.9, 0, 'A');
  bigLetter(14.5, 21.9, Math.PI, 'B');

  // --- waypoint graph (bots walk it; findPath is a BFS) -------------------
  // Every node sits in open ground, clear of every solid and low box —
  // a node on a box edge pins a bot there forever.
  const nodes = [
    { x: -28, z: 0 }, // 0 attacker spawn
    { x: -20, z: -12 }, // 1 Gull Lane west
    { x: -20, z: 12 }, // 2 Net Loft west
    { x: -12, z: 0 }, // 3 Crane Yard
    { x: -6, z: -8 }, // 4 Gull Lane mid
    { x: -6, z: 8 }, // 5 Net Loft mid
    { x: 0, z: -5 }, // 6 plaza north
    { x: 0, z: 5 }, // 7 plaza south
    { x: 8, z: -10 }, // 8 Rope Alley north
    { x: 8, z: 10 }, // 9 Rope Alley south
    { x: 14, z: -14 }, // 10 Gull Lane east
    { x: 14, z: 14 }, // 11 Net Loft east
    { x: 22, z: -16 }, // 12 Site A — inside the plant zone
    { x: 22, z: 16 }, // 13 Site B — inside the plant zone
    { x: 28, z: -9 }, // 14 defender north
    { x: 28, z: 9 }, // 15 defender south
    { x: 16, z: 0 }, // 16 mid-east connector
    { x: -14, z: -8 }, // 17 Gull Lane cover
    { x: -14, z: 8 }, // 18 Net Loft cover
    { x: -9, z: 0 }, // 19 plaza west crossing
    { x: 9, z: 0 }, // 20 plaza east crossing
  ];
  const edges = [
    [0, 1], [0, 2], [0, 3], [1, 4], [2, 5], [3, 4], [3, 5], [4, 6], [5, 7],
    [6, 8], [7, 9], [8, 10], [9, 11], [10, 12], [11, 13], [12, 14], [13, 15],
    [14, 16], [15, 16], [16, 8], [16, 9], [4, 17], [5, 18], [17, 6], [18, 7],
    [10, 16], [11, 16], [1, 17], [2, 18], [3, 19], [19, 6], [19, 7],
    [6, 20], [7, 20], [20, 16],
  ];
  const adj = nodes.map(() => []);
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const d = distSq(x, z, nodes[i].x, nodes[i].z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function findPath(from, to) {
    if (from === to) return [to];
    const prev = new Array(nodes.length).fill(-1);
    const queue = [from];
    prev[from] = from;
    while (queue.length) {
      const cur = queue.shift();
      for (const nb of adj[cur]) {
        if (prev[nb] === -1) {
          prev[nb] = cur;
          if (nb === to) {
            const path = [to];
            let p = to;
            while (p !== from) {
              p = prev[p];
              path.unshift(p);
            }
            return path;
          }
          queue.push(nb);
        }
      }
    }
    return [to];
  }

  // --- collision + sight ----------------------------------------------------
  function pushOut(p, r, list) {
    for (const b of list) {
      const cx = limit(p.x, b.minX, b.maxX);
      const cz = limit(p.z, b.minZ, b.maxZ);
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          p.x = cx + (dx / d) * r;
          p.z = cz + (dz / d) * r;
        } else {
          // Inside the box: push out along the smallest penetration axis.
          const pl = Math.min(p.x - b.minX + r, b.maxX - p.x + r, p.z - b.minZ + r, b.maxZ - p.z + r);
          if (pl === p.x - b.minX + r) p.x = b.minX - r;
          else if (pl === b.maxX - p.x + r) p.x = b.maxX + r;
          else if (pl === p.z - b.minZ + r) p.z = b.minZ - r;
          else p.z = b.maxZ + r;
        }
      }
    }
    return p;
  }

  function segmentBlocked(ax, az, bx, bz) {
    // 2D segment vs tall boxes only (low crates do not block sight).
    for (const b of solids) {
      const dx = bx - ax;
      const dz = bz - az;
      let t0 = 0;
      let t1 = 1;
      let ok = true;
      for (const [o, d, lo, hi] of [[ax, dx, b.minX, b.maxX], [az, dz, b.minZ, b.maxZ]]) {
        if (Math.abs(d) < 1e-9) {
          if (o < lo || o > hi) { ok = false; break; }
        } else {
          let ta = (lo - o) / d;
          let tb = (hi - o) / d;
          if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
          t0 = Math.max(t0, ta);
          t1 = Math.min(t1, tb);
          if (t0 > t1) { ok = false; break; }
        }
      }
      if (ok && t0 <= t1 && t0 < 1 && t1 > 0) return true;
    }
    return false;
  }

  // 3D shot trace against tall boxes and low crates: returns the first hit
  // distance along the ray, or maxDist when the shot flies clear.
  function traceShot(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist;
    for (const b of [...solids, ...lows]) {
      let t0 = 0;
      let t1 = best;
      let ok = true;
      for (const [o, d, lo, hi] of [
        [ox, dx, b.minX, b.maxX],
        [oy, dy, 0, b.h],
        [oz, dz, b.minZ, b.maxZ],
      ]) {
        if (Math.abs(d) < 1e-9) {
          if (o < lo || o > hi) { ok = false; break; }
        } else {
          let ta = (lo - o) / d;
          let tb = (hi - o) / d;
          if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
          t0 = Math.max(t0, ta);
          t1 = Math.min(t1, tb);
          if (t0 > t1) { ok = false; break; }
        }
      }
      if (ok && t0 >= 0 && t0 < best) best = t0;
    }
    return best;
  }

  function locationAt(x, z) {
    for (const zn of ZONES) {
      if (x >= zn.minX && x <= zn.maxX && z >= zn.minZ && z <= zn.maxZ) return zn.name;
    }
    return 'Ember Quay';
  }

  return {
    bounds: { minX: -32, maxX: 32, minZ: -22, maxZ: 22 },
    solids, // tall boxes: the minimap draws these as the map's skeleton
    lows,
    sites: {
      A: { x: 22, z: -15, name: 'Beacon Court' },
      B: { x: 22, z: 15, name: 'Fish Market' },
    },
    spawns: {
      attacker: [
        { x: -28, z: -4, angle: -Math.PI / 2 },
        { x: -28, z: 0, angle: -Math.PI / 2 },
        { x: -28, z: 4, angle: -Math.PI / 2 },
        { x: -29, z: -8, angle: -Math.PI / 2 },
        { x: -29, z: 8, angle: -Math.PI / 2 },
      ],
      defender: [
        { x: 24, z: -4, angle: Math.PI / 2 },
        { x: 24, z: 0, angle: Math.PI / 2 },
        { x: 24, z: 4, angle: Math.PI / 2 },
        { x: 29, z: -8, angle: Math.PI / 2 },
        { x: 29, z: 8, angle: Math.PI / 2 },
      ],
    },
    nodes,
    nearestNode,
    findPath,
    locationAt,
    hasSight(ax, az, bx, bz) {
      return !segmentBlocked(ax, az, bx, bz);
    },
    moveCircle(p, r) {
      p.x = limit(p.x, -31.4, 31.4);
      p.z = limit(p.z, -21.4, 21.4);
      pushOut(p, r, solids);
      pushOut(p, r, lows);
      return p;
    },
    traceShot,
    eyeHeight: EYE,
    update(_dt, t) {
      // Lanterns breathe gently; the beacon sweeps the harbour; clouds drift.
      const s = 1.5 + Math.sin(t * 1.7) * 0.12;
      for (const l of lanterns) l.material.emissiveIntensity = s;
      quayLight.intensity = 28 + Math.sin(t * 1.7) * 2;
      const a = t * 0.35;
      beamTarget.position.set(28 + Math.cos(a) * 22, 1.5, -18 + Math.sin(a) * 22);
      for (const cl of clouds) cl.position.x += _dt * 0.35;
    },
  };
}
