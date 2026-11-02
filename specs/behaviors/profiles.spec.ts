import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearMemoryStorage,
  getStorage,
  loadWords,
  saveWords,
  recordFirstAttemptSRS,
  addWeeklyWordList,
  removeWordFromStore,
  getProfiles,
  getActiveProfileId,
  getActiveProfile,
  setActiveProfileId,
  updateProfileName,
  resetProfileProgress,
  getProfileStatsSummary,
  mergeWordsFromCloud,
  DEFAULT_PROFILES,
  type StorageLike
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

describe('Learner Profiles & Test Isolation (js/srs.js)', () => {
  beforeEach(() => {
    clearMemoryStorage();
  });

  describe('Profile Metadata & Defaults', () => {
    it('initializes with default daughter and test profiles, defaulting active profile to daughter in production', () => {
      // GIVEN fresh storage
      const storage = createIsolatedStorage();

      // WHEN retrieving profiles and active profile
      const profiles = getProfiles(storage);
      const activeId = getActiveProfileId(storage);
      const activeProfile = getActiveProfile(storage);

      // THEN default profiles exist and daughter is active
      expect(profiles).toHaveLength(2);
      expect(profiles[0]).toEqual({
        id: 'daughter',
        name: 'Zoé',
        isTest: false,
        avatar: '👧'
      });
      expect(profiles[1]).toEqual({
        id: 'test',
        name: 'Test / Sandbox',
        isTest: true,
        avatar: '🧪'
      });
      expect(activeId).toBe('daughter');
      expect(activeProfile.id).toBe('daughter');
    });

    it('persists profile switching and profile renaming', () => {
      // GIVEN storage with default profile
      const storage = createIsolatedStorage();
      expect(getActiveProfileId(storage)).toBe('daughter');

      // WHEN switching to test profile
      setActiveProfileId('test', storage);

      // THEN active profile becomes test
      expect(getActiveProfileId(storage)).toBe('test');
      expect(getActiveProfile(storage).id).toBe('test');

      // WHEN renaming daughter profile to child’s actual name
      updateProfileName('daughter', 'Maya', storage);
      const updatedProfiles = getProfiles(storage);
      const daughterProfile = updatedProfiles.find((p) => p.id === 'daughter')!;

      // THEN display name reflects the new custom name
      expect(daughterProfile.name).toBe('Maya');
    });
  });

  describe('SRS Progress Isolation between Profiles', () => {
    it('isolates Leitner boxes, streaks, and attempts: practicing in test profile does NOT alter daughter data', () => {
      // GIVEN storage seeded with words for both profiles
      const storage = createIsolatedStorage();
      const today = '2026-11-01';

      // Load starter words in daughter profile (all start at Box 1, attempts: 0)
      const daughterInitial = loadWords(storage, today, 'daughter');
      const targetWord = 'câlin';
      const daughterCalinBefore = daughterInitial.find((w) => w.word === targetWord)!;
      expect(daughterCalinBefore.box).toBe(1);
      expect(daughterCalinBefore.total_attempts).toBe(0);

      // WHEN practicing and mastering the word in the test profile
      setActiveProfileId('test', storage);
      const testUpdate1 = recordFirstAttemptSRS(targetWord, 0, { storage, today, profileId: 'test' });
      expect(testUpdate1).not.toBeNull();
      expect(testUpdate1!.box).toBe(2);
      expect(testUpdate1!.streak).toBe(1);
      expect(testUpdate1!.total_attempts).toBe(1);

      // Practice again with 0 errors on next review day (+2 days = Box 3)
      const day3 = '2026-11-03';
      const testUpdate2 = recordFirstAttemptSRS(targetWord, 0, { storage, today: day3, profileId: 'test' });
      expect(testUpdate2!.box).toBe(3);
      expect(testUpdate2!.streak).toBe(2);
      expect(testUpdate2!.total_attempts).toBe(2);

      // THEN loading test profile reflects advanced progression
      const testWords = loadWords(storage, day3, 'test');
      const testCalin = testWords.find((w) => w.word === targetWord)!;
      expect(testCalin.box).toBe(3);
      expect(testCalin.streak).toBe(2);
      expect(testCalin.total_attempts).toBe(2);

      // BUT daughter profile remains strictly untouched at Box 1 and 0 attempts
      const daughterWords = loadWords(storage, day3, 'daughter');
      const daughterCalin = daughterWords.find((w) => w.word === targetWord)!;
      expect(daughterCalin.box).toBe(1);
      expect(daughterCalin.streak).toBe(0);
      expect(daughterCalin.total_attempts).toBe(0);
      expect(daughterCalin.next_review).toBe(today);
    });

    it('allows resetting test profile stats without altering daughter stats', () => {
      // GIVEN storage with progress in both profiles
      const storage = createIsolatedStorage();
      const today = '2026-11-01';

      // Advance a word in daughter profile
      recordFirstAttemptSRS('singe', 0, { storage, today, profileId: 'daughter' });
      const daughterSinge = loadWords(storage, today, 'daughter').find((w) => w.word === 'singe')!;
      expect(daughterSinge.box).toBe(2);
      expect(daughterSinge.total_attempts).toBe(1);

      // Advance several words in test profile
      recordFirstAttemptSRS('prince', 0, { storage, today, profileId: 'test' });
      recordFirstAttemptSRS('loin', 0, { storage, today, profileId: 'test' });
      const testPrinceBefore = loadWords(storage, today, 'test').find((w) => w.word === 'prince')!;
      expect(testPrinceBefore.box).toBe(2);

      // WHEN resetting test profile progress
      const refreshedTest = resetProfileProgress('test', storage, today);

      // THEN all words in test profile reset to Box 1, 0 attempts, due today
      expect(refreshedTest.every((w) => w.box === 1 && w.total_attempts === 0)).toBe(true);
      const testPrinceAfter = refreshedTest.find((w) => w.word === 'prince')!;
      expect(testPrinceAfter.box).toBe(1);
      expect(testPrinceAfter.total_attempts).toBe(0);

      // AND daughter profile progress remains preserved
      const daughterSingeAfter = loadWords(storage, today, 'daughter').find((w) => w.word === 'singe')!;
      expect(daughterSingeAfter.box).toBe(2);
      expect(daughterSingeAfter.total_attempts).toBe(1);
    });
  });

  describe('Shared Curriculum with Profile Independence', () => {
    it('shares newly added weekly words across both profiles while tracking SRS separately', () => {
      // GIVEN storage with starter words
      const storage = createIsolatedStorage();
      const today = '2026-11-01';

      // WHEN adding a new week list
      addWeeklyWordList(['papillon', 'étoile'], 'Week 9', { storage, today });

      // THEN the new words are present in both daughter and test profiles
      const daughterWords = loadWords(storage, today, 'daughter');
      const testWords = loadWords(storage, today, 'test');

      expect(daughterWords.some((w) => w.word === 'papillon' && w.week_label === 'Week 9')).toBe(true);
      expect(testWords.some((w) => w.word === 'papillon' && w.week_label === 'Week 9')).toBe(true);
      expect(daughterWords.some((w) => w.word === 'étoile' && w.week_label === 'Week 9')).toBe(true);
      expect(testWords.some((w) => w.word === 'étoile' && w.week_label === 'Week 9')).toBe(true);

      // WHEN practicing 'papillon' in test profile only
      recordFirstAttemptSRS('papillon', 0, { storage, today, profileId: 'test' });

      // THEN test profile advances, but daughter profile remains at Box 1
      const testPapillon = loadWords(storage, today, 'test').find((w) => w.word === 'papillon')!;
      const daughterPapillon = loadWords(storage, today, 'daughter').find((w) => w.word === 'papillon')!;
      expect(testPapillon.box).toBe(2);
      expect(testPapillon.total_attempts).toBe(1);
      expect(daughterPapillon.box).toBe(1);
      expect(daughterPapillon.total_attempts).toBe(0);

      // WHEN removing an accidental typo word
      removeWordFromStore('papillon', { storage, today });
      const daughterAfterRemove = loadWords(storage, today, 'daughter');
      const testAfterRemove = loadWords(storage, today, 'test');
      expect(daughterAfterRemove.some((w) => w.word === 'papillon')).toBe(false);
      expect(testAfterRemove.some((w) => w.word === 'papillon')).toBe(false);
    });

    it('summarizes stats accurately per profile independently', () => {
      // GIVEN storage with starter words
      const storage = createIsolatedStorage();
      const today = '2026-11-01';

      // Daughter profile: 16 total, 16 due, 0 mastered
      const daughterSummary1 = getProfileStatsSummary('daughter', storage, today);
      expect(daughterSummary1.totalWords).toBe(16);
      expect(daughterSummary1.dueWords).toBe(16);
      expect(daughterSummary1.masteredWords).toBe(0);

      // Practice 'singe' with 0 errors in daughter profile -> next review tomorrow
      recordFirstAttemptSRS('singe', 0, { storage, today, profileId: 'daughter' });

      const daughterSummary2 = getProfileStatsSummary('daughter', storage, today);
      expect(daughterSummary2.dueWords).toBe(15); // 'singe' no longer due today

      // Test profile was untouched -> still 16 due today
      const testSummary = getProfileStatsSummary('test', storage, today);
      expect(testSummary.dueWords).toBe(16);
    });
  });

  describe('Cloud Merge Multi-Profile Synchronization', () => {
    it('merges remote rows containing isolated profiles maps correctly', () => {
      // GIVEN storage and remote documents with profiles data
      const storage = createIsolatedStorage();
      const today = '2026-11-01';

      const remoteRows = [
        {
          word: 'câlin',
          week_label: 'Week 8',
          active: true,
          box: 4,
          next_review: '2026-11-08',
          streak: 3,
          total_attempts: 3,
          correct_attempts: 3,
          profiles: {
            daughter: {
              box: 4,
              next_review: '2026-11-08',
              streak: 3,
              total_attempts: 3,
              correct_attempts: 3
            },
            test: {
              box: 2,
              next_review: '2026-11-03',
              streak: 1,
              total_attempts: 1,
              correct_attempts: 1
            }
          }
        }
      ];

      // WHEN merging cloud data
      mergeWordsFromCloud(remoteRows, new Set(), 'Week 8', storage, today, 'daughter');

      // THEN daughter profile loads Box 4 from cloud
      const daughterWords = loadWords(storage, today, 'daughter');
      const daughterCalin = daughterWords.find((w) => w.word === 'câlin')!;
      expect(daughterCalin.box).toBe(4);
      expect(daughterCalin.next_review).toBe('2026-11-08');

      // AND test profile loads Box 2 from cloud profiles.test map
      const testWords = loadWords(storage, today, 'test');
      const testCalin = testWords.find((w) => w.word === 'câlin')!;
      expect(testCalin.box).toBe(2);
      expect(testCalin.next_review).toBe('2026-11-03');
    });
  });
});
