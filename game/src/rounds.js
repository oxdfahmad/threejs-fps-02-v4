// Ember Quay — the rounds. Twelve rounds, first to seven takes the match.
// Each round: a buy phase, then a live phase that ends by elimination, by
// the core exploding, by a defuse, or by the clock. Money follows the
// Counter-Strike shape: kills pay, wins pay more than losses, and a losing
// streak pays a little extra so a comeback stays possible.
//
// The core rides with the Entry bot. It is planted at a site, ticks for
// 40 seconds, and is defused by a defender channel. The bomb object is
// the same one the bots module drives.

export const ROUND_COUNT = 12;
export const WIN_ROUNDS = 7;
export const BUY_SECONDS = 8;
export const ROUND_SECONDS = 100;
export const PLANT_SECONDS = 40;

export function createRounds(world, radio, hooks) {
  const bomb = {
    state: 'carried', // carried | planted | dropped | exploded | defused
    site: 'A',
    x: 0,
    z: 0,
    timer: 0,
    carriedBy: null, // bot name, 'player', or null
    plant(siteObj) {
      this.state = 'planted';
      this.carriedBy = null;
      this.site = siteObj === world.sites.A ? 'A' : 'B';
      this.x = siteObj.x;
      this.z = siteObj.z;
      this.timer = PLANT_SECONDS;
      hooks.onPlanted(this.site);
    },
    defuse() {
      this.state = 'defused';
      hooks.onDefused();
    },
    carry() {
      this.state = 'carried';
    },
    drop(x, z) {
      this.state = 'dropped';
      this.carriedBy = null;
      this.x = x;
      this.z = z;
    },
  };

  const match = {
    phase: 'buy', // buy | live | over | match
    round: 1,
    scoreAtk: 0,
    scoreDef: 0,
    money: 800,
    timer: BUY_SECONDS,
    lossStreak: 0,
    attackSite: 'A',
    overAt: 0,
  };

  function startRound(now) {
    match.phase = 'buy';
    match.timer = BUY_SECONDS;
    match.attackSite = Math.random() < 0.5 ? 'A' : 'B';
    bomb.state = 'carried';
    bomb.site = match.attackSite;
    const siteName = match.attackSite === 'A' ? 'Beacon Court' : 'Fish Market';
    radio.planCall(now, siteName);
    hooks.onRoundStart(match.round, match.attackSite);
  }

  function siteLabel(site) {
    return site === 'A' ? 'Beacon Court' : 'Fish Market';
  }

  function endRound(winner, reason, now) {
    if (match.phase === 'over' || match.phase === 'match') return;
    match.phase = 'over';
    match.overAt = now;
    if (winner === 'attacker') {
      match.scoreAtk += 1;
      match.money += 3250 + 300; // win + plant bonus is folded in
      match.lossStreak = 0;
    } else {
      match.scoreDef += 1;
      match.money += 1900 + Math.min(900, match.lossStreak * 300);
      match.lossStreak += 1;
    }
    hooks.onRoundEnd(winner, reason, match.scoreAtk, match.scoreDef);
    if (match.scoreAtk >= WIN_ROUNDS || match.scoreDef >= WIN_ROUNDS || match.round >= ROUND_COUNT) {
      match.phase = 'match';
      const result = match.scoreAtk > match.scoreDef ? 'attacker' : match.scoreDef > match.scoreAtk ? 'defender' : 'draw';
      hooks.onMatchEnd(result, match.scoreAtk, match.scoreDef);
    }
  }

  // ctx: {atkAlive, defAlive, playerAlive, now}. Returns nothing; round
  // transitions go through hooks so the HUD and the bots stay in sync.
  function update(dt, now, ctx) {
    if (match.phase === 'buy') {
      match.timer -= dt;
      if (match.timer <= 0) {
        match.phase = 'live';
        match.timer = ROUND_SECONDS;
        hooks.onLive();
      }
      return;
    }
    if (match.phase === 'live') {
      match.timer -= dt;
      if (bomb.state === 'planted') {
        bomb.timer -= dt;
        if (bomb.timer <= 0) {
          bomb.state = 'exploded';
          endRound('attacker', `The core blew at ${siteLabel(bomb.site)}`, now);
          return;
        }
      }
      if (bomb.state === 'defused') {
        endRound('defender', 'The core was defused', now);
        return;
      }
      if (ctx.atkAlive === 0 && bomb.state !== 'planted') {
        endRound('defender', 'Ember Syndicate eliminated', now);
        return;
      }
      if (ctx.defAlive === 0) {
        endRound('attacker', 'Night Watch eliminated', now);
        return;
      }
      if (match.timer <= 0) {
        if (bomb.state === 'planted') {
          // The clock no longer matters once the core is down.
          match.timer = 0.01;
        } else {
          endRound('defender', 'Time ran out with no plant', now);
          return;
        }
      }
      return;
    }
    if (match.phase === 'over') {
      if (now - match.overAt > 3.5) {
        match.round += 1;
        if (match.phase !== 'match') startRound(now);
      }
    }
  }

  function killReward() {
    match.money += 300;
  }

  return { match, bomb, startRound, endRound, update, killReward, siteLabel };
}
