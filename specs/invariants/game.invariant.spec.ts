import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  MIN_BUBBLES,
  MAX_BUBBLES,
  createGameState,
  stepGame,
  type GameAction,
  type GameState,
  isSlotWatermarkVisible
} from '../../js/game-core.js';
import {
  getDefaultStarterWords,
  normalizeWordRecord,
  computeFirstAttemptSRSUpdate,
  getPlausibleDistractors,
  buildSessionWords
} from '../../js/srs.js';

/**
 * Recursively asserts that no numeric property anywhere in the state tree
 * is `NaN` or `±Infinity`, and no expected key holds `undefined`.
 */
function assertNoNaNOrInfinity(obj: unknown, path = 'state'): void {
  if (obj === null || typeof obj === 'function' || typeof obj === 'boolean' || typeof obj === 'string') {
    return;
  }
  if (typeof obj === 'number') {
    expect(Number.isFinite(obj), `${path} must be finite, got ${obj}`).toBe(true);
    return;
  }
  if (obj instanceof Set) {
    for (const item of obj) {
      assertNoNaNOrInfinity(item, `${path}<Set>`);
    }
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => {
      expect(item, `${path}[${idx}] must not be undefined`).not.toBeUndefined();
      assertNoNaNOrInfinity(item, `${path}[${idx}]`);
    });
    return;
  }
  if (typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (key === 'el') continue;
      expect(val, `${path}.${key} must not be undefined`).not.toBeUndefined();
      assertNoNaNOrInfinity(val, `${path}.${key}`);
    }
  }
}

/**
 * Asserts universal system invariants on a `GameState` snapshot.
 */
function assertStateInvariants(state: GameState): void {
  // 1. No NaN / Infinity / undefined corruption anywhere in the state tree
  assertNoNaNOrInfinity(state);

  // 2. Boundary Integrity: indices, error counts, mastery counts, and bubble population
  expect(state.currentIndex).toBeGreaterThanOrEqual(0);
  expect(state.currentIndex).toBeLessThanOrEqual(state.targetChars.length);
  expect(state.wordErrorCount).toBeGreaterThanOrEqual(0);
  expect(state.letterErrorCount).toBeGreaterThanOrEqual(0);
  expect(state.masteredCount).toBeGreaterThanOrEqual(0);
  expect(state.masteredCount).toBeLessThanOrEqual(state.totalUniqueWords);
  expect(state.sessionResults.length).toBeLessThanOrEqual(state.totalUniqueWords);

  const floatingBubbles = state.bubbles.filter((b) => b.state === 'floating');
  expect(floatingBubbles.length).toBeLessThanOrEqual(MAX_BUBBLES);

  // Bubble coordinate and dimension bounds
  if (state.stageWidth >= 40 && state.stageHeight >= 40) {
    for (const b of floatingBubbles) {
      expect(b.diameter).toBeGreaterThanOrEqual(66);
      expect(b.diameter).toBeLessThanOrEqual(98);
      expect(b.radius).toBeCloseTo(b.diameter / 2, 5);
      expect(b.speedY).toBeGreaterThan(0);
      expect(b.age).toBeGreaterThanOrEqual(0);
      // Floating bubbles that haven't been removed must be >= -radius * 0.35
      expect(b.y).toBeGreaterThanOrEqual(-b.radius * 0.35 - 1e-6);
      // Horizontal wobble stays bounded around baseX
      expect(Math.abs(b.x - b.baseX)).toBeLessThanOrEqual(b.wobbleAmp + 1e-6);
    }
  }

  // 3. State Machine Validity
  if (!state.running) {
    expect(state.bubbles).toHaveLength(0);
  }
  if (state.letterErrorCount >= 2) {
    expect(state.watermarkActive).toBe(true);
  }

  if (typeof state.fullWordWatermark !== 'undefined') {
    expect(typeof state.fullWordWatermark).toBe('boolean');
  }
  if (state.watermarkActive && !state.fullWordWatermark) {
    expect(state.letterErrorCount).toBeGreaterThanOrEqual(2);
  }
  for (let idx = 0; idx < state.targetChars.length; idx++) {
    const visible = isSlotWatermarkVisible(state, idx);
    if (!state.running || state.wordTransitioning || idx < state.currentIndex) {
      expect(visible).toBe(false);
    } else if (state.fullWordWatermark) {
      expect(visible).toBe(true);
    } else if (state.watermarkActive && idx === state.currentIndex) {
      expect(visible).toBe(true);
    } else {
      expect(visible).toBe(false);
    }
  }

  if (typeof (state as any).targetSpawnIn === 'number') {
    expect((state as any).targetSpawnIn).toBeGreaterThanOrEqual(0);
    expect((state as any).targetSpawnIn).toBeLessThanOrEqual(3);
  }
  if (state.currentIndex === state.targetChars.length && state.targetChars.length > 0 && state.running) {
    expect(state.wordTransitioning).toBe(true);
  }

  // 4. Retry Capping Invariant: No word can exceed 2 in-session retries
  if (state.currentWordObj && (state.currentWordObj as any).retryCount !== undefined) {
    expect((state.currentWordObj as any).retryCount).toBeLessThanOrEqual(2);
  }
  for (const item of state.queue) {
    if ((item as any).retryCount !== undefined) {
      expect((item as any).retryCount).toBeLessThanOrEqual(2);
    }
  }
  if ((state as any).prefilledIndices !== undefined) {
    expect(Array.isArray((state as any).prefilledIndices)).toBe(true);
    for (const idx of (state as any).prefilledIndices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(state.targetChars.length);
    }
    if (state.currentIndex < state.targetChars.length) {
      expect((state as any).prefilledIndices.includes(state.currentIndex)).toBe(false);
    }
  }
}

