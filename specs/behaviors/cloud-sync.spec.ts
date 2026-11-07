// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { authManager } from '../../js/auth.js';
import { syncManager } from '../../js/sync.js';
import {
  setMockAuthUser,
  resetMockFirebase,
  mockFirestoreData
} from '../mocks/firebase-mock.js';
import {
  loadWords,
  saveWords,
  clearMemoryStorage,
  getDefaultStarterWords,
  normalizeWordRecord,
  recordTrapError,
  getProfileTrapHistory,
  getPlausibleDistractors,
  resetProfileProgress
} from '../../js/srs.js';

describe('Firebase Cloud Sync, Offline Queue & Auth Gate (Executable Specification for sync.js & auth.js)', () => {
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

  describe('1. Family Allowlist Google Authentication Gate', () => {
    it('authenticates authorized family members and persists session locally for offline play', async () => {
      // GIVEN an authorized family Google account
      const authorizedUser = {
        uid: 'user_123',
        email: 'scher.jonathan@gmail.com',
        displayName: 'Jonathan Scher',
        photoURL: 'https://example.com/avatar.jpg'
      };
      setMockAuthUser(authorizedUser);

      // WHEN signing in via Google
      await authManager.signInWithGoogle();

      // THEN sign-in succeeds and session is persisted in localStorage
      expect(authManager.isAuthenticated()).toBe(true);
      expect(authManager.getSession()?.email).toBe('scher.jonathan@gmail.com');

      const rawStored = localStorage.getItem('hottub_firebase_auth_session_v1');
      expect(rawStored).not.toBeNull();
      const parsed = JSON.parse(rawStored!);
      expect(parsed.email).toBe('scher.jonathan@gmail.com');
    });

    it('rejects unauthorized Google accounts not in the family allowlist', async () => {
      // GIVEN an unauthorized external Google account
      let authError: any = null;
      const unsub = authManager.onAuthChange((_session, err) => {
        if (err) authError = err;
      });

      const strangerUser = {
        uid: 'stranger_999',
        email: 'stranger.danger@example.com',
        displayName: 'Unknown User'
      };
      setMockAuthUser(strangerUser);

      // WHEN attempting to sign in
      await authManager.signInWithGoogle();

      // THEN sign-in is rejected and session remains unauthenticated
      expect(authManager.isAuthenticated()).toBe(false);
      expect(authError?.message).toContain('Access restricted');
      expect(localStorage.getItem('hottub_firebase_auth_session_v1')).toBeNull();

      unsub();
    });

    it('supports adding and removing extra allowed family emails dynamically', async () => {
      // GIVEN an extra email not in default allowlist
      const grandmaEmail = 'grandma.scher@gmail.com';
      expect(authManager.isEmailAllowed(grandmaEmail)).toBe(false);

      // WHEN parent adds grandma's email
      authManager.addExtraAllowedEmail(grandmaEmail);

      // THEN grandma's email becomes authorized
      expect(authManager.isEmailAllowed(grandmaEmail)).toBe(true);
      expect(authManager.getExtraAllowedEmails()).toContain(grandmaEmail);

      // WHEN parent removes grandma's email
      authManager.removeExtraAllowedEmail(grandmaEmail);

      // THEN it is no longer authorized
      expect(authManager.isEmailAllowed(grandmaEmail)).toBe(false);
    });

    it('clears session and notifies listeners upon sign out', async () => {
      // GIVEN an active session
      setMockAuthUser({
        uid: 'user_123',
        email: 'williams.evamary@gmail.com',
        displayName: 'Eva-Mary Williams'
      });
      await authManager.signInWithGoogle();
      expect(authManager.isAuthenticated()).toBe(true);

      // WHEN user signs out
      await authManager.signOut();

      // THEN session is cleared from memory and storage
      expect(authManager.isAuthenticated()).toBe(false);
      expect(authManager.getSession()).toBeNull();
      expect(localStorage.getItem('hottub_firebase_auth_session_v1')).toBeNull();
    });
  });

  describe('2. Offline Dirty Queue & Remote Firestore Synchronization', () => {
    it('queues dirty word updates locally when offline and pushes to Cloud Firestore when online', async () => {
      // GIVEN authenticated family user
      setMockAuthUser({
        uid: 'user_123',
        email: 'scher.jonathan@gmail.com',
        displayName: 'Jonathan Scher'
      });
      await authManager.signInWithGoogle();

      // WHEN a word progress update occurs (e.g., word "câlin" advances to Box 2)
      const wordRec = normalizeWordRecord(
        {
          word: 'câlin',
          box: 2,
          streak: 1,
          total_attempts: 1,
          correct_attempts: 1,
          week_label: 'Week 8',
          next_review: '2026-11-03'
        },
        'Week 8',
        '2026-11-01'
      );

      await syncManager.queueWordUpdate(wordRec, 'daughter');

      // THEN word is synced directly to Firestore words collection
      const docPath = 'words/câlin';
      expect(mockFirestoreData.has(docPath)).toBe(true);
      const cloudData = mockFirestoreData.get(docPath);
      expect(cloudData.box).toBe(2);
      expect(cloudData.word).toBe('câlin');
    });

    it('enforces Safe Test Sandbox: Test profile gameplay does NOT push to root Firestore by default', async () => {
      // GIVEN authenticated user playing in 'test' profile with test sync disabled (default)
      setMockAuthUser({
        uid: 'user_123',
        email: 'scher.jonathan@gmail.com'
      });
      await authManager.signInWithGoogle();
      syncManager.setTestProfileSyncEnabled(false);
      expect(syncManager.isTestProfileSyncEnabled()).toBe(false);

      const testWordRec = normalizeWordRecord(
        { word: 'câlin', box: 5, streak: 10, total_attempts: 10, correct_attempts: 10 },
        'Week 8',
        '2026-11-01'
      );

      // WHEN queueWordUpdate is called for test profile
      await syncManager.queueWordUpdate(testWordRec, 'test');

      // THEN root Firestore words document is NOT touched (Zoé protection)
      expect(mockFirestoreData.has('words/câlin')).toBe(false);

      // WHEN test profile cloud sync is explicitly enabled
      syncManager.setTestProfileSyncEnabled(true);
      await syncManager.queueWordUpdate(testWordRec, 'test');

      // THEN word is synced to Firestore namespaced under profiles.test without overwriting root box
      expect(mockFirestoreData.has('words/câlin')).toBe(true);
      const cloudData = mockFirestoreData.get('words/câlin');
      expect(cloudData.profiles?.test?.box).toBe(5);
    });

    it('seeds remote Firestore with initial starter words when syncing with an empty database', async () => {
      // GIVEN an empty remote Firestore database and authenticated user
      expect(mockFirestoreData.size).toBe(0);
      setMockAuthUser({
        uid: 'user_123',
        email: 'scher.jonathan@gmail.com'
      });
      await authManager.signInWithGoogle();

      // WHEN syncNow is executed
      const result = await syncManager.syncNow();

      // THEN starter words are seeded into remote Firestore words collection
      expect(result.ok).toBe(true);
      expect(mockFirestoreData.size).toBeGreaterThan(0);
      expect(mockFirestoreData.has('words/câlin')).toBe(true);
      expect(mockFirestoreData.has('words/sans')).toBe(true);
    });

    it('synchronizes and persists personal performance (profile trapHistory error weights from Issue #7) in Firebase across sessions', async () => {
      // GIVEN authenticated family user on Device A
      setMockAuthUser({
        uid: 'user_123',
        email: 'scher.jonathan@gmail.com',
        displayName: 'Jonathan Scher'
      });
      await authManager.signInWithGoogle();

      // AND the learner makes errors on specific trap categories in daughter profile during a gameplay session
      recordTrapError('silent finals', { profileId: 'daughter' });
      recordTrapError('silent finals', { profileId: 'daughter' });
      recordTrapError('b/d/p/q flips', { profileId: 'daughter' });

      // WHEN synchronizing with Firebase Cloud
      const syncResult = await syncManager.syncNow();
      expect(syncResult.ok).toBe(true);

      // THEN personal performance error history is saved to Firebase Cloud Firestore metadata/app_state
      expect(mockFirestoreData.has('metadata/app_state')).toBe(true);
      const appStateData = mockFirestoreData.get('metadata/app_state');
      const remoteTrapHistory = appStateData.profiles?.daughter?.trapHistory || appStateData.trapHistory;
      expect(remoteTrapHistory).toBeDefined();
      expect(remoteTrapHistory['silent finals'] || remoteTrapHistory['silent_finals']).toBe(2);
      expect(remoteTrapHistory['b/d/p/q flips'] || remoteTrapHistory['bd_flips']).toBe(1);

      // AND WHEN starting a new session on a second device / fresh storage where local cache is cleared
      localStorage.clear();
      clearMemoryStorage();
      expect(getProfileTrapHistory('daughter')).toEqual({});

      // AND the new session connects and syncs with Firebase
      await syncManager.syncNow();

      // THEN the learner's personal performance is restored between sessions from Firebase
      const restoredTrapHistory = getProfileTrapHistory('daughter');
      expect(restoredTrapHistory['silent finals'] || restoredTrapHistory['silent_finals']).toBe(2);
      expect(restoredTrapHistory['b/d/p/q flips'] || restoredTrapHistory['bd_flips']).toBe(1);

      // AND adaptive distractor generation on the new session prioritizes the restored blind spots
      const pool = getPlausibleDistractors('d', 'grand', [{ word: 'grand' }], 4);
      const SILENT_TRAPS = new Set(['t', 'd', 's', 'x', 'p', 'g', 'c', 'z', 'e']);
      const silentCount = pool.filter((ch) => SILENT_TRAPS.has(ch)).length;
      expect(silentCount).toBeGreaterThan(0);
    });

    it('enforces Safe Test Sandbox for personal performance: test profile trap errors do NOT push to cloud by default, but sync namespaced when enabled', async () => {
      // GIVEN authenticated family user with test sync disabled
      setMockAuthUser({
        uid: 'user_123',
        email: 'scher.jonathan@gmail.com'
      });
      await authManager.signInWithGoogle();
      syncManager.setTestProfileSyncEnabled(false);

      // Seed daughter trap history in Firestore
      recordTrapError('silent finals', { profileId: 'daughter' });
      await syncManager.syncNow();
      expect(mockFirestoreData.has('metadata/app_state')).toBe(true);
      const appStateBefore = mockFirestoreData.get('metadata/app_state');
      expect(appStateBefore.profiles?.daughter?.trapHistory['silent finals']).toBe(1);

      // WHEN learner practices in test profile and makes mistakes
      recordTrapError('b/d/p/q flips', { profileId: 'test' });
      await syncManager.syncNow();

      // THEN root and daughter data are untouched, and test trap history is NOT pushed
      const appStateAfter = mockFirestoreData.get('metadata/app_state');
      expect(appStateAfter.profiles?.daughter?.trapHistory['silent finals']).toBe(1);
      expect(appStateAfter.profiles?.test).toBeUndefined();

      // WHEN test profile sync is enabled and synced
      syncManager.setTestProfileSyncEnabled(true);
      recordTrapError('nasal vowels', { profileId: 'test' });
      await syncManager.syncNow();

      // THEN test profile trap errors are synced safely namespaced under profiles.test
      const appStateWithTest = mockFirestoreData.get('metadata/app_state');
      expect(appStateWithTest.profiles?.test?.trapHistory).toBeDefined();
      expect(appStateWithTest.profiles?.test?.trapHistory['nasal vowels']).toBe(1);
      // Daughter data remains strictly preserved
      expect(appStateWithTest.profiles?.daughter?.trapHistory['silent finals']).toBe(1);
    });

    it('synchronizes profile progress reset so old personal error history is cleared in Firebase and does not resurrect', async () => {
      // GIVEN authenticated user with existing personal errors in Firebase
      setMockAuthUser({
        uid: 'user_123',
        email: 'scher.jonathan@gmail.com'
      });
      await authManager.signInWithGoogle();
      recordTrapError('silent finals', { profileId: 'daughter' });
      await syncManager.syncNow();

      const appState = mockFirestoreData.get('metadata/app_state');
      expect(appState.profiles?.daughter?.trapHistory['silent finals']).toBe(1);

      // WHEN resetting daughter progress in parent mode
      resetProfileProgress('daughter');
      await syncManager.syncNow();

      // THEN remote Firebase trap history is reset to empty
      const appStateAfterReset = mockFirestoreData.get('metadata/app_state');
      expect(appStateAfterReset.profiles?.daughter?.trapHistory).toEqual({});

      // AND in a new session on another device, trap history remains cleared
      localStorage.clear();
      clearMemoryStorage();
      await syncManager.syncNow();
      expect(getProfileTrapHistory('daughter')).toEqual({});
    });
  });
});
