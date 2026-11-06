import { describe, it, expect, beforeEach } from 'vitest';
import { createPRNG } from '../../js/prng.js';
import {
  BOX_INTERVALS,
  getLocalISODate,
  addDaysISO,
  getDefaultStarterWords,
  getDefaultAudioUrl,
  DEFAULT_WORD_AUDIO_MAP,
  normalizeWord,
  normalizeWordRecord,
  loadWords,
  saveWords,
  getCurrentWeekLabel,
  setCurrentWeekLabel,
  mergeWordsFromCloud,
  buildSessionWords,
  computeFirstAttemptSRSUpdate,
  recordFirstAttemptSRS,
  isUnaccentedLookalike,
  isAdjacentLetter,
  isMotorSlip,
  addWeeklyWordList,
  removeWordFromStore,
  suggestNextWeekLabel,
  getPlausibleDistractors,
  shuffleGently,
  clearMemoryStorage,
  type StorageLike,
  type WordRecord
} from '../../js/srs.js';

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

describe('SRS & Vocabulary Store Mechanics (js/srs.js)', () => {
  beforeEach(() => {
    clearMemoryStorage();
  });

  describe('Word & Record Normalization', () => {
    it('normalizes raw words to lowercase and strips all internal/surrounding whitespace while preserving accents', () => {
      // GIVEN raw strings with mixed case, spaces, and French accents
      const rawAccented = '  Câlin  ';
      const rawMultiSpace = '  Bon   Jour \t\n ';
      const rawNullish = null;

      // WHEN normalizeWord is executed
      const normAccented = normalizeWord(rawAccented);
      const normMultiSpace = normalizeWord(rawMultiSpace);
      const normNullish = normalizeWord(rawNullish);

      // THEN lowercase and accents are preserved and all whitespace is removed
      expect(normAccented).toBe('câlin');
      expect(normMultiSpace).toBe('bonjour');
      expect(normNullish).toBe('');
    });

    it('normalizes partial or malformed word records into strict Leitner schema bounds', () => {
      // GIVEN malformed records with out-of-range boxes, negative stats, and invalid dates
      const today = '2026-11-01';
      const rawTooHigh = {
        word: '  Soleil ',
        box: 99,
        total_attempts: 5,
        correct_attempts: 12,
        streak: -3,
        next_review: 'not-a-date',
        active: 'false'
      };
      const rawMissingCorrect = {
        word: 'prince',
        box: 4,
        total_attempts: 5,
        streak: 2,
        next_review: '2026-11-08T15:30:00Z'
      };

      // WHEN normalizeWordRecord is called
      const recHigh = normalizeWordRecord(rawTooHigh, 'Week 8', today);
      const recInferred = normalizeWordRecord(rawMissingCorrect, 'Week 8', today);

      // THEN box is clamped to [1, 5], correct_attempts is clamped to [0, total_attempts], and dates normalize to YYYY-MM-DD
      expect(recHigh).toEqual({
        word: 'soleil',
        week_label: 'Week 8',
        active: false,
        box: 5,
        next_review: '2026-11-01',
        streak: 0,
        total_attempts: 5,
        correct_attempts: 5,
        custom_audio_url: ''
      });

      // CHARACTERIZATION NOTE: When correct_attempts is omitted and total_attempts > 0,
      // normalizeWordRecord infers correct_attempts as min(totalAttempts, max(streak, box > 1 ? box - 1 : 0)).
      expect(recInferred.correct_attempts).toBe(3); // max(streak=2, box-1=3) = 3
      expect(recInferred.next_review).toBe('2026-11-08');
      expect(recInferred.active).toBe(true);
    });
  });

  describe('Date Formatting & Arithmetic', () => {
    it('formats local ISO dates and adds positive or zero day intervals accurately', () => {
      // GIVEN a specific local date 2026-11-01
      const baseDate = new Date(2026, 10, 1, 12, 0, 0); // Month 10 = November

      // WHEN formatting to ISO and adding Leitner box intervals (+1, +2, +4, +7, +14)
      const iso = getLocalISODate(baseDate);
      const plus1 = addDaysISO(iso, BOX_INTERVALS[1]);
      const plus2 = addDaysISO(iso, BOX_INTERVALS[2]);
      const plus4 = addDaysISO(iso, BOX_INTERVALS[3]);
      const plus7 = addDaysISO(iso, BOX_INTERVALS[4]);
      const plus14 = addDaysISO(iso, BOX_INTERVALS[5]);

      // THEN exact YYYY-MM-DD strings are produced
      expect(iso).toBe('2026-11-01');
      expect(plus1).toBe('2026-11-02');
      expect(plus2).toBe('2026-11-03');
      expect(plus4).toBe('2026-11-05');
      expect(plus7).toBe('2026-11-08');
      expect(plus14).toBe('2026-11-15');
    });
  });

  describe('Starter Words & Storage Seeding', () => {
    it('seeds 16 default French words across Week 7 (9 words) and Week 8 (7 words) when storage is empty', () => {
      // GIVEN an empty isolated storage and fixed date
      const storage = createIsolatedStorage();
      const today = '2026-11-01';

      // WHEN loadWords is called for the first time
      const words = loadWords(storage, today);
      const currentWeek = getCurrentWeekLabel(words, storage);

      // THEN 16 starter words are returned, saved to storage, and current week is set to Week 8
      expect(words).toHaveLength(16);
      expect(words.filter((w) => w.week_label === 'Week 7')).toHaveLength(9);
      expect(words.filter((w) => w.week_label === 'Week 8')).toHaveLength(7);
      expect(words.every((w) => w.box === 1 && w.next_review === today && w.total_attempts === 0)).toBe(true);
      expect(currentWeek).toBe('Week 8');
    });
  });

  describe('Leitner Box Progression (recordFirstAttemptSRS)', () => {
    it('advances box (up to max 5), increments streak and correct_attempts, and schedules BOX_INTERVALS[nextBox] on 0 errors', () => {
      // GIVEN a word in Box 1 stored in isolated storage on 2026-11-01
      const storage = createIsolatedStorage();
      const today = '2026-11-01';
      loadWords(storage, today);

      // WHEN recording consecutive spotless first-attempts (0 errors) across sessions
      const step1 = recordFirstAttemptSRS('câlin', 0, { today: '2026-11-01', storage })!;
      const step2 = recordFirstAttemptSRS('câlin', 0, { today: '2026-11-03', storage })!;
      const step3 = recordFirstAttemptSRS('câlin', 0, { today: '2026-11-07', storage })!;
      const step4 = recordFirstAttemptSRS('câlin', 0, { today: '2026-11-14', storage })!;
      const step5 = recordFirstAttemptSRS('câlin', 0, { today: '2026-11-28', storage })!;

      // THEN box advances 1 -> 2 -> 3 -> 4 -> 5 -> 5 (clamped at 5) with intervals +2d, +4d, +7d, +14d, +14d
      expect(step1.box).toBe(2);
      expect(step1.next_review).toBe('2026-11-03');
      expect(step1.streak).toBe(1);
      expect(step1.correct_attempts).toBe(1);
      expect(step1.total_attempts).toBe(1);

      expect(step2.box).toBe(3);
      expect(step2.next_review).toBe('2026-11-07');

      expect(step3.box).toBe(4);
      expect(step3.next_review).toBe('2026-11-14');

      expect(step4.box).toBe(5);
      expect(step4.next_review).toBe('2026-11-28');

      expect(step5.box).toBe(5);
      expect(step5.next_review).toBe('2026-12-12');
      expect(step5.streak).toBe(5);
      expect(step5.correct_attempts).toBe(5);
      expect(step5.total_attempts).toBe(5);
    });

    it('resets box to 1, resets streak to 0, keeps correct_attempts unchanged, and schedules next_review = today + 1d on >0 errors', () => {
      // GIVEN a word currently at Box 4 with streak 3 and 3/3 correct attempts
      const current: WordRecord = {
        word: 'soleil',
        week_label: 'Week 7',
        active: true,
        box: 4,
        next_review: '2026-11-01',
        streak: 3,
        total_attempts: 3,
        correct_attempts: 3,
        custom_audio_url: ''
      };

      // WHEN firstAttemptErrors is 2 on 2026-11-01
      const updated = computeFirstAttemptSRSUpdate(current, 2, '2026-11-01');

      // THEN box drops to 1, streak resets to 0, next_review is 2026-11-02, and correct_attempts stays 3
      expect(updated).toEqual({
        ...current,
        box: 1,
        next_review: '2026-11-02',
        streak: 0,
        total_attempts: 4,
        correct_attempts: 3
      });
    });

    it('returns null when recording SRS for an unknown or empty word', () => {
      // GIVEN seeded storage
      const storage = createIsolatedStorage();
      loadWords(storage, '2026-11-01');

      // WHEN recording SRS for a non-existent or blank word
      const resEmpty = recordFirstAttemptSRS('   ', 0, { storage });
      const resUnknown = recordFirstAttemptSRS('inexistant', 0, { storage });

      // THEN both return null without mutating stored words
      expect(resEmpty).toBeNull();
      expect(resUnknown).toBeNull();
    });

    it('softens Leitner reset for a single motor slip (unaccented lookalike): drops 1 box (max(1, box - 1)) and sets interval accordingly', () => {
      // GIVEN a word currently at Box 5 with streak 4 and 4/4 correct attempts
      const current: WordRecord = {
        word: 'câlin',
        week_label: 'Week 8',
        active: true,
        box: 5,
        next_review: '2026-11-01',
        streak: 4,
        total_attempts: 4,
        correct_attempts: 4,
        custom_audio_url: ''
      };

      // WHEN firstAttemptErrors is 1 on 2026-11-01 and the wrong tap was an unaccented lookalike ('a' instead of 'â')
      const updated = computeFirstAttemptSRSUpdate(current, 1, '2026-11-01', {
        wrongTap: 'a',
        targetChar: 'â',
        targetIndex: 1
      });

      // THEN box drops by 1 (5 -> 4), streak adjusts to 3, next_review is +7d (2026-11-08, BOX_INTERVALS[4]), correct_attempts stays 4, total_attempts is 5
      expect(updated).toEqual({
        ...current,
        box: 4,
        next_review: '2026-11-08',
        streak: 3,
        total_attempts: 5,
        correct_attempts: 4
      });
    });

    it('softens Leitner reset for a single motor slip (adjacent letter in word): drops 1 box (max(1, box - 1))', () => {
      // GIVEN a word currently at Box 4 with streak 3
      const current: WordRecord = {
        word: 'câlin',
        week_label: 'Week 8',
        active: true,
        box: 4,
        next_review: '2026-11-01',
        streak: 3,
        total_attempts: 3,
        correct_attempts: 3,
        custom_audio_url: ''
      };

      // WHEN firstAttemptErrors is 1 on 2026-11-01 and the wrong tap was the adjacent letter ('l' tapped when 'â' was expected at index 1)
      const updated = computeFirstAttemptSRSUpdate(current, 1, '2026-11-01', {
        wrongTap: 'l',
        targetChar: 'â',
        targetIndex: 1
      });

      // THEN box drops by 1 (4 -> 3), streak adjusts to 2, next_review is +4d (2026-11-05, BOX_INTERVALS[3]), total_attempts is 4
      expect(updated).toEqual({
        ...current,
        box: 3,
        next_review: '2026-11-05',
        streak: 2,
        total_attempts: 4,
        correct_attempts: 3
      });
    });

    it('clamps softened box drop at Box 1 when a word in Box 1 has a motor slip', () => {
      // GIVEN a word currently at Box 1 with streak 0
      const current: WordRecord = {
        word: 'été',
        week_label: 'Week 8',
        active: true,
        box: 1,
        next_review: '2026-11-01',
        streak: 0,
        total_attempts: 1,
        correct_attempts: 0,
        custom_audio_url: ''
      };

      // WHEN firstAttemptErrors is 1 with unaccented lookalike ('e' instead of 'é')
      const updated = computeFirstAttemptSRSUpdate(current, 1, '2026-11-01', {
        wrongTap: 'e',
        targetChar: 'é',
        targetIndex: 0
      });

      // THEN box remains 1 (max(1, 1 - 1) = 1), streak remains 0, next_review is +1d (2026-11-02)
      expect(updated.box).toBe(1);
      expect(updated.streak).toBe(0);
      expect(updated.next_review).toBe('2026-11-02');
      expect(updated.total_attempts).toBe(2);
    });

    it('resets to Box 1 when firstAttemptErrors is 1 but the hint watermark was used', () => {
      // GIVEN a word currently at Box 4 with streak 3
      const current: WordRecord = {
        word: 'soleil',
        week_label: 'Week 7',
        active: true,
        box: 4,
        next_review: '2026-11-01',
        streak: 3,
        total_attempts: 3,
        correct_attempts: 3,
        custom_audio_url: ''
      };

      // WHEN firstAttemptErrors is 1 because the hint watermark was used
      const updated = computeFirstAttemptSRSUpdate(current, 1, '2026-11-01', {
        hintWatermarkUsed: true
      });

      // THEN box drops all the way to 1, streak resets to 0, next_review is +1d
      expect(updated).toEqual({
        ...current,
        box: 1,
        next_review: '2026-11-02',
        streak: 0,
        total_attempts: 4,
        correct_attempts: 3
      });
    });

    it('resets to Box 1 when firstAttemptErrors is 1 but the wrong tap is a spelling gap (not a lookalike or adjacent letter)', () => {
      // GIVEN a word currently at Box 4 with streak 3
      const current: WordRecord = {
        word: 'câlin',
        week_label: 'Week 8',
        active: true,
        box: 4,
        next_review: '2026-11-01',
        streak: 3,
        total_attempts: 3,
        correct_attempts: 3,
        custom_audio_url: ''
      };

      // WHEN firstAttemptErrors is 1 because of a completely unrelated letter ('z' tapped for 'c')
      const updated = computeFirstAttemptSRSUpdate(current, 1, '2026-11-01', {
        wrongTap: 'z',
        targetChar: 'c',
        targetIndex: 0
      });

      // THEN box drops all the way to 1, streak resets to 0, next_review is +1d
      expect(updated).toEqual({
        ...current,
        box: 1,
        next_review: '2026-11-02',
        streak: 0,
        total_attempts: 4,
        correct_attempts: 3
      });
    });

    it('resets to Box 1 when firstAttemptErrors is 2 or more, even if one wrong tap was a lookalike', () => {
      // GIVEN a word currently at Box 5 with streak 4
      const current: WordRecord = {
        word: 'câlin',
        week_label: 'Week 8',
        active: true,
        box: 5,
        next_review: '2026-11-01',
        streak: 4,
        total_attempts: 4,
        correct_attempts: 4,
        custom_audio_url: ''
      };

      // WHEN firstAttemptErrors is 2 (e.g. wrong lookalike 'a' then wrong letter 'z')
      const updated = computeFirstAttemptSRSUpdate(current, 2, '2026-11-01', {
        wrongTaps: [
          { tappedChar: 'a', targetChar: 'â' },
          { tappedChar: 'z', targetChar: 'â' }
        ]
      });

      // THEN box drops all the way to 1, streak resets to 0, next_review is +1d
      expect(updated).toEqual({
        ...current,
        box: 1,
        next_review: '2026-11-02',
        streak: 0,
        total_attempts: 5,
        correct_attempts: 4
      });
    });

    it('softens Box reset via recordFirstAttemptSRS when options convey a motor slip', () => {
      const storage = createIsolatedStorage();
      const today = '2026-11-01';
      // Seed storage with "câlin" promoted to Box 5
      loadWords(storage, today);
      recordFirstAttemptSRS('câlin', 0, { today: '2026-11-01', storage });
      recordFirstAttemptSRS('câlin', 0, { today: '2026-11-03', storage });
      recordFirstAttemptSRS('câlin', 0, { today: '2026-11-07', storage });
      const box5Rec = recordFirstAttemptSRS('câlin', 0, { today: '2026-11-14', storage })!;
      expect(box5Rec.box).toBe(5);

      // Now record a single motor slip on 2026-11-28
      const slipRec = recordFirstAttemptSRS('câlin', 1, {
        today: '2026-11-28',
        storage,
        wrongTap: 'a',
        targetChar: 'â'
      })!;

      expect(slipRec.box).toBe(4);
      expect(slipRec.next_review).toBe('2026-12-05'); // 2026-11-28 + 7 days
      expect(slipRec.streak).toBe(3);
    });
  });

  describe('Motor Slip Classification: Lookalikes and Adjacent Letters (isUnaccentedLookalike, isAdjacentLetter, isMotorSlip)', () => {
    it('identifies unaccented lookalikes (a vs à/â, e vs é/è/ê, c vs ç) and rejects identical or distinct base letters', () => {
      expect(isUnaccentedLookalike('a', 'à')).toBe(true);
      expect(isUnaccentedLookalike('a', 'â')).toBe(true);
      expect(isUnaccentedLookalike('e', 'é')).toBe(true);
      expect(isUnaccentedLookalike('é', 'è')).toBe(true);
      expect(isUnaccentedLookalike('c', 'ç')).toBe(true);
      expect(isUnaccentedLookalike('a', 'a')).toBe(false); // same char
      expect(isUnaccentedLookalike('a', 'b')).toBe(false); // different base
    });

    it('identifies adjacent letters in the word being spelled (both previous and next letter)', () => {
      // In word "câlin", target is 'â' at index 1: adjacent letters in word are 'c' and 'l'
      expect(isAdjacentLetter('c', 'â', 'câlin', 1)).toBe(true);
      expect(isAdjacentLetter('l', 'â', 'câlin', 1)).toBe(true);
      // 'n' is at index 4 (not adjacent to index 1)
      expect(isAdjacentLetter('n', 'â', 'câlin', 1)).toBe(false);
    });

    it('classifies motor slips accurately using isMotorSlip helper', () => {
      expect(isMotorSlip({ errors: 1, wrongTap: 'a', targetChar: 'â' })).toBe(true);
      expect(isMotorSlip({ errors: 1, wrongTap: 'l', targetChar: 'â', word: 'câlin', targetIndex: 1 })).toBe(true);
      expect(isMotorSlip({ errors: 1, wrongTap: 'z', targetChar: 'c' })).toBe(false);
      expect(isMotorSlip({ errors: 1, hintWatermarkUsed: true })).toBe(false);
      expect(isMotorSlip({ errors: 2, wrongTap: 'a', targetChar: 'â' })).toBe(false);
      expect(isMotorSlip({ errors: 0 })).toBe(false);
    });
  });

  describe('Session Word Queue Builder (buildSessionWords)', () => {
    it('prioritizes current week due words and mixes in due past-week words up to maxWords (10)', () => {
      // GIVEN default starter words (7 in Week 8, 9 in Week 7) all due on 2026-11-01 and a seeded PRNG
      const storage = createIsolatedStorage();
      const today = '2026-11-01';
      const allWords = loadWords(storage, today);
      const prng = createPRNG(42);

      // WHEN building a session queue with minWords=8, maxWords=10
      const session = buildSessionWords(allWords, 8, 10, { today, prng, storage });

      // THEN 10 unique words are selected: all 7 from Week 8 + 3 from Week 7
      expect(session).toHaveLength(10);
      const week8Picked = session.filter((w) => w.week_label === 'Week 8');
      const week7Picked = session.filter((w) => w.week_label === 'Week 7');
      expect(week8Picked).toHaveLength(7);
      expect(week7Picked).toHaveLength(3);
    });

    it('reserves up to 2 slots for overdue past-week words even when current week has >= 9 due words', () => {
      // GIVEN 10 due words in Week 9 (current week) and 3 due words in Week 8 (past week)
      const storage = createIsolatedStorage();
      const today = '2026-11-01';
      setCurrentWeekLabel('Week 9', storage);

      const words: WordRecord[] = [];
      for (let i = 1; i <= 10; i++) {
        words.push(normalizeWordRecord({ word: `cur${i}`, week_label: 'Week 9', box: 1, next_review: today }, 'Week 9', today));
      }
      for (let i = 1; i <= 3; i++) {
        words.push(normalizeWordRecord({ word: `past${i}`, week_label: 'Week 8', box: 1, next_review: today }, 'Week 8', today));
      }

      // WHEN building a 10-word session
      const session = buildSessionWords(words, 8, 10, { today, prng: createPRNG(7), storage });

      // THEN 8 current-week words and 2 reserved past-week words are included
      expect(session).toHaveLength(10);
      expect(session.filter((w) => w.week_label === 'Week 9')).toHaveLength(8);
      expect(session.filter((w) => w.week_label === 'Week 8')).toHaveLength(2);
    });

    it('tops up from non-due current week words then past week words when fewer than minWords (8) are due', () => {
      // GIVEN 6 words in Week 8 (only 2 due today, 4 due next week) and 4 words in Week 7 (none due today)
      const storage = createIsolatedStorage();
      const today = '2026-11-01';
      const future = '2026-11-10';
      setCurrentWeekLabel('Week 8', storage);

      const words: WordRecord[] = [
        normalizeWordRecord({ word: 'due1', week_label: 'Week 8', box: 1, next_review: today }, 'Week 8', today),
        normalizeWordRecord({ word: 'due2', week_label: 'Week 8', box: 1, next_review: today }, 'Week 8', today),
        normalizeWordRecord({ word: 'fut1', week_label: 'Week 8', box: 2, next_review: future }, 'Week 8', today),
        normalizeWordRecord({ word: 'fut2', week_label: 'Week 8', box: 3, next_review: future }, 'Week 8', today),
        normalizeWordRecord({ word: 'fut3', week_label: 'Week 8', box: 4, next_review: future }, 'Week 8', today),
        normalizeWordRecord({ word: 'fut4', week_label: 'Week 8', box: 5, next_review: future }, 'Week 8', today),
        normalizeWordRecord({ word: 'past1', week_label: 'Week 7', box: 2, next_review: future }, 'Week 7', today),
        normalizeWordRecord({ word: 'past2', week_label: 'Week 7', box: 3, next_review: future }, 'Week 7', today),
        normalizeWordRecord({ word: 'past3', week_label: 'Week 7', box: 4, next_review: future }, 'Week 7', today),
        normalizeWordRecord({ word: 'past4', week_label: 'Week 7', box: 5, next_review: future }, 'Week 7', today)
      ];

      // WHEN building a session with minWords=8, maxWords=10
      const session = buildSessionWords(words, 8, 10, { today, prng: createPRNG(99), storage });

      // THEN session tops up to 8 words: all 6 Week 8 words + the 2 lowest-box Week 7 words (past1, past2)
      expect(session).toHaveLength(8);
      const pickedNames = new Set(session.map((w) => w.word));
      expect(pickedNames.has('due1')).toBe(true);
      expect(pickedNames.has('due2')).toBe(true);
      expect(pickedNames.has('fut1')).toBe(true);
      expect(pickedNames.has('fut4')).toBe(true);
      expect(pickedNames.has('past1')).toBe(true);
      expect(pickedNames.has('past2')).toBe(true);
      expect(pickedNames.has('past3')).toBe(false);
    });

    it('builds a Quick Splash session with max 3 words and only due words when quickSplash is true', () => {
      // GIVEN 5 due words (3 Week 8, 2 Week 7) and 5 future words
      const storage = createIsolatedStorage();
      const today = '2026-11-01';
      const future = '2026-11-05';
      setCurrentWeekLabel('Week 8', storage);

      const words: WordRecord[] = [
        normalizeWordRecord({ word: 'w8_due1', week_label: 'Week 8', box: 1, next_review: today }, 'Week 8', today),
        normalizeWordRecord({ word: 'w8_due2', week_label: 'Week 8', box: 1, next_review: today }, 'Week 8', today),
        normalizeWordRecord({ word: 'w8_due3', week_label: 'Week 8', box: 1, next_review: today }, 'Week 8', today),
        normalizeWordRecord({ word: 'w7_due1', week_label: 'Week 7', box: 1, next_review: today }, 'Week 7', today),
        normalizeWordRecord({ word: 'w7_due2', week_label: 'Week 7', box: 1, next_review: today }, 'Week 7', today),
        normalizeWordRecord({ word: 'w8_fut1', week_label: 'Week 8', box: 2, next_review: future }, 'Week 8', today),
        normalizeWordRecord({ word: 'w8_fut2', week_label: 'Week 8', box: 3, next_review: future }, 'Week 8', today),
        normalizeWordRecord({ word: 'w7_fut1', week_label: 'Week 7', box: 2, next_review: future }, 'Week 7', today),
        normalizeWordRecord({ word: 'w7_fut2', week_label: 'Week 7', box: 3, next_review: future }, 'Week 7', today),
        normalizeWordRecord({ word: 'w7_fut3', week_label: 'Week 7', box: 4, next_review: future }, 'Week 7', today)
      ];

      // WHEN building with quickSplash: true
      const session = buildSessionWords(words, 8, 10, { today, quickSplash: true, storage });

      // THEN exactly 3 words are pulled, all are due today, and no future words are included
      expect(session).toHaveLength(3);
      for (const w of session) {
        expect(w.next_review <= today).toBe(true);
        expect(w.word.startsWith('w8_fut') || w.word.startsWith('w7_fut')).toBe(false);
      }
    });

    it('does NOT pad the queue in Quick Splash mode when fewer than 3 words are due', () => {
      // GIVEN words where only 2 are due today (and 6 are non-due)
      const storage = createIsolatedStorage();
      const today = '2026-11-01';
      const future = '2026-11-08';
      setCurrentWeekLabel('Week 8', storage);

      const wordsTwoDue: WordRecord[] = [
        normalizeWordRecord({ word: 'due1', week_label: 'Week 8', box: 1, next_review: today }, 'Week 8', today),
        normalizeWordRecord({ word: 'due2', week_label: 'Week 8', box: 2, next_review: today }, 'Week 8', today),
        normalizeWordRecord({ word: 'fut1', week_label: 'Week 8', box: 3, next_review: future }, 'Week 8', today),
        normalizeWordRecord({ word: 'fut2', week_label: 'Week 8', box: 4, next_review: future }, 'Week 8', today),
        normalizeWordRecord({ word: 'fut3', week_label: 'Week 8', box: 5, next_review: future }, 'Week 8', today),
        normalizeWordRecord({ word: 'fut4', week_label: 'Week 7', box: 2, next_review: future }, 'Week 7', today),
        normalizeWordRecord({ word: 'fut5', week_label: 'Week 7', box: 3, next_review: future }, 'Week 7', today),
        normalizeWordRecord({ word: 'fut6', week_label: 'Week 7', box: 4, next_review: future }, 'Week 7', today)
      ];

      // WHEN building Quick Splash session with only 2 words due
      const sessionTwo = buildSessionWords(wordsTwoDue, 8, 10, { today, quickSplash: true, storage });

      // THEN only the 2 due words are returned without any padding
      expect(sessionTwo).toHaveLength(2);
      expect(sessionTwo.map((w) => w.word).sort()).toEqual(['due1', 'due2']);

      // GIVEN words where only 1 is due today
      const wordsOneDue = [wordsTwoDue[0], ...wordsTwoDue.slice(2)];
      const sessionOne = buildSessionWords(wordsOneDue, 8, 10, { today, quickSplash: true, storage });
      expect(sessionOne).toHaveLength(1);
      expect(sessionOne[0].word).toBe('due1');

      // GIVEN words where 0 are due today
      const wordsNoneDue = wordsTwoDue.slice(2);
      const sessionZero = buildSessionWords(wordsNoneDue, 8, 10, { today, quickSplash: true, storage });
      expect(sessionZero).toHaveLength(0);
    });

    it('supports Quick Splash via options.mode = "quick" or "quickSplash"', () => {
      const storage = createIsolatedStorage();
      const today = '2026-11-01';
      const future = '2026-11-10';

      const words: WordRecord[] = [
        normalizeWordRecord({ word: 'dueA', week_label: 'Week 8', box: 1, next_review: today }, 'Week 8', today),
        normalizeWordRecord({ word: 'dueB', week_label: 'Week 8', box: 1, next_review: today }, 'Week 8', today),
        normalizeWordRecord({ word: 'dueC', week_label: 'Week 8', box: 1, next_review: today }, 'Week 8', today),
        normalizeWordRecord({ word: 'dueD', week_label: 'Week 8', box: 1, next_review: today }, 'Week 8', today),
        normalizeWordRecord({ word: 'futureA', week_label: 'Week 8', box: 2, next_review: future }, 'Week 8', today)
      ];

      const resMode1 = buildSessionWords(words, 8, 10, { today, mode: 'quickSplash', storage });
      const resMode2 = buildSessionWords(words, 8, 10, { today, mode: 'quick', storage });

      expect(resMode1).toHaveLength(3);
      expect(resMode2).toHaveLength(3);
      expect(resMode1.every((w) => w.next_review <= today)).toBe(true);
      expect(resMode2.every((w) => w.next_review <= today)).toBe(true);
    });
  });

  describe('Cloud Merge, Weekly Additions & Plausible Distractors', () => {
    it('preserves dirty offline SRS progress when merging remote Firestore records', () => {
      // GIVEN local storage where "câlin" was practiced offline (Box 2, streak 1) and marked dirty
      const storage = createIsolatedStorage();
      const today = '2026-11-01';
      loadWords(storage, today);
      recordFirstAttemptSRS('câlin', 0, { today, storage });

      const dirtySet = new Set(['câlin']);
      const remoteRows = [
        { word: 'câlin', week_label: 'Week 8', box: 1, streak: 0, total_attempts: 0, correct_attempts: 0, next_review: today },
        { word: 'nouveau', week_label: 'Week 9', box: 1, streak: 0, total_attempts: 0, correct_attempts: 0, next_review: today }
      ];

      // WHEN mergeWordsFromCloud runs
      const merged = mergeWordsFromCloud(remoteRows, dirtySet, 'Week 9', storage, today);

      // THEN "câlin" keeps its local Box 2 & streak 1 while "nouveau" is added and current week updates to Week 9
      const calin = merged.find((w) => w.word === 'câlin')!;
      const nouveau = merged.find((w) => w.word === 'nouveau')!;
      expect(calin.box).toBe(2);
      expect(calin.streak).toBe(1);
      expect(nouveau).toBeDefined();
      expect(getCurrentWeekLabel(merged, storage)).toBe('Week 9');
    });

    it('adds new weekly words and refreshes existing words to become immediately due in the new week', () => {
      // GIVEN initial storage on 2026-11-01 where "câlin" was scheduled for 2026-11-03
      const storage = createIsolatedStorage();
      const today = '2026-11-01';
      loadWords(storage, today);
      recordFirstAttemptSRS('câlin', 0, { today, storage });

      // WHEN adding a Week 9 list containing an existing word ("câlin") and a new word ("hibou")
      const res = addWeeklyWordList(
        ['câlin', { word: 'Hibou', custom_audio_url: 'https://example.com/hibou.mp3' }],
        'Week 9',
        { today, storage }
      );

      // THEN "câlin" preserves its Box 2 progress but moves to Week 9 and becomes due today, and "hibou" is created in Box 1
      expect(res.weekLabel).toBe('Week 9');
      expect(res.addedRecords).toHaveLength(2);
      const calin = res.allWords.find((w) => w.word === 'câlin')!;
      const hibou = res.allWords.find((w) => w.word === 'hibou')!;
      expect(calin.box).toBe(2);
      expect(calin.week_label).toBe('Week 9');
      expect(calin.next_review).toBe(today);
      expect(hibou.box).toBe(1);
      expect(hibou.custom_audio_url).toBe('https://example.com/hibou.mp3');
      expect(suggestNextWeekLabel(res.allWords, storage)).toBe('Week 10');
    });

    it('generates plausible distractors that strictly exclude requiredChar and include accents only when vocabulary has accents', () => {
      // GIVEN an unaccented vocabulary vs an accented vocabulary
      const plainVocab = [{ word: 'sans' }, { word: 'sortir' }];
      const accentedVocab = [{ word: 'câlin' }, { word: 'été' }];

      // WHEN generating distractors for requiredChar 'a'
      const plainDistractors = getPlausibleDistractors('a', 'sans', plainVocab);
      const accentedDistractors = getPlausibleDistractors('a', 'câlin', accentedVocab);

      // THEN 'a' is never present in either pool, plain pool has no accented characters, and accented pool includes 'â', 'à', etc.
      expect(plainDistractors).not.toContain('a');
      expect(plainDistractors.every((ch) => ch.charCodeAt(0) <= 127)).toBe(true);

      expect(accentedDistractors).not.toContain('a');
      expect(accentedDistractors).toContain('â');
      expect(accentedDistractors).toContain('é');
    });

    it('falls back to default starter words when removing the last remaining word from store', () => {
      // GIVEN a store with only a single word
      const storage = createIsolatedStorage();
      const today = '2026-11-01';
      saveWords([normalizeWordRecord({ word: 'seul' }, 'Week 1', today)], storage);

      // WHEN removing that last word
      const remaining = removeWordFromStore('seul', { today, storage });

      // THEN store re-seeds with the 16 default starter words
      expect(remaining).toHaveLength(16);
    });

    it('shuffles deterministically when given a seeded PRNG', () => {
      // GIVEN an array of items and two identically seeded PRNGs
      const input = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
      const prng1 = createPRNG(12345);
      const prng2 = createPRNG(12345);

      // WHEN shuffleGently is called with each PRNG
      const out1 = shuffleGently(input, prng1);
      const out2 = shuffleGently(input, prng2);

      // THEN both outputs are identical and contain the exact same elements
      expect(out1).toEqual(out2);
      expect([...out1].sort()).toEqual(input);
    });
  });

  describe('Default Curriculum Audio Mapping & Offline Fallback', () => {
    const expected16 = [
      'sans', 'suivre', 'savoir', 'sauter', 'semaine',
      'serpent', 'sortir', 'soleil', 'souvent',
      'câlin', 'singe', 'enfin', 'quinze', 'prince', 'loin', 'printemps'
    ];

    it('maps every default Week 7 and Week 8 word to its bundled audio asset', () => {
      for (const word of expected16) {
        const audioUrl = getDefaultAudioUrl(word);
        expect(audioUrl).toBe(`assets/audio/words/${word}.mp3`);
      }
      // Non-default word returns empty string
      expect(getDefaultAudioUrl('ordinateur')).toBe('');
      expect(getDefaultAudioUrl('')).toBe('');
    });

    it('populates custom_audio_url in getDefaultStarterWords()', () => {
      const starters = getDefaultStarterWords('2026-11-01');
      expect(starters).toHaveLength(16);
      for (const rec of starters) {
        expect(rec.custom_audio_url).toBe(`assets/audio/words/${rec.word}.mp3`);
      }
    });

    it('attaches default audio when loading legacy stored records that had empty custom_audio_url', () => {
      const storage = createIsolatedStorage();
      const legacyRaw = [
        { word: 'sans', custom_audio_url: '' },
        { word: 'câlin', custom_audio_url: '' },
        { word: 'bonjour', custom_audio_url: '' }
      ];
      storage.setItem('hottub_srs_words_v2', JSON.stringify(legacyRaw));

      const loaded = loadWords(storage, '2026-11-01', 'daughter');
      const sans = loaded.find((w) => w.word === 'sans');
      const calin = loaded.find((w) => w.word === 'câlin');
      const bonjour = loaded.find((w) => w.word === 'bonjour');

      expect(sans?.custom_audio_url).toBe('assets/audio/words/sans.mp3');
      expect(calin?.custom_audio_url).toBe('assets/audio/words/câlin.mp3');
      expect(bonjour?.custom_audio_url).toBe(''); // Non-starter word stays empty
    });

    it('attaches default audio in mergeWordsFromCloud when remote records have empty custom_audio_url', () => {
      const storage = createIsolatedStorage();
      const remoteRows = [
        { word: 'soleil', box: 2, custom_audio_url: '' },
        { word: 'singe', box: 3, custom_audio_url: 'https://example.com/custom.mp3' }
      ];

      const merged = mergeWordsFromCloud(remoteRows, new Set(), 'Week 8', storage, '2026-11-01', 'daughter');
      const soleil = merged.find((w) => w.word === 'soleil');
      const singe = merged.find((w) => w.word === 'singe');

      // soleil was missing custom_audio_url in Firestore, so it gets the bundled sound
      expect(soleil?.custom_audio_url).toBe('assets/audio/words/soleil.mp3');
      // singe had an explicit custom url, so it is preserved
      expect(singe?.custom_audio_url).toBe('https://example.com/custom.mp3');
    });
  });
});