/**
 * Custom fast-check arbitrary for realistic game commands that can be mapped onto any current `GameState`.
 */
type SymbolicCommand =
  | { kind: 'TICK'; dt: number }
  | { kind: 'TAP_INDEX'; indexSelector: number }
  | { kind: 'TAP_REQUIRED_IF_PRESENT' }
  | { kind: 'USE_HINT' }
  | { kind: 'COMPLETE_WORD' }
  | { kind: 'PAUSE' }
  | { kind: 'RESUME' }
  | { kind: 'RESIZE'; width: number; height: number }
  | { kind: 'STOP' };

const symbolicCommandArb: fc.Arbitrary<SymbolicCommand> = fc.oneof(
  {
    weight: 10,
    arbitrary: fc.double({ min: -0.02, max: 0.12, noNaN: false }).map((dt): SymbolicCommand => ({ kind: 'TICK', dt }))
  },
  {
    weight: 6,
    arbitrary: fc.nat(20).map((indexSelector): SymbolicCommand => ({ kind: 'TAP_INDEX', indexSelector }))
  },
  { weight: 6, arbitrary: fc.constant<SymbolicCommand>({ kind: 'TAP_REQUIRED_IF_PRESENT' }) },
  { weight: 2, arbitrary: fc.constant<SymbolicCommand>({ kind: 'USE_HINT' }) },
  { weight: 4, arbitrary: fc.constant<SymbolicCommand>({ kind: 'COMPLETE_WORD' }) },
  { weight: 1, arbitrary: fc.constant<SymbolicCommand>({ kind: 'PAUSE' }) },
  { weight: 2, arbitrary: fc.constant<SymbolicCommand>({ kind: 'RESUME' }) },
  {
    weight: 1,
    arbitrary: fc
      .tuple(fc.integer({ min: 180, max: 1200 }), fc.integer({ min: 220, max: 1000 }))
      .map(([width, height]): SymbolicCommand => ({ kind: 'RESIZE', width, height }))
  }
);

function resolveSymbolicCommand(state: GameState, cmd: SymbolicCommand): GameAction {
  switch (cmd.kind) {
    case 'TICK':
      return { type: 'TICK', dt: cmd.dt };
    case 'TAP_INDEX': {
      if (state.bubbles.length === 0) {
        return { type: 'TAP_BUBBLE', bubbleId: 999999 };
      }
      const target = state.bubbles[cmd.indexSelector % state.bubbles.length];
      return { type: 'TAP_BUBBLE', bubbleId: target.id };
    }
    case 'TAP_REQUIRED_IF_PRESENT': {
      const reqChar = state.targetChars[state.currentIndex];
      const match = state.bubbles.find((b) => b.state === 'floating' && b.char === reqChar);
      if (match) {
        return { type: 'TAP_BUBBLE', bubbleId: match.id };
      }
      if (state.bubbles.length > 0) {
        return { type: 'TAP_BUBBLE', bubbleId: state.bubbles[0].id };
      }
      return { type: 'TICK', dt: 0.03 };
    }
    case 'USE_HINT':
      return { type: 'USE_HINT' };
    case 'COMPLETE_WORD':
      return { type: 'COMPLETE_WORD' };
    case 'PAUSE':
      return { type: 'PAUSE' };
    case 'RESUME':
      return { type: 'RESUME' };
    case 'RESIZE':
      return { type: 'RESIZE', width: cmd.width, height: cmd.height };
    case 'STOP':
      return { type: 'STOP' };
  }
}

