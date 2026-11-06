import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCosmeticStars,
  awardCosmeticStars,
  loadWords,
  clearMemoryStorage,
  getDefaultStarterWords,
  type StorageLike
} from '../../js/srs.js';
import {
  ensureSeededPRNG,
  recordWordCompletionOnState,
  createGameState
} from '../../js/game-core.js';

function createIsolatedStorage(): StorageLike & { dump: () => Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    dump: () => Object.fromEntries(map.entries())
  };
}

describe('Cosmetic Gamification Stars & Core Edge Cases (Executable Specification)', () => {
  beforeEach(() => {
    clearMemoryStorage();
  });

  describe('1. Cosmetic Star Tracking & Profile Isolation', () => {
    it('initializes with 0 stars for a fresh profile and safely handles malformed storage values', () => {
      // GIVEN fresh storage
      const storage = createIsolatedStorage();

      // WHEN reading stars for primary learner and test profile
      const zoeStars = getCosmeticStars('daughter', storage);
      const testStars = getCosmeticStars('test', storage);

      // THEN both start at 0
      expect(zoeStars).toBe(0);
      expect(testStars).toBe(0);

      // WHEN storage contains invalid or negative non-numeric values
      storage.setItem('hottub_cosmetic_stars_daughter', 'invalid-number');
      storage.setItem('hottub_cosmetic_stars_test', '-15');

      // THEN getCosmeticStars safely defaults to 0
      expect(getCosmeticStars('daughter', storage)).toBe(0);
      expect(getCosmeticStars('test', storage)).toBe(0);
    });

    it('awards stars monotonically and isolates balances between learner profiles', () => {
      // GIVEN isolated storage
      const storage = createIsolatedStorage();

      // WHEN awarding 3 stars to Zoé
      const zoeFirstAward = awardCosmeticStars(3, 'daughter', storage);

      // THEN Zoé has 3 stars and Test profile remains at 0
      expect(zoeFirstAward).toBe(3);
      expect(getCosmeticStars('daughter', storage)).toBe(3);
      expect(getCosmeticStars('test', storage)).toBe(0);

      // WHEN awarding 5 stars to Test profile
      const testAward = awardCosmeticStars(5, 'test', storage);

      // THEN Test profile has 5 stars and Zoé remains at 3
      expect(testAward).toBe(5);
      expect(getCosmeticStars('test', storage)).toBe(5);
      expect(getCosmeticStars('daughter', storage)).toBe(3);

      // WHEN awarding another 2 stars to Zoé
      const zoeSecondAward = awardCosmeticStars(2, 'daughter', storage);

      // THEN Zoé total increments to 5
      expect(zoeSecondAward).toBe(5);
      expect(getCosmeticStars('daughter', storage)).toBe(5);
    });

    it('ignores non-positive star increments without mutating stored balances', () => {
      // GIVEN Zoé has 4 stars
      const storage = createIsolatedStorage();
      awardCosmeticStars(4, 'daughter', storage);
      expect(getCosmeticStars('daughter', storage)).toBe(4);

      // WHEN attempting to award negative or 0 stars
      const resultZero = awardCosmeticStars(0, 'daughter', storage);
      const resultNegative = awardCosmeticStars(-5, 'daughter', storage);

      // THEN balance remains unchanged at 4
      expect(resultZero).toBe(4);
      expect(resultNegative).toBe(4);
      expect(getCosmeticStars('daughter', storage)).toBe(4);
    });
  });

  describe('2. Empty Array Storage Re-seeding', () => {
    it('re-seeds default starter words when localStorage contains an empty JSON array "[]"', () => {
      // GIVEN storage where WORDS_STORAGE_KEY was saved as an empty array
      const storage = createIsolatedStorage();
      storage.setItem('hottub_srs_words_v2', '[]');

      // WHEN loadWords is executed
      const loaded = loadWords(storage, '2026-11-01', 'daughter');

      // THEN it falls back to the default starter words and re-seeds storage
      const defaults = getDefaultStarterWords('2026-11-01');
      expect(loaded.length).toBe(defaults.length);
      expect(loaded[0].word).toBe(defaults[0].word);
      expect(storage.getItem('hottub_current_week_label_v2')).toBe('Week 8');
    });
  });

  describe('3. Seeded PRNG Adapter Robustness', () => {
    it('wraps an unseeded external generator with cloneable state interfaces', () => {
      // GIVEN a standard unseeded generator like Math.random without .clone()
      let counter = 0.1;
      const rawFn = () => {
        counter = (counter + 0.2) % 1;
        return counter;
      };

      // WHEN wrapped via ensureSeededPRNG
      const wrapped = ensureSeededPRNG(rawFn, 42);

      // THEN it returns a valid SeededPRNG interface with clone, getState, and setState
      expect(typeof wrapped).toBe('function');
      expect(typeof wrapped.clone).toBe('function');
      expect(typeof wrapped.getState).toBe('function');
      expect(typeof wrapped.setState).toBe('function');

      const val1 = wrapped();
      expect(val1).toBeGreaterThanOrEqual(0);
      expect(val1).toBeLessThan(1);

      const cloned = wrapped.clone();
      expect(typeof cloned).toBe('function');
    });
  });

  describe('4. Word Completion Guards in Core State Stepper', () => {
    it('safely rejects word completion requests when game is not running or currentWordObj is null', () => {
      // GIVEN a stopped or uninitialized game state
      const state = createGameState({
        sessionWords: [{ word: 'soleil' }],
        seed: 99
      });
      state.running = false;
      state.currentWordObj = null;

      // WHEN attempting to record word completion on inactive state
      const result = recordWordCompletionOnState(state);

      // THEN it returns { completed: false } without corrupting state
      expect(result.completed).toBe(false);
      expect(state.running).toBe(false);
    });
  });
});
