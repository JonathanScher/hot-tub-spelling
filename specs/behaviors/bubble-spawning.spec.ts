import { describe, it, expect } from 'vitest';
import { createPRNG } from '../../js/prng.js';
import {
  MIN_BUBBLES,
  MAX_BUBBLES,
  SPAWN_INTERVAL_SEC,
  FAST_SPAWN_INTERVAL_SEC,
  MAX_DT_SEC,
  createGameState,
  stepGame,
  computeBubbleDiameter,
  chooseNextBubbleCharOnState,
  spawnBubbleOnState,
  hasTargetInLowerTwoThirds,
  clampDeltaTime,
  handleBubbleTapOnState
} from '../../js/game-core.js';

describe('Bubble Spawning & Upward Kinematics (js/game-core.js)', () => {
  describe('Initial Wave & Smart Spawning Algorithm', () => {
    it('guarantees at least one bubble with targetChars[0] in the lower two-thirds of the screen and randomizes whether it enters on spawn 1, 2, or 3', () => {
      // GIVEN a single-word session ("câlin") on a 360x420 stage with seed 101
      const sessionWords = [{ word: 'câlin', week_label: 'Week 8' }];

      // WHEN createGameState initializes the session
      const state = createGameState({
        sessionWords,
        allVocabWords: sessionWords,
        stageWidth: 360,
        stageHeight: 420,
        seed: 101
      });

      // THEN 5 floating bubbles are spawned with staggered initial Y coordinates in the lower two-thirds
      expect(state.running).toBe(true);
      expect(state.bubbles).toHaveLength(MIN_BUBBLES);
      expect(state.spawnCounter).toBe(5);

      // Verify exact staggered startY formula: height - 20 - (4 - i) * min(72, height * 0.12)
      const stepY = Math.min(72, 420 * 0.12); // 50.4
      state.bubbles.forEach((b, i) => {
        const expectedY = 420 - 20 - (4 - i) * stepY;
        expect(b.y).toBeCloseTo(expectedY, 5);
        expect(b.state).toBe('floating');
        expect(b.age).toBe(0);
        expect(b.y).toBeGreaterThanOrEqual(420 / 3); // in lower two-thirds
      });

      // Target character 'c' is guaranteed to be in the lower two-thirds
      expect(hasTargetInLowerTwoThirds(state)).toBe(true);

      // Verify across different seeds that the target enters on spawn 1, 2, or 3 (index 0, 1, or 2)
      // rather than being hardcoded to bubble #3
      const firstTargetIndices = new Set();
      for (const seed of [101, 102, 105, 200, 305, 410, 500]) {
        const s = createGameState({ sessionWords, stageWidth: 360, stageHeight: 420, seed });
        const idx = s.bubbles.findIndex((b) => b.char === 'c');
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThanOrEqual(2); // must enter on spawn 1, 2, or 3
        firstTargetIndices.add(idx);
      }
      expect(firstTargetIndices.size).toBeGreaterThan(1);
    });

    it('randomizes target spawn intervals to 1, 2, or 3 spawns instead of fixed every-3rd-bubble', () => {
      // GIVEN a game state on word "printemps" at index 0 ('p')
      const state = createGameState({
        sessionWords: [{ word: 'maison' }],
        seed: 777
      });

      // WHEN we sample 60 consecutive characters via chooseNextBubbleCharOnState
      const sampled = [];
      for (let i = 0; i < 60; i++) {
        const ch = chooseNextBubbleCharOnState(state);
        sampled.push({ count: state.spawnCounter, char: ch });
      }

      // THEN target spawns ('m') occur with intervals in {1, 2, 3} and never exceed 3
      const targetIndices = [];
      sampled.forEach((item, idx) => {
        if (item.char === 'm') {
          targetIndices.push(idx);
        }
      });

      expect(targetIndices.length).toBeGreaterThan(0);
      const intervals = [];
      for (let i = 1; i < targetIndices.length; i++) {
        const gap = targetIndices[i] - targetIndices[i - 1];
        intervals.push(gap);
        expect(gap).toBeGreaterThanOrEqual(1);
        expect(gap).toBeLessThanOrEqual(3);
      }
      // Target interval is randomized (contains varied intervals rather than only 3)
      const uniqueIntervals = new Set(intervals);
      expect(uniqueIntervals.size).toBeGreaterThan(1);
    });

    it('returns fallback "a" when chooseNextBubbleCharOnState is called after all targetChars are already matched', () => {
      // GIVEN a game state where currentIndex has reached targetChars.length
      const state = createGameState({
        sessionWords: [{ word: 'loin' }],
        seed: 12
      });
      state.currentIndex = state.targetChars.length;

      // WHEN chooseNextBubbleCharOnState is called
      const ch = chooseNextBubbleCharOnState(state);

      // THEN it returns 'a' and increments spawnCounter
      expect(ch).toBe('a');
    });

    it('guards against spawning bubbles when stage dimensions are smaller than 40px or word is transitioning', () => {
      // GIVEN a game state with a tiny stage (width = 30)
      const tinyState = createGameState({
        sessionWords: [{ word: 'sans' }],
        stageWidth: 30,
        stageHeight: 420,
        seed: 1
      });

      // WHEN attempting to spawn a bubble on tiny stage or when wordTransitioning is true
      const spawnedOnTiny = spawnBubbleOnState(tinyState);

      const transitioningState = createGameState({
        sessionWords: [{ word: 'sans' }],
        stageWidth: 360,
        stageHeight: 420,
        seed: 1
      });
      transitioningState.wordTransitioning = true;
      const spawnedWhileTransitioning = spawnBubbleOnState(transitioningState);

      // THEN no bubbles are spawned in either case
      expect(tinyState.bubbles).toHaveLength(0);
      expect(spawnedOnTiny).toBeNull();
      expect(spawnedWhileTransitioning).toBeNull();
    });
  });

  describe('Bubble Geometry & Non-Overlapping X Selection', () => {
    it('clamps bubble diameter between 66px and 98px based on 16.5% of shortest stage dimension', () => {
      // GIVEN small, medium, and large stage rectangles
      const smallRect = { width: 280, height: 400 }; // 280 * 0.165 = 46.2 -> 66
      const medRect = { width: 480, height: 600 }; // 480 * 0.165 = 79.2 -> 79
      const largeRect = { width: 900, height: 800 }; // 800 * 0.165 = 132 -> 98

      // WHEN computeBubbleDiameter is called
      const dSmall = computeBubbleDiameter(smallRect);
      const dMed = computeBubbleDiameter(medRect);
      const dLarge = computeBubbleDiameter(largeRect);

      // THEN diameters are clamped to [66, 98]
      expect(dSmall).toBe(66);
      expect(dMed).toBe(79);
      expect(dLarge).toBe(98);
    });

    it('clamps bubble baseX and x within safe horizontal bounds on RESIZE action', () => {
      // GIVEN an active game state on a wide 800x600 stage where bubbles are spread across [0..800]
      const initialState = createGameState({
        sessionWords: [{ word: 'semaine' }],
        stageWidth: 800,
        stageHeight: 600,
        seed: 55
      });
      // Force one bubble near the right edge
      initialState.bubbles[0].baseX = 760;
      initialState.bubbles[0].x = 760;

      // WHEN stepping with a RESIZE action down to 320x480
      const resizedState = stepGame(initialState, { type: 'RESIZE', width: 320, height: 480 });

      // THEN stage dimensions update and all bubbles have baseX clamped within [minX, maxX]
      expect(resizedState.stageWidth).toBe(320);
      expect(resizedState.stageHeight).toBe(480);
      for (const b of resizedState.bubbles) {
        const minX = b.radius + b.wobbleAmp + 8;
        const maxX = Math.max(minX + 4, 320 - b.radius - b.wobbleAmp - 8);
        expect(b.baseX).toBeGreaterThanOrEqual(minX);
        expect(b.baseX).toBeLessThanOrEqual(maxX);
      }
    });
  });

  describe('Upward Kinematics, Sine Wobble, Top Despawn & Population Maintenance', () => {
    it('clamps deltaTime to [0, 0.05] seconds and updates bubble age, upward y, and sinusoidal x wobble', () => {
      // GIVEN an initial active game state
      const initialState = createGameState({
        sessionWords: [{ word: 'soleil' }],
        stageWidth: 360,
        stageHeight: 420,
        seed: 99
      });
      const b0Before = { ...initialState.bubbles[0] };

      // WHEN stepping a TICK with raw dt = 0.25 (exceeding MAX_DT_SEC = 0.05)
      const nextState = stepGame(initialState, { type: 'TICK', dt: 0.25 });
      const b0After = nextState.bubbles.find((b) => b.id === b0Before.id)!;

      // THEN effective dt is clamped to 0.05s and kinematics follow exact formulas
      expect(clampDeltaTime(0.25)).toBe(MAX_DT_SEC);
      expect(clampDeltaTime(-1)).toBe(0);
      expect(clampDeltaTime(Number.NaN)).toBe(0);

      const expectedAge = b0Before.age + MAX_DT_SEC;
      const expectedY = b0Before.y - b0Before.speedY * MAX_DT_SEC;
      const expectedX =
        b0Before.baseX + Math.sin(expectedAge * b0Before.wobbleFreq + b0Before.phase) * b0Before.wobbleAmp;

      expect(b0After.age).toBeCloseTo(expectedAge, 8);
      expect(b0After.y).toBeCloseTo(expectedY, 8);
      expect(b0After.x).toBeCloseTo(expectedX, 8);
    });

    it('spawns new bubbles at 0.32s intervals when activeCount < 5 and at 0.78s intervals when 5 <= activeCount < 7', () => {
      // GIVEN a game state with 5 initial bubbles
      let state = createGameState({
        sessionWords: [{ word: 'serpent' }],
        stageWidth: 360,
        stageHeight: 420,
        seed: 202
      });
      expect(state.bubbles).toHaveLength(5);

      // WHEN advancing 16 ticks of 0.05s (total 0.80s >= SPAWN_INTERVAL_SEC 0.78s)
      for (let i = 0; i < 16; i++) {
        state = stepGame(state, { type: 'TICK', dt: 0.05 });
      }

      // THEN a 6th bubble is spawned and spawnTimer resets
      expect(state.bubbles).toHaveLength(6);
      expect(state.spawnTimer).toBeLessThan(SPAWN_INTERVAL_SEC);

      // WHEN 2 bubbles are removed so activeCount drops to 4 (< MIN_BUBBLES = 5) and we advance 0.35s (>= FAST_SPAWN_INTERVAL_SEC = 0.32s)
      state = stepGame(state, { type: 'REMOVE_BUBBLE', bubbleId: state.bubbles[0].id });
      state = stepGame(state, { type: 'REMOVE_BUBBLE', bubbleId: state.bubbles[0].id });
      expect(state.bubbles).toHaveLength(4);
      state.spawnTimer = 0;

      for (let i = 0; i < 7; i++) {
        state = stepGame(state, { type: 'TICK', dt: 0.05 }); // 7 * 0.05 = 0.35s >= 0.32s
      }

      // THEN fast replenishment spawns a 5th bubble at the 0.32s threshold
      expect(state.bubbles).toHaveLength(5);
      expect(FAST_SPAWN_INTERVAL_SEC).toBe(0.32);
    });

    it('removes bubbles that float past the top boundary (y < -radius * 0.35)', () => {
      // GIVEN a game state where bubble #1 is positioned just above the top despawn threshold
      const state = createGameState({
        sessionWords: [{ word: 'sortir' }],
        stageWidth: 360,
        stageHeight: 420,
        seed: 303
      });
      const targetBubbleId = state.bubbles[0].id;
      const radius = state.bubbles[0].radius;
      state.bubbles[0].y = -radius * 0.34;

      // WHEN stepping 1 tick of 0.05s so y drops below -radius * 0.35
      const nextState = stepGame(state, { type: 'TICK', dt: 0.05 });

      // THEN that bubble is despawned and removed from state.bubbles
      expect(nextState.bubbles.some((b) => b.id === targetBubbleId)).toBe(false);
    });

    it('returns urgentRemoved array prioritizing bubbles highest on screen when urgent spawn needs room', () => {
      // GIVEN a game state with 7 floating bubbles where next target character is not present
      const state = createGameState({
        sessionWords: [{ word: 'chat' }],
        stageWidth: 360,
        stageHeight: 420,
        seed: 42
      });
      while (state.bubbles.filter((b) => b.state === 'floating').length < 7) {
        spawnBubbleOnState(state);
      }
      expect(state.bubbles.filter((b) => b.state === 'floating')).toHaveLength(7);

      // Target character is 'c'. Change any 'h' in other bubbles so urgent spawn fires for 'h'
      const cBubble = state.bubbles.find((b) => b.char === 'c')!;
      state.bubbles.forEach((b) => {
        if (b !== cBubble && b.char === 'h') b.char = 'z';
      });

      // Give distinct Y coordinates to candidate bubbles
      const otherBubbles = state.bubbles.filter((b) => b !== cBubble);
      otherBubbles.forEach((b, i) => {
        b.y = 50 + i * 40; // bubble 0 has lowest y (highest on stage)
      });
      const highestBubbleId = otherBubbles[0].id;

      // WHEN tapping the correct bubble 'c'
      const res = handleBubbleTapOnState(state, cBubble);

      // THEN urgentRemoved is populated with the excess bubble closest to top of screen
      expect(res.handled).toBe(true);
      expect(res.urgentRemoved).toBeDefined();
      expect(res.urgentRemoved!.length).toBeGreaterThan(0);
      expect(res.urgentRemoved![0].id).toBe(highestBubbleId);
      expect(state.bubbles.some((b) => b.id === highestBubbleId)).toBe(false);
    });
  });
});