describe('Property-Based Invariant Suite (fast-check)', () => {
  it('maintains No NaN/Infinity, Boundary Integrity, and State Machine Validity across 1 to 200 random ticks & actions', () => {
    // GIVEN random seeds and action sequences of length 1..200
    const starterWords = getDefaultStarterWords('2026-11-01').slice(0, 6);

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 0x7fffffff }),
        fc.array(symbolicCommandArb, { minLength: 1, maxLength: 200 }),
        (seed, commands) => {
          // WHEN simulating the sequence of 1..200 steps on createGameState
          let state = createGameState({
            sessionWords: starterWords,
            allVocabWords: starterWords,
            stageWidth: 360,
            stageHeight: 420,
            seed
          });

          assertStateInvariants(state);

          for (const cmd of commands) {
            const action = resolveSymbolicCommand(state, cmd);
            const prevIndex = state.currentIndex;
            const prevRunning = state.running;
            const prevPaused = state.paused;
            const prevTransitioning = state.wordTransitioning;

            state = stepGame(state, action);

            // THEN universal state invariants hold at every single step
            assertStateInvariants(state);

            // State Machine Validity: movement/tap inputs never advance currentIndex when paused, transitioning, or stopped
            if (action.type === 'TAP_BUBBLE' && (!prevRunning || prevPaused || prevTransitioning)) {
              expect(state.currentIndex).toBe(prevIndex);
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('proves 100% Determinism: running the exact same action sequence twice with the same PRNG seed produces a deepEqual final state', () => {
    // GIVEN arbitrary PRNG seeds and sequences of 1..200 symbolic commands
    const starterWords = getDefaultStarterWords('2026-11-01').slice(0, 5);

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 0x7fffffff }),
        fc.array(symbolicCommandArb, { minLength: 1, maxLength: 200 }),
        (seed, commands) => {
          // WHEN running the exact same command sequence twice from the same seed
          let stateA = createGameState({
            sessionWords: starterWords,
            allVocabWords: starterWords,
            stageWidth: 400,
            stageHeight: 500,
            seed
          });
          let stateB = createGameState({
            sessionWords: starterWords,
            allVocabWords: starterWords,
            stageWidth: 400,
            stageHeight: 500,
            seed
          });

          for (const cmd of commands) {
            const actionA = resolveSymbolicCommand(stateA, cmd);
            const actionB = resolveSymbolicCommand(stateB, cmd);
            expect(actionA).toEqual(actionB);

            stateA = stepGame(stateA, actionA);
            stateB = stepGame(stateB, actionB);
          }

          // THEN the final states and internal PRNG states are strictly deepEqual
          const { prng: prngA, ...serializableA } = stateA;
          const { prng: prngB, ...serializableB } = stateB;

          expect(serializableA).toEqual(serializableB);
          expect(prngA.getState()).toBe(prngB.getState());
          expect(prngA()).toBe(prngB());
        }
      ),
      { numRuns: 40 }
    );
  });

  it('maintains Leitner Box SRS invariants (1 <= box <= 5, 0 <= correct_attempts <= total_attempts, streak >= 0) across random attempt histories', () => {
    // GIVEN arbitrary initial word records and sequences of firstAttemptErrors
    fc.assert(
      fc.property(
        fc.integer({ min: -10, max: 20 }),
        fc.integer({ min: -5, max: 50 }),
        fc.integer({ min: -5, max: 50 }),
        fc.array(fc.nat(5), { minLength: 1, maxLength: 100 }),
        (rawBox, rawTotal, rawCorrect, errorSequence) => {
          // WHEN normalizing a word record and applying a sequence of SRS updates
          let rec = normalizeWordRecord(
            {
              word: 'câlin',
              box: rawBox,
              total_attempts: rawTotal,
              correct_attempts: rawCorrect,
              streak: 0
            },
            'Week 8',
            '2026-11-01'
          );

          expect(rec.box).toBeGreaterThanOrEqual(1);
          expect(rec.box).toBeLessThanOrEqual(5);
          expect(rec.total_attempts).toBeGreaterThanOrEqual(0);
          expect(rec.correct_attempts).toBeGreaterThanOrEqual(0);
          expect(rec.correct_attempts).toBeLessThanOrEqual(rec.total_attempts);

          for (const errs of errorSequence) {
            rec = computeFirstAttemptSRSUpdate(rec, errs, '2026-11-01');
            expect(rec.box).toBeGreaterThanOrEqual(1);
            expect(rec.box).toBeLessThanOrEqual(5);
            expect(rec.streak).toBeGreaterThanOrEqual(0);
            expect(rec.correct_attempts).toBeGreaterThanOrEqual(0);
            expect(rec.correct_attempts).toBeLessThanOrEqual(rec.total_attempts);
            expect(/^\d{4}-\d{2}-\d{2}$/.test(rec.next_review)).toBe(true);
          }
        }
      ),
      { numRuns: 60 }
    );
  });

  it('guarantees getPlausibleDistractors never contains requiredChar for any lowercase or accented character', () => {
    // GIVEN any character from French/English lowercase repertoire
    const charPool = 'abcdefghijklmnopqrstuvwxyzàâäéèêëîïôöùûüç'.split('');

    fc.assert(
      fc.property(
        fc.constantFrom(...charPool),
        fc.string({ minLength: 1, maxLength: 12 }),
        (reqChar, word) => {
          // WHEN generating plausible distractors
          const distractors = getPlausibleDistractors(reqChar, word, [{ word: 'câlin' }, { word: 'soleil' }]);

          // THEN distractors is non-empty and never includes reqChar
          expect(distractors.length).toBeGreaterThan(0);
          expect(distractors).not.toContain(reqChar);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('maintains Leitner Box SRS invariants under arbitrary combinations of spotless runs, motor slips, and spelling gaps', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 0, max: 20 }),
        fc.array(
          fc.record({
            errors: fc.integer({ min: 0, max: 3 }),
            isMotorSlip: fc.boolean(),
            hintWatermarkUsed: fc.boolean()
          }),
          { minLength: 1, maxLength: 50 }
        ),
        (initialBox, initialStreak, attemptHistory) => {
          let rec = {
            word: 'câlin',
            box: initialBox,
            streak: initialStreak,
            total_attempts: initialStreak,
            correct_attempts: initialStreak,
            next_review: '2026-11-01',
            active: true
          };

          for (const attempt of attemptHistory) {
            rec = computeFirstAttemptSRSUpdate(rec, attempt.errors, '2026-11-01', attempt);
            expect(rec.box).toBeGreaterThanOrEqual(1);
            expect(rec.box).toBeLessThanOrEqual(5);
            expect(rec.streak).toBeGreaterThanOrEqual(0);
            expect(rec.correct_attempts).toBeGreaterThanOrEqual(0);
            expect(rec.correct_attempts).toBeLessThanOrEqual(rec.total_attempts);
            expect(/^\d{4}-\d{2}-\d{2}$/.test(rec.next_review)).toBe(true);
          }
        }
      ),
      { numRuns: 60 }
    );
  });

  it('guarantees Quick Splash mode invariants: max 3 words, strictly due words, and zero padding', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            word: fc.stringMatching(/^[a-z]{3,8}$/),
            dueOffset: fc.integer({ min: -5, max: 5 }),
            active: fc.boolean()
          }),
          { minLength: 1, maxLength: 20 }
        ),
        (rawItems) => {
          const today = '2026-11-01';
          const words = rawItems.map((item, idx) => {
            const nextReview = item.dueOffset <= 0 ? '2026-11-01' : '2026-11-10';
            return normalizeWordRecord(
              {
                word: `${item.word}_${idx}`,
                week_label: 'Week 8',
                active: item.active,
                next_review: nextReview
              },
              'Week 8',
              today
            );
          });

          const dueWords = words.filter((w) => w.active !== false && (!w.next_review || w.next_review <= today));
          const session = buildSessionWords(words, 8, 10, { today, quickSplash: true });

          // Invariant 1: At most 3 words
          expect(session.length).toBeLessThanOrEqual(3);

          // Invariant 2: Exactly min(3, dueWords.length) (NO padding with non-due words)
          expect(session.length).toBe(Math.min(3, dueWords.length));

          // Invariant 3: All words in session must be due words
          for (const w of session) {
            expect(w.active).not.toBe(false);
            expect(!w.next_review || w.next_review <= today).toBe(true);
          }

          // Invariant 4: All words in session must be unique
          const uniqueWords = new Set(session.map((w) => w.word));
          expect(uniqueWords.size).toBe(session.length);
        }
      ),
      { numRuns: 50 }
    );
  });
});
