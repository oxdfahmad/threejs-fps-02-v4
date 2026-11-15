// Ember Quay — input. Pointer lock for mouse look, a key set for movement,
// and one-shot key events (reload, weapon slots, throwables, buy menu) that
// the main loop consumes once per fixed step. The look delta is accumulated
// and drained by the simulation, so a fast mouse never loses a turn.

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set(); // keys pressed since the last consume
  let lookDX = 0;
  let lookDY = 0;
  let locked = false;
  let firing = false;
  let aiming = false;

  function tryLock() {
    // requestPointerLock returns a promise in newer Chrome; a denial
    // (headless, iframe) must not surface as an unhandled rejection.
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  }

  canvas.addEventListener('click', () => {
    if (!locked) tryLock();
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
  });
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    lookDX += e.movementX;
    lookDY += e.movementY;
  });
  document.addEventListener('mousedown', (e) => {
    if (!locked) return;
    if (e.button === 0) firing = true;
    if (e.button === 2) aiming = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) firing = false;
    if (e.button === 2) aiming = false;
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    pressed.add(e.code);
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') e.preventDefault();
  });
  document.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    firing = false;
    aiming = false;
  });

  function moveInput() {
    const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const str = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    return {
      forward: fwd,
      strafe: str,
      jump: keys.has('Space'),
      crouch: keys.has('KeyC') || keys.has('ControlLeft'),
    };
  }

  function consumeLook() {
    const out = { dx: lookDX, dy: lookDY };
    lookDX = 0;
    lookDY = 0;
    return out;
  }

  function consumePressed(code) {
    if (!pressed.has(code)) return false;
    pressed.delete(code);
    return true;
  }

  return {
    keys,
    get locked() {
      return locked;
    },
    get firing() {
      return firing;
    },
    get aiming() {
      return aiming;
    },
    moveInput,
    consumeLook,
    consumePressed,
    lock: tryLock,
  };
}
