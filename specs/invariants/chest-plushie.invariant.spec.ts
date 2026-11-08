import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  PLUSHIE_CATALOG,
  selectPlushieForReward,
  upsertPlushieOnShelf,
  type PlushieShelfEntry
} from '../../js/plushies.js';
import {
  createChestGameState,
  scrollDialOnState,
  setDialCharOnState,
  validateChestLockOnState,
  advanceToNextChestOnState,
  stepShelfPhysicsOnState,
  type ChestGameState
} from '../../js/chest-game-core.js';
import { getPlausibleDistractors, getDefaultStarterWords } from '../../js/srs.js';

function assertNoNaNOrInfinity(obj: unknown, path = 'chestState'): void {
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

const frenchCharArb = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyzàâäéèêëîïôöùûüç'.split('')
);
const frenchWordArb = fc
  .array(frenchCharArb, { minLength: 2, maxLength: 10 })
  .map((chars) => chars.join(''));

describe('Treasure Chest & Plushie Shelf Property-Based Invariants (fast-check)', () => {
  it('Property 1 (Single-Character Dial Initialization): initializes 1 dial per character with targetChar + plausible distractors for any French word', () => {
    const vocab = getDefaultStarterWords('2026-11-01');

    fc.assert(
      fc.property(
        frenchWordArb,
        fc.integer({ min: 1, max: 0x7fffffff }),
        (word, seed) => {
          const state = createChestGameState({
            sessionWords: [{ word, week_label: 'Week 8' }],
            allVocabWords: vocab,
            seed
          });

          const expectedChars = Array.from(word.trim().toLowerCase());
          expect(state.dials.length).toBe(expectedChars.length);

          state.dials.forEach((dial, idx) => {
            expect(dial.targetChar).toBe(expectedChars[idx]);
            expect(Array.from(dial.targetChar).length).toBe(1);
            expect(dial.isLocked).toBe(false);
            expect(dial.options).toContain(dial.targetChar);

            const distractorsPool = new Set(
              getPlausibleDistractors(dial.targetChar, word, vocab, idx, state.trapHistory)
            );
            for (const opt of dial.options) {
              expect(Array.from(opt).length).toBe(1);
              if (opt !== dial.targetChar) {
                expect(distractorsPool.has(opt)).toBe(true);
              }
            }
          });
        }
      ),
      { numRuns: 60 }
    );
  });

  it('Property 2 (Pin-Locking State Machine): validating locks matching indices, keeps non-matching unlocked, and locked dials monotonically reject all scroll/change events', () => {
    fc.assert(
      fc.property(
        frenchWordArb,
        fc.array(fc.boolean(), { minLength: 2, maxLength: 10 }),
        fc.array(fc.integer({ min: -5, max: 5 }), { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 1, max: 0x7fffffff }),
        (word, matchMask, scrollDeltas, seed) => {
          const state = createChestGameState({
            sessionWords: [{ word, week_label: 'Week 8' }],
            seed
          });

          // Configure each dial according to matchMask (avoiding all-true so chest stays in partial lock if possible)
          const effectiveMask = state.dials.map((_, i) => Boolean(matchMask[i % matchMask.length]));
          if (effectiveMask.every(Boolean)) {
            effectiveMask[0] = false;
          }

          state.dials.forEach((dial, idx) => {
            if (effectiveMask[idx]) {
              setDialCharOnState(state, idx, dial.targetChar);
            } else {
              const wrongChar = dial.options.find((c) => c !== dial.targetChar)!;
              setDialCharOnState(state, idx, wrongChar);
            }
          });

          const res = validateChestLockOnState(state);
          expect(res.unlocked).toBe(false);

          state.dials.forEach((dial, idx) => {
            expect(dial.isLocked).toBe(effectiveMask[idx]);
            if (effectiveMask[idx]) {
              expect(dial.currentChar).toBe(dial.targetChar);
              for (const delta of scrollDeltas) {
                const sRes = scrollDialOnState(state, idx, delta);
                expect(sRes.changed).toBe(false);
                expect(sRes.locked).toBe(true);
                expect(dial.currentChar).toBe(dial.targetChar);
              }
              const wrongOpt = dial.options.find((c) => c !== dial.targetChar)!;
              const setRes = setDialCharOnState(state, idx, wrongOpt);
              expect(setRes.changed).toBe(false);
              expect(setRes.locked).toBe(true);
              expect(dial.currentChar).toBe(dial.targetChar);
            }
          });
        }
      ),
      { numRuns: 60 }
    );
  });

  it('Property 3 (Tiered Reward Logic): solving on attempt === 1 yields golden without re-queueing; solving on attempt > 1 yields standard and re-queues the word for golden upgrade', () => {
    fc.assert(
      fc.property(
        frenchWordArb,
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 0x7fffffff }),
        (word, targetAttemptCount, seed) => {
          const state = createChestGameState({
            sessionWords: [{ word, week_label: 'Week 8' }],
            seed
          });

          // Perform (targetAttemptCount - 1) failed attempts first
          for (let a = 1; a < targetAttemptCount; a++) {
            const firstUnlockedIdx = state.dials.findIndex((d) => !d.isLocked);
            const wrongOpt = state.dials[firstUnlockedIdx].options.find(
              (c) => c !== state.dials[firstUnlockedIdx].targetChar
            )!;
            setDialCharOnState(state, firstUnlockedIdx, wrongOpt);
            const failRes = validateChestLockOnState(state);
            expect(failRes.unlocked).toBe(false);
            expect(failRes.attempt).toBe(a);
          }

          // Now align all dials to targetChar and validate on attempt === targetAttemptCount
          state.dials.forEach((dial, idx) => {
            if (!dial.isLocked) {
              setDialCharOnState(state, idx, dial.targetChar);
            }
          });

          const unlockRes = validateChestLockOnState(state);
          expect(unlockRes.unlocked).toBe(true);
          expect(unlockRes.attempt).toBe(targetAttemptCount);
          expect(unlockRes.reward).toBeDefined();

          if (targetAttemptCount === 1) {
            expect(unlockRes.reward?.variant).toBe('golden');
            expect(unlockRes.requeuedForGolden).toBe(false);
            expect(state.queue.some((w) => w.word === word)).toBe(false);
          } else {
            expect(unlockRes.reward?.variant).toBe('standard');
            expect(unlockRes.requeuedForGolden).toBe(true);
            expect(state.queue.some((w) => w.word === word && w.needsGoldenUpgrade === true)).toBe(true);
          }
        }
      ),
      { numRuns: 60 }
    );
  });

  it('Property 4 (Plushie Catalog & Shelf Upgrade Invariant): catalog has >= 30 distinct plushies and shelf upgrades never create duplicate plushieIds or downgrade golden to standard', () => {
    expect(PLUSHIE_CATALOG.length).toBeGreaterThanOrEqual(30);

    const rewardEventArb = fc.record({
      catalogIndex: fc.integer({ min: 0, max: PLUSHIE_CATALOG.length - 1 }),
      variant: fc.constantFrom<'standard' | 'golden'>('standard', 'golden')
    });

    fc.assert(
      fc.property(fc.array(rewardEventArb, { minLength: 1, maxLength: 60 }), (events) => {
        let shelf: PlushieShelfEntry[] = [];
        const goldenSet = new Set<string>();

        for (const ev of events) {
          const plushieId = PLUSHIE_CATALOG[ev.catalogIndex].id;
          if (ev.variant === 'golden') {
            goldenSet.add(plushieId);
          }

          const res = upsertPlushieOnShelf(shelf, {
            plushieId,
            variant: ev.variant
          });
          shelf = res.shelf;

          // Invariant A: No duplicate plushieIds on the shelf
          const ids = shelf.map((p) => p.plushieId);
          expect(new Set(ids).size).toBe(ids.length);

          // Invariant B: Any plushie that ever received 'golden' remains 'golden' permanently
          for (const gId of goldenSet) {
            const found = shelf.find((p) => p.plushieId === gId);
            expect(found).toBeDefined();
            expect(found?.variant).toBe('golden');
          }
        }
      }),
      { numRuns: 60 }
    );
  });

  it('Property 5 (No NaN/Infinity & Physics Stability): maintains finite state across arbitrary dial scrolls, validations, and 2D shelf physics steps', () => {
    const starterWords = getDefaultStarterWords('2026-11-01').slice(0, 4);

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 0x7fffffff }),
        fc.array(
          fc.oneof(
            fc.record({
              kind: fc.constant('SCROLL' as const),
              dialIdx: fc.nat(10),
              delta: fc.integer({ min: -3, max: 3 })
            }),
            fc.record({ kind: fc.constant('SOLVE_AND_VALIDATE' as const) }),
            fc.record({ kind: fc.constant('VALIDATE' as const) }),
            fc.record({ kind: fc.constant('NEXT_CHEST' as const) }),
            fc.record({
              kind: fc.constant('PHYSICS_STEP' as const),
              dt: fc.double({ min: 0.005, max: 0.05, noNaN: true })
            })
          ),
          { minLength: 1, maxLength: 50 }
        ),
        (seed, commands) => {
          const state: ChestGameState = createChestGameState({
            sessionWords: starterWords,
            allVocabWords: starterWords,
            seed
          });

          assertNoNaNOrInfinity(state);

          for (const cmd of commands) {
            if (cmd.kind === 'SCROLL' && state.dials.length > 0) {
              scrollDialOnState(state, cmd.dialIdx % state.dials.length, cmd.delta);
            } else if (cmd.kind === 'VALIDATE') {
              validateChestLockOnState(state);
            } else if (cmd.kind === 'SOLVE_AND_VALIDATE') {
              state.dials.forEach((d, idx) => {
                if (!d.isLocked) setDialCharOnState(state, idx, d.targetChar);
              });
              validateChestLockOnState(state);
            } else if (cmd.kind === 'NEXT_CHEST') {
              advanceToNextChestOnState(state);
            } else if (cmd.kind === 'PHYSICS_STEP') {
              stepShelfPhysicsOnState(state, cmd.dt);
            }
            assertNoNaNOrInfinity(state);
          }
        }
      ),
      { numRuns: 40 }
    );
  });
});
