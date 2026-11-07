// @vitest-environment happy-dom
/**
 * Executable Behavioral Specification: Multi-Account Family Profiles (Zoé, Brigitte, Eric)
 *
 * Step-by-Step Implementation Blueprint for Agents:
 * 1. Authorized Emails (`js/auth.js`):
 *    - Add `'bbouhana@gmail.com'` and `'scherparis@gmail.com'` to `DEFAULT_ALLOWED_LABELS`.
 *    - Add their SHA-256 hashes to `DEFAULT_ALLOWED_EMAIL_HASHES`:
 *      - `bbouhana@gmail.com`: `'372ea2e80c05f64c99c13df05bdb3ea9deec8c8e8cd9d3af037d11b9346d2e2e'`
 *      - `scherparis@gmail.com`: `'55f9e374edfff96d44bec2e00cc8fe27f75c7296d29fae0b1c73c3a32f301dee'`
 *    - `'scher.jonathan@gmail.com'` remains for Zoé (`'daughter'`).
 * 2. Distinct Account/Profile Mapping (`js/srs.js` & `js/auth.js`):
 *    - Export `getProfileForEmail(email, customStorage)` in `js/srs.js` (and `authManager.getProfileIdForEmail(email)` in `js/auth.js`):
 *      - `'scher.jonathan@gmail.com'` -> `{ id: 'daughter', name: 'Zoé', isTest: false, avatar: '👧', trapHistory: ... }`
 *      - `'bbouhana@gmail.com'`       -> `{ id: 'brigitte', name: 'Brigitte', isTest: false, avatar: '👩', trapHistory: ... }`
 *      - `'scherparis@gmail.com'`     -> `{ id: 'eric', name: 'Eric', isTest: false, avatar: '👨', trapHistory: ... }`
 *    - When a user signs in via Firebase Auth (`_handleFirebaseUser` in `js/auth.js`), set `session.profileId`
 *      and automatically activate that profile via `setActiveProfileId(profileId)`.
 *    - Ensure `getActiveProfile(customStorage)` resolves `'daughter'` (Zoé), `'brigitte'` (Brigitte),
 *      `'eric'` (Eric), and `'test'` (Test / Sandbox).
 *    - Keep `DEFAULT_PROFILES` as `[daughter, test]` when unauthenticated so existing specs in `profiles.spec.ts` pass unchanged.
 * 3. Strict Isolation & Non-Destructive Zoé Protection (`js/srs.js`, `js/sync.js`, `js/app.js`):
 *    - Vocabulary word lists are shared across accounts, but SRS stats (Leitner boxes, streaks, attempts, next_review),
 *      cosmetic stars (`hottub_stars_<profileId>`), and personal trap error histories (`trapHistory`) are 100% isolated per profile (`daughter`, `brigitte`, `eric`, `test`).
 *    - Support `'brigitte'` and `'eric'` in `recordTrapError`, `getProfileTrapHistory`, `resetProfileProgress`, `mergeProfilesFromCloud`, and `mergeWordsFromCloud`.
 *    - Namespace dirty word queues (`_loadDirtyMap` / `_saveDirtyMap` in `js/sync.js`) and dirty trap history keys
 *      (`markProfileTrapHistoryDirty` / `getDirtyProfileTrapHistory` / `clearDirtyProfileTrapHistory` in `js/srs.js`)
 *      per profile so `'brigitte'` and `'eric'` never collide with `'daughter'`.
 *    - Cloud Firestore sync (`flushPendingChanges`, `mergeWordsFromCloud`, `mergeProfilesFromCloud`) must read/write
 *      `profiles.brigitte` and `profiles.eric` on `words/{wordId}` and `metadata/app_state` with `{ merge: true }`
 *      without overwriting root fields or `profiles.daughter` (Zoé's statistics).
 *    - Remove the destructive `resetProfileProgress('daughter')` call inside `checkAndApplyZoeReset()` in `js/app.js`
 *      so app initialization/updates NEVER reset Zoé's existing local or cloud progress.
 * 4. Typecheck Cleanliness (`npx tsc --noEmit`):
 *    - Ensure JSDoc annotations in `js/srs.js` (`saveProfiles` / `getActiveProfileId`) and `js/game.js` (`this.options` / `onTrapError`) pass `npx tsc --noEmit`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { authManager, sha256Hex } from '../../js/auth.js';
import { syncManager } from '../../js/sync.js';
import {
  setMockAuthUser,
  resetMockFirebase,
  mockFirestoreData
} from '../mocks/firebase-mock.js';
import * as srsModule from '../../js/srs.js';
import {
  clearMemoryStorage,
  loadWords,
  saveWords,
  recordFirstAttemptSRS,
  addWeeklyWordList,
  getActiveProfileId,
  getActiveProfile,
  setActiveProfileId,
  resetProfileProgress,
  getProfileStatsSummary,
  mergeWordsFromCloud,
  mergeProfilesFromCloud,
  recordTrapError,
  getProfileTrapHistory,
  getCosmeticStars,
  awardCosmeticStars,
  normalizeWordRecord,
  WORDS_STORAGE_KEY,
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

describe('Multi-Account Family Profiles: Zoé, Brigitte & Eric (Executable Specification)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearMemoryStorage();
    localStorage.clear();
    resetMockFirebase();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('1. Family Email Allowlist & Automatic Account-to-Profile Binding', () => {
    it('authorizes bbouhana@gmail.com (Brigitte), scherparis@gmail.com (Eric), and scher.jonathan@gmail.com (Zoé) by default', () => {
      // GIVEN default AuthManager configuration
      const defaultEmails = authManager.getDefaultAllowedEmails();

      // THEN all three accounts are present in default allowed emails
      expect(defaultEmails).toContain('scher.jonathan@gmail.com');
      expect(defaultEmails).toContain('bbouhana@gmail.com');
      expect(defaultEmails).toContain('scherparis@gmail.com');

      // AND isEmailAllowed validates them (case-insensitive and trimmed) via SHA-256 allowlist
      expect(sha256Hex('bbouhana@gmail.com')).toHaveLength(64);
      expect(sha256Hex('scherparis@gmail.com')).toHaveLength(64);
      expect(authManager.isEmailAllowed('scher.jonathan@gmail.com')).toBe(true);
      expect(authManager.isEmailAllowed('bbouhana@gmail.com')).toBe(true);
      expect(authManager.isEmailAllowed('  BBouhana@gmail.com ')).toBe(true);
      expect(authManager.isEmailAllowed('scherparis@gmail.com')).toBe(true);
      expect(authManager.isEmailAllowed(' ScherParis@Gmail.com ')).toBe(true);

      // AND unauthorized external emails remain rejected
      expect(authManager.isEmailAllowed('intruder@gmail.com')).toBe(false);
    });

    it('maps each family email to its distinct learner profile (Zoé -> daughter, Brigitte -> brigitte, Eric -> eric)', () => {
      // GIVEN the profile resolver helper in srs.js
      const getProfileForEmail = (srsModule as any).getProfileForEmail as
        | ((email: string, storage?: StorageLike) => { id: string; name: string; isTest: boolean; avatar: string })
        | undefined;

      expect(typeof getProfileForEmail).toBe('function');

      // WHEN resolving profiles for Zoé, Brigitte, and Eric
      const zoeProf = getProfileForEmail!('scher.jonathan@gmail.com');
      const brigitteProf = getProfileForEmail!('bbouhana@gmail.com');
      const ericProf = getProfileForEmail!('scherparis@gmail.com');

      // THEN each email maps to a distinct non-test profile ID and display name
      expect(zoeProf.id).toBe('daughter');
      expect(zoeProf.name).toBe('Zoé');
      expect(zoeProf.isTest).toBe(false);

      expect(brigitteProf.id).toBe('brigitte');
      expect(brigitteProf.name).toBe('Brigitte');
      expect(brigitteProf.isTest).toBe(false);

      expect(ericProf.id).toBe('eric');
      expect(ericProf.name).toBe('Eric');
      expect(ericProf.isTest).toBe(false);
    });

    it('automatically switches the active learner profile when signing in with Zoé, Brigitte, or Eric Google accounts', async () => {
      // GIVEN Brigitte signs in with bbouhana@gmail.com
      setMockAuthUser({
        uid: 'uid_brigitte',
        email: 'bbouhana@gmail.com',
        displayName: 'Brigitte Bouhana'
      });
      await authManager.signInWithGoogle();

      // THEN Brigitte is authenticated and active profile is automatically set to "brigitte"
      expect(authManager.isAuthenticated()).toBe(true);
      expect((authManager.getSession() as any)?.profileId).toBe('brigitte');
      expect(getActiveProfileId()).toBe('brigitte');
      expect(getActiveProfile().id).toBe('brigitte');
      expect(getActiveProfile().name).toBe('Brigitte');

      // WHEN Eric signs in with scherparis@gmail.com
      await authManager.signOut();
      setMockAuthUser({
        uid: 'uid_eric',
        email: 'scherparis@gmail.com',
        displayName: 'Eric Scher'
      });
      await authManager.signInWithGoogle();

      // THEN Eric is authenticated and active profile is automatically set to "eric"
      expect(authManager.isAuthenticated()).toBe(true);
      expect((authManager.getSession() as any)?.profileId).toBe('eric');
      expect(getActiveProfileId()).toBe('eric');
      expect(getActiveProfile().id).toBe('eric');
      expect(getActiveProfile().name).toBe('Eric');

      // WHEN Zoé's account (scher.jonathan@gmail.com) signs in
      await authManager.signOut();
      setMockAuthUser({
        uid: 'uid_zoe',
        email: 'scher.jonathan@gmail.com',
        displayName: 'Jonathan Scher'
      });
      await authManager.signInWithGoogle();

      // THEN active profile is automatically set to "daughter" (Zoé)
      expect(authManager.isAuthenticated()).toBe(true);
      expect((authManager.getSession() as any)?.profileId).toBe('daughter');
      expect(getActiveProfileId()).toBe('daughter');
      expect(getActiveProfile().id).toBe('daughter');
      expect(getActiveProfile().name).toBe('Zoé');
    });
  });

  describe('2. Strict Isolation of Statistics Between Zoé, Brigitte, and Eric', () => {
    it('shares the vocabulary word list while keeping Leitner boxes, streaks, attempts, and review dates 100% distinct per account', () => {
      // GIVEN isolated storage where Zoé ("daughter") has existing progress on "câlin" (Box 3, streak 2)
      const storage = createIsolatedStorage();
      const today = '2026-11-01';
      loadWords(storage, today, 'daughter');
      recordFirstAttemptSRS('câlin', 0, { storage, today: '2026-11-01', profileId: 'daughter' });
      recordFirstAttemptSRS('câlin', 0, { storage, today: '2026-11-03', profileId: 'daughter' });

      const zoeBefore = loadWords(storage, '2026-11-03', 'daughter').find((w) => w.word === 'câlin')!;
      expect(zoeBefore.box).toBe(3);
      expect(zoeBefore.streak).toBe(2);
      expect(zoeBefore.total_attempts).toBe(2);

      // WHEN Brigitte ("brigitte") loads words and practices "câlin" (1st attempt spotless -> Box 2) and "singe" (error -> Box 1)
      const brigitteInitial = loadWords(storage, '2026-11-03', 'brigitte');
      expect(brigitteInitial.find((w) => w.word === 'câlin')!.box).toBe(1);
      expect(brigitteInitial.find((w) => w.word === 'câlin')!.total_attempts).toBe(0);

      recordFirstAttemptSRS('câlin', 0, { storage, today: '2026-11-03', profileId: 'brigitte' });
      recordFirstAttemptSRS('singe', 2, { storage, today: '2026-11-03', profileId: 'brigitte' });

      // AND Eric ("eric") practices "soleil" (spotless -> Box 2) but makes 2 errors on "câlin" (-> Box 1)
      recordFirstAttemptSRS('soleil', 0, { storage, today: '2026-11-03', profileId: 'eric' });
      recordFirstAttemptSRS('câlin', 2, { storage, today: '2026-11-03', profileId: 'eric' });

      // THEN Zoé's stats on "câlin", "singe", and "soleil" are 100% untouched
      const zoeWords = loadWords(storage, '2026-11-03', 'daughter');
      expect(zoeWords.find((w) => w.word === 'câlin')!.box).toBe(3);
      expect(zoeWords.find((w) => w.word === 'câlin')!.streak).toBe(2);
      expect(zoeWords.find((w) => w.word === 'câlin')!.total_attempts).toBe(2);
      expect(zoeWords.find((w) => w.word === 'singe')!.total_attempts).toBe(0);
      expect(zoeWords.find((w) => w.word === 'soleil')!.total_attempts).toBe(0);

      // AND Brigitte has her own independent stats
      const brigitteWords = loadWords(storage, '2026-11-03', 'brigitte');
      expect(brigitteWords.find((w) => w.word === 'câlin')!.box).toBe(2);
      expect(brigitteWords.find((w) => w.word === 'câlin')!.total_attempts).toBe(1);
      expect(brigitteWords.find((w) => w.word === 'singe')!.box).toBe(1);
      expect(brigitteWords.find((w) => w.word === 'singe')!.total_attempts).toBe(1);
      expect(brigitteWords.find((w) => w.word === 'soleil')!.total_attempts).toBe(0);

      // AND Eric has his own independent stats
      const ericWords = loadWords(storage, '2026-11-03', 'eric');
      expect(ericWords.find((w) => w.word === 'câlin')!.box).toBe(1);
      expect(ericWords.find((w) => w.word === 'câlin')!.total_attempts).toBe(1);
      expect(ericWords.find((w) => w.word === 'soleil')!.box).toBe(2);
      expect(ericWords.find((w) => w.word === 'soleil')!.total_attempts).toBe(1);
      expect(ericWords.find((w) => w.word === 'singe')!.total_attempts).toBe(0);
    });

    it('isolates cosmetic stars, personal error trapHistory, and profile resets across Zoé, Brigitte, and Eric', () => {
      // GIVEN Zoé, Brigitte, and Eric each earn stars and make different category errors
      const storage = createIsolatedStorage();
      const today = '2026-11-01';

      recordFirstAttemptSRS('câlin', 0, { storage, today, profileId: 'daughter' });
      recordFirstAttemptSRS('câlin', 0, { storage, today, profileId: 'brigitte' });
      recordFirstAttemptSRS('câlin', 0, { storage, today, profileId: 'eric' });

      awardCosmeticStars(4, 'daughter', storage);
      awardCosmeticStars(2, 'brigitte', storage);
      awardCosmeticStars(7, 'eric', storage);

      recordTrapError('silent finals', { profileId: 'daughter', storage });
      recordTrapError('silent finals', { profileId: 'daughter', storage });
      recordTrapError('b/d/p/q flips', { profileId: 'brigitte', storage });
      recordTrapError('nasal vowels', { profileId: 'eric', storage });
      recordTrapError('nasal vowels', { profileId: 'eric', storage });
      recordTrapError('nasal vowels', { profileId: 'eric', storage });

      // THEN stars and trap histories are completely distinct per account
      expect(getCosmeticStars('daughter', storage)).toBe(4);
      expect(getCosmeticStars('brigitte', storage)).toBe(2);
      expect(getCosmeticStars('eric', storage)).toBe(7);

      expect(getProfileTrapHistory('daughter', storage)['silent finals']).toBe(2);
      expect(getProfileTrapHistory('daughter', storage)['b/d/p/q flips']).toBeUndefined();
      expect(getProfileTrapHistory('brigitte', storage)['b/d/p/q flips']).toBe(1);
      expect(getProfileTrapHistory('brigitte', storage)['silent finals']).toBeUndefined();
      expect(getProfileTrapHistory('eric', storage)['nasal vowels']).toBe(3);

      // WHEN resetting Brigitte's profile progress
      resetProfileProgress('brigitte', storage, today);

      // THEN Brigitte's words and trapHistory are reset to clean state
      expect(loadWords(storage, today, 'brigitte').find((w) => w.word === 'câlin')!.box).toBe(1);
      expect(getProfileTrapHistory('brigitte', storage)).toEqual({});

      // AND Zoé's and Eric's word progress and trapHistory remain 100% preserved
      expect(loadWords(storage, today, 'daughter').find((w) => w.word === 'câlin')!.box).toBe(2);
      expect(getProfileTrapHistory('daughter', storage)['silent finals']).toBe(2);
      expect(loadWords(storage, today, 'eric').find((w) => w.word === 'câlin')!.box).toBe(2);
      expect(getProfileTrapHistory('eric', storage)['nasal vowels']).toBe(3);
    });
  });

  describe('3. Cloud Firestore Multi-Account Sync & Non-Destructive Zoé Protection', () => {
    it('syncs Brigitte and Eric word updates and trapHistory under profiles.brigitte and profiles.eric without overwriting Zoé in Firestore', async () => {
      // GIVEN Zoé (scher.jonathan@gmail.com) has synced her progress (Box 4, streak 3) and trapHistory to Cloud Firestore
      setMockAuthUser({
        uid: 'uid_zoe',
        email: 'scher.jonathan@gmail.com',
        displayName: 'Zoé'
      });
      await authManager.signInWithGoogle();

      const zoeCalin = normalizeWordRecord(
        {
          word: 'câlin',
          week_label: 'Week 8',
          box: 4,
          streak: 3,
          total_attempts: 3,
          correct_attempts: 3,
          next_review: '2026-11-08'
        },
        'Week 8',
        '2026-11-01'
      );
      await syncManager.queueWordUpdate(zoeCalin, 'daughter');
      recordTrapError('silent finals', { profileId: 'daughter' });
      await syncManager.queueTrapHistoryUpdate('daughter');
      await syncManager.syncNow();

      expect(mockFirestoreData.get('words/câlin')?.box).toBe(4);
      expect(mockFirestoreData.get('words/câlin')?.profiles?.daughter?.box).toBe(4);

      // WHEN Brigitte (bbouhana@gmail.com) signs in, practices "câlin" (Box 2), records a trap error, and syncs
      await authManager.signOut();
      setMockAuthUser({
        uid: 'uid_brigitte',
        email: 'bbouhana@gmail.com',
        displayName: 'Brigitte'
      });
      await authManager.signInWithGoogle();
      expect(getActiveProfileId()).toBe('brigitte');

      const brigitteCalin = normalizeWordRecord(
        {
          word: 'câlin',
          week_label: 'Week 8',
          box: 2,
          streak: 1,
          total_attempts: 1,
          correct_attempts: 1,
          next_review: '2026-11-03'
        },
        'Week 8',
        '2026-11-01'
      );
      await syncManager.queueWordUpdate(brigitteCalin, 'brigitte');
      recordTrapError('b/d/p/q flips', { profileId: 'brigitte' });
      await syncManager.queueTrapHistoryUpdate('brigitte');
      await syncManager.syncNow();

      // AND WHEN Eric (scherparis@gmail.com) signs in, practices "câlin" (Box 1 after error), records a trap error, and syncs
      await authManager.signOut();
      setMockAuthUser({
        uid: 'uid_eric',
        email: 'scherparis@gmail.com',
        displayName: 'Eric'
      });
      await authManager.signInWithGoogle();
      expect(getActiveProfileId()).toBe('eric');

      const ericCalin = normalizeWordRecord(
        {
          word: 'câlin',
          week_label: 'Week 8',
          box: 1,
          streak: 0,
          total_attempts: 2,
          correct_attempts: 0,
          next_review: '2026-11-02'
        },
        'Week 8',
        '2026-11-01'
      );
      await syncManager.queueWordUpdate(ericCalin, 'eric');
      recordTrapError('accents', { profileId: 'eric' });
      await syncManager.queueTrapHistoryUpdate('eric');
      await syncManager.syncNow();

      // THEN Firestore document "words/câlin" holds all three isolated profiles without erasing Zoé's Box 4 progress
      const cloudWord = mockFirestoreData.get('words/câlin');
      expect(cloudWord).toBeDefined();
      expect(cloudWord.box).toBe(4);
      expect(cloudWord.profiles?.daughter?.box).toBe(4);
      expect(cloudWord.profiles?.daughter?.streak).toBe(3);
      expect(cloudWord.profiles?.brigitte?.box).toBe(2);
      expect(cloudWord.profiles?.brigitte?.streak).toBe(1);
      expect(cloudWord.profiles?.eric?.box).toBe(1);
      expect(cloudWord.profiles?.eric?.total_attempts).toBe(2);

      // AND Firestore "metadata/app_state" holds all three isolated trapHistory maps
      const cloudMeta = mockFirestoreData.get('metadata/app_state');
      expect(cloudMeta.profiles?.daughter?.trapHistory['silent finals']).toBe(1);
      expect(cloudMeta.profiles?.brigitte?.trapHistory['b/d/p/q flips']).toBe(1);
      expect(cloudMeta.profiles?.eric?.trapHistory['accents']).toBe(1);

      // AND WHEN syncing onto a brand new device (cleared localStorage), all three accounts restore their own exact stats
      localStorage.clear();
      clearMemoryStorage();
      await syncManager.syncNow();

      const restoredZoe = loadWords(undefined, '2026-11-01', 'daughter').find((w) => w.word === 'câlin')!;
      const restoredBrigitte = loadWords(undefined, '2026-11-01', 'brigitte').find((w) => w.word === 'câlin')!;
      const restoredEric = loadWords(undefined, '2026-11-01', 'eric').find((w) => w.word === 'câlin')!;

      expect(restoredZoe.box).toBe(4);
      expect(restoredZoe.streak).toBe(3);
      expect(restoredBrigitte.box).toBe(2);
      expect(restoredBrigitte.streak).toBe(1);
      expect(restoredEric.box).toBe(1);
      expect(restoredEric.total_attempts).toBe(2);

      expect(getProfileTrapHistory('daughter')['silent finals']).toBe(1);
      expect(getProfileTrapHistory('brigitte')['b/d/p/q flips']).toBe(1);
      expect(getProfileTrapHistory('eric')['accents']).toBe(1);
    });

    it('preserves Zoé existing statistics during app startup/update (does NOT reset daughter profile on DOMContentLoaded)', async () => {
      // GIVEN Zoé already has saved progress in localStorage (e.g. "câlin" at Box 4, streak 3, 3 attempts)
      // and the legacy reset flag "hottub_zoe_profile_reset_v1" is NOT set
      const today = '2026-11-01';
      const existingWords = loadWords(undefined, today, 'daughter').map((w) =>
        w.word === 'câlin'
          ? { ...w, box: 4, streak: 3, total_attempts: 3, correct_attempts: 3, next_review: '2026-11-08' }
          : w
      );
      saveWords(existingWords, undefined, 'daughter');
      localStorage.removeItem('hottub_zoe_profile_reset_v1');

      const rawHtml = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
      const sanitizedHtml = rawHtml.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, '');
      document.documentElement.innerHTML = sanitizedHtml;

      // WHEN the application initializes on DOMContentLoaded
      await import('../../js/app.js');
      document.dispatchEvent(new Event('DOMContentLoaded'));

      // THEN Zoé's statistics on "câlin" remain intact at Box 4 and are NOT wiped back to Box 1
      const zoeWordsAfterInit = loadWords(undefined, today, 'daughter');
      const calinAfterInit = zoeWordsAfterInit.find((w) => w.word === 'câlin')!;
      expect(calinAfterInit.box).toBe(4);
      expect(calinAfterInit.streak).toBe(3);
      expect(calinAfterInit.total_attempts).toBe(3);
      expect(calinAfterInit.correct_attempts).toBe(3);
      expect(calinAfterInit.next_review).toBe('2026-11-08');
    });
  });

  describe('4. Welcome Screen Profile Selector for Connected Account', () => {
    it('displays Brigitte and Test profiles on the welcome screen when Brigitte signs in (not Zoé)', async () => {
      // GIVEN application initialized on welcome screen
      const rawHtml = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
      const sanitizedHtml = rawHtml.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, '');
      document.documentElement.innerHTML = sanitizedHtml;

      await import('../../js/app.js');
      document.dispatchEvent(new Event('DOMContentLoaded'));

      // WHEN Brigitte signs in with bbouhana@gmail.com
      setMockAuthUser({
        uid: 'uid_brigitte',
        email: 'bbouhana@gmail.com',
        displayName: 'Brigitte Bouhana'
      });
      await authManager.signInWithGoogle();

      // THEN the welcome profile buttons offer the choice between Brigitte and Test
      const btnBrigitte = document.querySelector(
        '#welcome-profile-selector button[data-profile-id="brigitte"]'
      ) as HTMLButtonElement | null;
      const btnTest = document.querySelector(
        '#welcome-profile-selector button[data-profile-id="test"]'
      ) as HTMLButtonElement | null;
      const btnDaughter = document.querySelector(
        '#welcome-profile-selector button[data-profile-id="daughter"]'
      ) as HTMLButtonElement | null;

      expect(btnBrigitte).not.toBeNull();
      expect(btnBrigitte?.textContent).toContain('Brigitte');
      expect(btnBrigitte?.classList.contains('is-active')).toBe(true);

      expect(btnTest).not.toBeNull();
      expect(btnTest?.textContent).toContain('Test');

      // AND Zoé's profile is NOT displayed for Brigitte
      expect(btnDaughter).toBeNull();
    });

    it('displays Eric and Test profiles on the welcome screen when Eric signs in (not Zoé)', async () => {
      // GIVEN application initialized on welcome screen
      const rawHtml = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
      const sanitizedHtml = rawHtml.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, '');
      document.documentElement.innerHTML = sanitizedHtml;

      await import('../../js/app.js');
      document.dispatchEvent(new Event('DOMContentLoaded'));

      // WHEN Eric signs in with scherparis@gmail.com
      setMockAuthUser({
        uid: 'uid_eric',
        email: 'scherparis@gmail.com',
        displayName: 'Eric Scher'
      });
      await authManager.signInWithGoogle();

      // THEN the welcome profile buttons offer the choice between Eric and Test
      const btnEric = document.querySelector(
        '#welcome-profile-selector button[data-profile-id="eric"]'
      ) as HTMLButtonElement | null;
      const btnTest = document.querySelector(
        '#welcome-profile-selector button[data-profile-id="test"]'
      ) as HTMLButtonElement | null;
      const btnDaughter = document.querySelector(
        '#welcome-profile-selector button[data-profile-id="daughter"]'
      ) as HTMLButtonElement | null;

      expect(btnEric).not.toBeNull();
      expect(btnEric?.textContent).toContain('Eric');
      expect(btnEric?.classList.contains('is-active')).toBe(true);

      expect(btnTest).not.toBeNull();
      expect(btnTest?.textContent).toContain('Test');

      // AND Zoé's profile is NOT displayed for Eric
      expect(btnDaughter).toBeNull();
    });

    it('displays Zoé and Test profiles on the welcome screen when Zoé signs in (not Brigitte or Eric)', async () => {
      // GIVEN application initialized on welcome screen
      const rawHtml = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
      const sanitizedHtml = rawHtml.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, '');
      document.documentElement.innerHTML = sanitizedHtml;

      await import('../../js/app.js');
      document.dispatchEvent(new Event('DOMContentLoaded'));

      // WHEN Zoé signs in with scher.jonathan@gmail.com
      setMockAuthUser({
        uid: 'uid_zoe',
        email: 'scher.jonathan@gmail.com',
        displayName: 'Zoé Scher'
      });
      await authManager.signInWithGoogle();

      // THEN the welcome profile buttons offer the choice between Zoé and Test
      const btnDaughter = document.querySelector(
        '#welcome-profile-selector button[data-profile-id="daughter"]'
      ) as HTMLButtonElement | null;
      const btnTest = document.querySelector(
        '#welcome-profile-selector button[data-profile-id="test"]'
      ) as HTMLButtonElement | null;
      const btnBrigitte = document.querySelector(
        '#welcome-profile-selector button[data-profile-id="brigitte"]'
      ) as HTMLButtonElement | null;
      const btnEric = document.querySelector(
        '#welcome-profile-selector button[data-profile-id="eric"]'
      ) as HTMLButtonElement | null;

      expect(btnDaughter).not.toBeNull();
      expect(btnDaughter?.textContent).toContain('Zoé');
      expect(btnDaughter?.classList.contains('is-active')).toBe(true);

      expect(btnTest).not.toBeNull();
      expect(btnTest?.textContent).toContain('Test');

      // AND Brigitte and Eric are NOT displayed for Zoé
      expect(btnBrigitte).toBeNull();
      expect(btnEric).toBeNull();
    });
  });
});
