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
  normalizeWordRecord
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
  });
});
