// Ember Quay — sound, all synthesized with WebAudio: no audio files.
// Gunshots are filtered noise bursts, hits are short ticks, the radio is a
// blip, the plant is a beep. One shared context, one noise buffer, a master
// gain the player can mute. Nothing plays before the first user gesture.

export function createAudio() {
  let ctx = null;
  let noiseBuf = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 0.5);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  function resume() {
    if (ensure() && ctx.state === 'suspended') ctx.resume();
  }

  function burst(dur, filterFreq, gain, type = 'lowpass') {
    if (!ensure() || muted) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start();
    src.stop(ctx.currentTime + dur);
  }

  function tone(freq, dur, gain, type = 'sine', slideTo = null) {
    if (!ensure() || muted) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g);
    g.connect(master);
    o.start();
    o.stop(ctx.currentTime + dur);
  }

  function later(fn, ms) {
    setTimeout(fn, ms);
  }

  // Distance is in metres; far shots are quieter and duller.
  function shot(kind, dist = 0) {
    const att = Math.max(0.15, 1 - dist / 55);
    if (kind === 'marksman') burst(0.28, 900, 0.5 * att);
    else if (kind === 'shotgun') burst(0.22, 700, 0.55 * att);
    else if (kind === 'smg') burst(0.09, 1600, 0.3 * att);
    else if (kind === 'pistol') burst(0.11, 1300, 0.35 * att);
    else burst(0.13, 1100, 0.4 * att);
  }

  return {
    resume,
    shot,
    hit(head) {
      tone(head ? 1400 : 1000, 0.06, 0.25, 'square');
    },
    kill() {
      tone(520, 0.09, 0.3, 'sine');
      later(() => tone(780, 0.12, 0.3, 'sine'), 90);
    },
    reload() {
      tone(300, 0.05, 0.2, 'square');
      later(() => tone(420, 0.05, 0.2, 'square'), 160);
    },
    step() {
      burst(0.05, 300, 0.08);
    },
    blip() {
      tone(880, 0.07, 0.16, 'sine', 1320);
    },
    plantBeep() {
      tone(1200, 0.08, 0.25, 'sine');
    },
    defuseBeep() {
      tone(900, 0.08, 0.25, 'sine');
    },
    boom() {
      burst(0.7, 220, 0.8);
      tone(70, 0.5, 0.5, 'sine', 40);
    },
    flashPop() {
      tone(2000, 0.3, 0.2, 'sine', 300);
    },
    win() {
      [523, 659, 784].forEach((f, i) => later(() => tone(f, 0.16, 0.28, 'sine'), i * 130));
    },
    lose() {
      [392, 330, 262].forEach((f, i) => later(() => tone(f, 0.18, 0.25, 'sine'), i * 140));
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
  };
}
