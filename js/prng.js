/**
 * Deterministic Seeded Pseudo-Random Number Generator (Mulberry32)
 *
 * Returns a pure function `() => number` producing uniformly distributed
 * floats in [0, 1) from a 32-bit integer seed. Also exposes `.getState()` and
 * `.setState(s)` so game states can be cloned or inspected deterministically.
 */

/**
 * @typedef {(() => number) & { getState: () => number, setState: (s: number) => void, clone: () => SeededPRNG }} SeededPRNG
 */

/**
 * Creates a seeded Mulberry32 PRNG instance.
 * @param {number} [seed=1]
 * @returns {SeededPRNG}
 */
export function createPRNG(seed = 1) {
  let state = (Number(seed) || 0) >>> 0;

  const next = /** @type {SeededPRNG} */ (function () {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });

  next.getState = () => state >>> 0;
  next.setState = (newState) => {
    state = Number(newState) >>> 0;
  };
  next.clone = () => {
    const copy = createPRNG(0);
    copy.setState(state);
    return copy;
  };

  return next;
}
