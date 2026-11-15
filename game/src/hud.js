// Ember Quay — the HUD. Everything the player reads in a frame: the team
// bar with named teams and the round clock, the minimap with sites and dots,
// the radio feed where named bots call out places, the kill feed (now with
// the weapon that did the killing), vitals, loadout, the buy menu and the
// end screen. The screenshots and the code must agree, so every element
// here is driven by real game state.

import { clockText, moneyText } from './util.js';

const KILLFEED_MAX = 5;

export function createHud(world) {
  const $ = (id) => document.getElementById(id);
  const els = {
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    teamAtk: $('team-atk'),
    teamDef: $('team-def'),
    scoreAtk: $('score-atk'),
    scoreDef: $('score-def'),
    timer: $('round-timer'),
    roundNum: $('round-num'),
    phase: $('phase'),
    minimap: $('minimap'),
    roster: $('roster'),
    location: $('location-tag'),
    killfeed: $('killfeed'),
    radioFeed: $('radio-feed'),
    hpNum: $('hp-num'),
    hpBar: $('hp-bar'),
    armourNum: $('armour-num'),
    armourBar: $('armour-bar'),
    moneyNum: $('money-num'),
    weaponName: $('weapon-name'),
    ammoNum: $('ammo-num'),
    slots: $('slots'),
    utility: $('utility'),
    buyMenu: $('buy-menu'),
    buyItems: $('buy-items'),
    buyMoney: $('buy-money'),
    plantWrap: $('plant-wrap'),
    plantLabel: $('plant-label'),
    plantFill: $('plant-fill'),
    banner: $('banner'),
    endScreen: $('end-screen'),
    endTitle: $('end-title'),
    endSub: $('end-sub'),
    endStats: $('end-stats'),
    startScreen: $('start-screen'),
    flashOverlay: $('flash-overlay'),
    hurtOverlay: $('hurt-overlay'),
    bombStatus: $('bomb-status'),
  };

  const mapCtx = els.minimap.getContext('2d');
  const bounds = world.bounds;
  const mapW = els.minimap.width;
  const mapH = els.minimap.height;
  const toMapX = (x) => ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * mapW;
  const toMapY = (z) => ((z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * mapH;
  let bannerAt = -10;
  let hitAt = -10;

  function setCrosshair(spreadPx, hidden) {
    els.crosshair.style.opacity = hidden ? '0' : '0.9';
    els.crosshair.style.setProperty('--gap', `${Math.round(spreadPx)}px`);
  }

  function showHitmarker(headshot, now) {
    els.hitmarker.style.opacity = '1';
    els.hitmarker.style.color = headshot ? '#ff5a5a' : '#ffffff';
    hitAt = now;
  }

  function addKillfeed(text, headshot) {
    const div = document.createElement('div');
    div.className = 'kill' + (headshot ? ' hs' : '');
    div.textContent = text;
    els.killfeed.prepend(div);
    while (els.killfeed.children.length > KILLFEED_MAX) els.killfeed.lastChild.remove();
  }

  function showBanner(text, now) {
    els.banner.textContent = text;
    els.banner.style.opacity = '1';
    bannerAt = now;
  }

  function drawMinimap(snap) {
    const ctx = mapCtx;
    ctx.clearRect(0, 0, mapW, mapH);
    ctx.fillStyle = 'rgba(12, 14, 20, 0.72)';
    ctx.fillRect(0, 0, mapW, mapH);
    // Walls: the tall boxes are the map's skeleton.
    ctx.fillStyle = '#6a5a48';
    for (const b of snap.walls) {
      ctx.fillRect(toMapX(b.minX), toMapY(b.minZ), (b.maxX - b.minX) * (mapW / 64), (b.maxZ - b.minZ) * (mapH / 44));
    }
    // Sites: chalk letters on the map.
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f2e8d0';
    ctx.fillText('A', toMapX(snap.sites.A.x), toMapY(snap.sites.A.z) + 5);
    ctx.fillText('B', toMapX(snap.sites.B.x), toMapY(snap.sites.B.z) + 5);
    // The core: a gold diamond when dropped or planted.
    if (snap.bomb && snap.bomb.state !== 'carried') {
      ctx.fillStyle = '#ffd24d';
      const bx = toMapX(snap.bomb.x);
      const by = toMapY(snap.bomb.z);
      ctx.beginPath();
      ctx.moveTo(bx, by - 6);
      ctx.lineTo(bx + 6, by);
      ctx.lineTo(bx, by + 6);
      ctx.lineTo(bx - 6, by);
      ctx.closePath();
      ctx.fill();
    }
    // Allies cyan, enemies magenta (only when recently seen).
    for (const a of snap.allies) {
      ctx.fillStyle = '#35c8e8';
      ctx.beginPath();
      ctx.arc(toMapX(a.x), toMapY(a.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const e of snap.enemies) {
      ctx.fillStyle = '#ff4d8d';
      ctx.beginPath();
      ctx.arc(toMapX(e.x), toMapY(e.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // The player: a white wedge pointing where they look.
    const px = toMapX(snap.player.x);
    const py = toMapY(snap.player.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.atan2(-Math.sin(snap.player.yaw), -Math.cos(snap.player.yaw)) + Math.PI / 2);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function renderRadio(lines) {
    els.radioFeed.innerHTML = '';
    for (const line of lines.slice(-4)) {
      const div = document.createElement('div');
      div.className = 'radio-line';
      div.textContent = line.text;
      els.radioFeed.appendChild(div);
    }
  }

  function renderRoster(atkAlive, defAlive, atkNames, defNames) {
    els.roster.innerHTML = '';
    const mk = (name, alive, team) => {
      const s = document.createElement('span');
      s.className = `roster-dot ${team} ${alive ? '' : 'dead'}`;
      s.textContent = name;
      return s;
    };
    atkNames.forEach((n, i) => els.roster.appendChild(mk(n, i < atkAlive, 'atk')));
    defNames.forEach((n, i) => els.roster.appendChild(mk(n, i < defAlive, 'def')));
  }

  function update(snap, now) {
    els.hpNum.textContent = String(Math.round(snap.hp));
    els.hpBar.style.width = `${Math.max(0, snap.hp)}%`;
    els.armourNum.textContent = String(Math.round(snap.armour));
    els.armourBar.style.width = `${Math.min(100, snap.armour)}%`;
    els.moneyNum.textContent = moneyText(snap.money);
    els.weaponName.textContent = snap.weaponName;
    els.ammoNum.textContent = snap.ammo;
    els.timer.textContent = clockText(snap.timer);
    els.roundNum.textContent = `ROUND ${snap.round} / 12`;
    els.phase.textContent = snap.phase;
    els.scoreAtk.textContent = String(snap.scoreAtk);
    els.scoreDef.textContent = String(snap.scoreDef);
    els.location.textContent = snap.location;
    els.slots.textContent = snap.slots;
    els.utility.textContent = snap.utility;
    els.bombStatus.textContent = snap.bombStatus;
    setCrosshair(snap.crossGap, snap.crossHidden);
    if (now - hitAt > 0.18) els.hitmarker.style.opacity = '0';
    if (now - bannerAt > 3) els.banner.style.opacity = '0';
    els.flashOverlay.style.opacity = String(snap.flash);
    els.hurtOverlay.style.opacity = String(snap.hurt);
    if (snap.plant) {
      els.plantWrap.style.display = 'block';
      els.plantLabel.textContent = snap.plant.label;
      els.plantFill.style.width = `${Math.round(snap.plant.progress * 100)}%`;
    } else {
      els.plantWrap.style.display = 'none';
    }
    drawMinimap(snap);
    renderRadio(snap.radio);
    renderRoster(snap.atkAlive, snap.defAlive, snap.atkNames, snap.defNames);
  }

  return {
    els,
    update,
    addKillfeed,
    showHitmarker,
    showBanner,
    showBuy(onBuy) {
      els.buyMenu.style.display = 'block';
      els.buyItems.innerHTML = '';
      for (const item of onBuy.items) {
        const b = document.createElement('button');
        b.className = 'buy-item';
        b.innerHTML = `<b>${item.name}</b><span>${item.desc}</span><i>${moneyText(item.price)}</i>`;
        b.disabled = item.owned || item.price > onBuy.money;
        b.addEventListener('click', () => onBuy.buy(item.id));
        els.buyItems.appendChild(b);
      }
      els.buyMoney.textContent = moneyText(onBuy.money);
    },
    hideBuy() {
      els.buyMenu.style.display = 'none';
    },
    showEnd(title, sub, stats) {
      els.endTitle.textContent = title;
      els.endSub.textContent = sub;
      els.endStats.textContent = stats;
      els.endScreen.style.display = 'flex';
    },
    hideEnd() {
      els.endScreen.style.display = 'none';
    },
    showStart() {
      els.startScreen.style.display = 'flex';
    },
    hideStart() {
      els.startScreen.style.display = 'none';
    },
  };
}
