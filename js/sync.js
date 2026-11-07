/**
 * Cloud Sync Manager for Firebase Cloud Firestore + Offline Queue
 *
 * Features:
 * - Connects directly to Cloud Firestore (`words` collection & `metadata/app_state` document)
 *   secured by Firebase Authentication and family email Security Rules.
 * - Offline-first queue: saves dirty SRS updates and weekly additions locally, syncing automatically
 *   whenever online or at session start.
 * - Automatically seeds an empty Firestore database with the initial Week 7 & Week 8 word lists.
 */

import {
  db,
  auth,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch
} from './firebase-config.js';
import { authManager } from './auth.js';
import {
  mergeWordsFromCloud,
  loadWords,
  getCurrentWeekLabel,
  normalizeWord,
  getActiveProfileId,
  getDefaultAudioUrl,
  DIRTY_TRAP_HISTORY_STORAGE_KEY,
  TEST_DIRTY_TRAP_HISTORY_STORAGE_KEY,
  getDirtyProfileTrapHistory,
  clearDirtyProfileTrapHistory,
  markProfileTrapHistoryDirty,
  getProfileTrapHistory,
  mergeProfilesFromCloud
} from './srs.js';

const DIRTY_WORDS_STORAGE_KEY = 'hottub_dirty_srs_queue_v2';
const TEST_DIRTY_WORDS_STORAGE_KEY = 'hottub_dirty_srs_queue_v2_test';
const TEST_PROFILE_SYNC_KEY = 'hottub_sync_test_profile_enabled_v1';
const PENDING_WEEKLY_STORAGE_KEY = 'hottub_pending_weekly_batches_v2';
const LAST_SYNC_STORAGE_KEY = 'hottub_last_sync_iso_v2';

const WORDS_COLLECTION = 'words';
const METADATA_COLLECTION = 'metadata';
const APP_STATE_DOC = 'app_state';

function toWordDocId(word) {
  return normalizeWord(word).replace(/\//g, '_');
}

class CloudSyncManager {
  constructor() {
    this.syncing = false;
    this.statusListeners = new Set();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        if (this.isCloudReady()) {
          this.syncNow().catch(() => {});
        }
      });
    }
  }

  onStatusChange(listener) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  _emitStatus(detail) {
    for (const fn of this.statusListeners) {
      try {
        fn(detail);
      } catch {
        // Ignore UI listener error
      }
    }
  }

  /**
   * Returns true when a family member is authenticated and ready to sync with Firestore.
   */
  isCloudReady() {
    return Boolean(auth.currentUser || authManager.isAuthenticated());
  }

  isTestProfileSyncEnabled() {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(TEST_PROFILE_SYNC_KEY) === 'true';
  }

  setTestProfileSyncEnabled(enabled) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(TEST_PROFILE_SYNC_KEY, enabled ? 'true' : 'false');
  }

  getLastSyncTime() {
    return localStorage.getItem(LAST_SYNC_STORAGE_KEY) || '';
  }

  /**
   * Queues a word's updated SRS progression locally and pushes immediately to Firestore if online.
   * If in 'test' profile and test sync is disabled, acts as a safe local sandbox (skips remote sync).
   * @param {any} wordRecord
   * @param {string} [profileId]
   */
  async queueWordUpdate(wordRecord, profileId) {
    if (!wordRecord || !wordRecord.word) return;

    const cleanWord = normalizeWord(wordRecord.word);
    if (!cleanWord) return;

    const resolvedProfile = profileId || getActiveProfileId();

    if (resolvedProfile === 'test' && !this.isTestProfileSyncEnabled()) {
      // In local sandbox mode: do not queue to cloud or touch Firestore
      return;
    }

    const queue = this._loadDirtyMap(resolvedProfile);
    queue[cleanWord] = {
      word: cleanWord,
      week_label: wordRecord.week_label,
      active: wordRecord.active !== false,
      box: wordRecord.box,
      next_review: wordRecord.next_review,
      streak: wordRecord.streak,
      total_attempts: wordRecord.total_attempts,
      correct_attempts: wordRecord.correct_attempts || 0,
      custom_audio_url: wordRecord.custom_audio_url || '',
      updated_at: new Date().toISOString()
    };
    this._saveDirtyMap(queue, resolvedProfile);

    if (auth.currentUser && navigator.onLine !== false) {
      await this.flushPendingChanges();
    }
  }

  /**
   * Queues an updated trap error history locally and pushes to Firestore if online.
   * If in 'test' profile and test sync is disabled, acts as a safe local sandbox (skips remote sync).
   * @param {string} [profileId]
   * @param {Record<string, number>} [trapHistory]
   */
  async queueTrapHistoryUpdate(profileId, trapHistory) {
    const resolvedProfile = profileId || getActiveProfileId();

    if (resolvedProfile === 'test' && !this.isTestProfileSyncEnabled()) {
      // In local sandbox mode: do not queue to cloud or touch Firestore
      return;
    }

    const currentHistory = trapHistory || getProfileTrapHistory(resolvedProfile);
    markProfileTrapHistoryDirty(resolvedProfile, currentHistory);

    if (auth.currentUser && navigator.onLine !== false) {
      await this.flushPendingChanges();
    }
  }

  /**
   * Pushes a new weekly list of 6-10 words to Cloud Firestore (or queues offline).
   */
  async pushWeeklyWordList(weekLabel, wordRecords) {
    const nowIso = new Date().toISOString();
    const payloadBatch = {
      week_label: weekLabel,
      words: wordRecords.map((w) => ({
        word: normalizeWord(w.word),
        week_label: weekLabel,
        active: true,
        box: w.box || 1,
        next_review: w.next_review,
        streak: w.streak || 0,
        total_attempts: w.total_attempts || 0,
        correct_attempts: w.correct_attempts || 0,
        custom_audio_url: w.custom_audio_url || '',
        updated_at: nowIso
      }))
    };

    if (!auth.currentUser) {
      this._enqueueWeeklyBatch(payloadBatch);
      return { ok: true, localOnly: true };
    }

    if (navigator.onLine === false) {
      this._enqueueWeeklyBatch(payloadBatch);
      return { ok: true, queuedOffline: true };
    }

    try {
      await this._writeWeeklyBatchToFirestore(payloadBatch);
      await this.syncNow();
      return { ok: true, synced: true };
    } catch (err) {
      this._enqueueWeeklyBatch(payloadBatch);
      return { ok: false, queuedOffline: true, error: String(err.message || err) };
    }
  }

  async _writeWeeklyBatchToFirestore(batchPayload) {
    const batch = writeBatch(db);
    const nowIso = new Date().toISOString();

    for (const item of batchPayload.words) {
      const cleanWord = normalizeWord(item.word);
      if (!cleanWord) continue;
      const wordRef = doc(db, WORDS_COLLECTION, toWordDocId(cleanWord));
      batch.set(
        wordRef,
        {
          word: cleanWord,
          week_label: batchPayload.week_label,
          active: true,
          box: item.box || 1,
          next_review: item.next_review,
          streak: item.streak || 0,
          total_attempts: item.total_attempts || 0,
          correct_attempts: item.correct_attempts || 0,
          custom_audio_url: item.custom_audio_url || '',
          updated_at: nowIso
        },
        { merge: true }
      );
    }

    const metaRef = doc(db, METADATA_COLLECTION, APP_STATE_DOC);
    batch.set(
      metaRef,
      {
        current_week_label: batchPayload.week_label,
        updated_at: nowIso,
        updated_by: (auth.currentUser && auth.currentUser.email) || ''
      },
      { merge: true }
    );

    await batch.commit();
  }

  /**
   * Deletes a word document from Cloud Firestore.
   */
  async deleteWordRemote(word) {
    const cleanWord = normalizeWord(word);
    if (!cleanWord) return { ok: false };

    const dirty = this._loadDirtyMap();
    if (dirty[cleanWord]) {
      delete dirty[cleanWord];
      this._saveDirtyMap(dirty);
    }

    if (!auth.currentUser || navigator.onLine === false) {
      return { ok: true, localOnly: true };
    }

    try {
      await deleteDoc(doc(db, WORDS_COLLECTION, toWordDocId(cleanWord)));
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  /**
   * Full 2-way sync with Cloud Firestore:
   * 1. Flushes any offline-queued weekly word additions and SRS progress updates.
   * 2. Pulls full word list & SRS progression from Firestore (or seeds Firestore if empty).
   */
  async syncNow(timeoutMs = 6000) {
    if (!auth.currentUser) {
      const hasCachedAuth = authManager.isAuthenticated();
      this._emitStatus({
        connected: false,
        message: hasCachedAuth
          ? 'Waiting for Firebase connection...'
          : 'Sign in with Google to sync with Firebase'
      });
      return { ok: false, reason: 'unauthenticated', words: loadWords() };
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this._emitStatus({ connected: false, message: 'Offline — using saved local words' });
      return { ok: false, reason: 'offline', words: loadWords() };
    }

    if (this.syncing) {
      return { ok: true, reason: 'in_progress', words: loadWords() };
    }

    this.syncing = true;
    this._emitStatus({ syncing: true, message: 'Syncing with Firebase Cloud...' });

    try {
      const syncPromise = (async () => {
        await this.flushPendingChanges();

        const [wordsSnap, metaSnap] = await Promise.all([
          getDocs(collection(db, WORDS_COLLECTION)),
          getDoc(doc(db, METADATA_COLLECTION, APP_STATE_DOC)).catch(() => null)
        ]);

        let remoteCurrentWeek = '';
        if (metaSnap && metaSnap.exists()) {
          const metaData = metaSnap.data();
          if (metaData) {
            if (metaData.current_week_label) {
              remoteCurrentWeek = String(metaData.current_week_label).trim();
            }
            if (metaData.profiles || metaData.trapHistory) {
              mergeProfilesFromCloud(metaData);
            }
          }
        }

        const remoteWords = [];
        const missingAudioWords = [];
        wordsSnap.forEach((docSnap) => {
          const d = docSnap.data();
          if (d && d.word) {
            remoteWords.push(d);
            const defAudio = getDefaultAudioUrl(d.word);
            if (defAudio && (!d.custom_audio_url || !String(d.custom_audio_url).trim())) {
              missingAudioWords.push({ word: d.word, custom_audio_url: defAudio });
            }
          }
        });

        // If remote Firestore docs for default words are missing audio, backfill them non-blockingly
        if (missingAudioWords.length > 0) {
          this._backfillMissingDefaultAudio(missingAudioWords).catch(() => {});
        }

        // If Firestore is brand new and empty, seed it with our local starter words (Week 7 & Week 8)!
        if (remoteWords.length === 0) {
          const localStarter = loadWords();
          const currentWeek = getCurrentWeekLabel(localStarter);
          await this._seedInitialFirestoreWords(localStarter, currentWeek);
          this._recordSyncSuccess();
          this._emitStatus({
            connected: true,
            message: `Initialized Firebase with ${localStarter.length} words`
          });
          return { ok: true, words: localStarter };
        }

        const merged = mergeWordsFromCloud(
          remoteWords,
          this.getDirtyWordSet(),
          remoteCurrentWeek
        );
        this._recordSyncSuccess();
        this._emitStatus({
          connected: true,
          message: `Firebase Synced (${merged.length} words)`
        });
        return { ok: true, words: merged };
      })();

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Sync timed out — playing with local cache')), timeoutMs);
      });

      return await Promise.race([syncPromise, timeoutPromise]);
    } catch (err) {
      const msg = this._friendlyFirestoreError(err);
      this._emitStatus({ connected: false, error: true, message: msg });
      return { ok: false, reason: 'network_error', error: msg, words: loadWords() };
    } finally {
      this.syncing = false;
    }
  }

  async _seedInitialFirestoreWords(wordsList, currentWeekLabel) {
    const batch = writeBatch(db);
    const nowIso = new Date().toISOString();

    for (const w of wordsList) {
      const cleanWord = normalizeWord(w.word);
      if (!cleanWord) continue;
      const wordRef = doc(db, WORDS_COLLECTION, toWordDocId(cleanWord));
      batch.set(wordRef, {
        word: cleanWord,
        week_label: w.week_label || 'Week 8',
        active: w.active !== false,
        box: w.box || 1,
        next_review: w.next_review,
        streak: w.streak || 0,
        total_attempts: w.total_attempts || 0,
        correct_attempts: w.correct_attempts || 0,
        custom_audio_url: w.custom_audio_url || getDefaultAudioUrl(cleanWord) || '',
        updated_at: nowIso
      });
    }

    const metaRef = doc(db, METADATA_COLLECTION, APP_STATE_DOC);
    const daughterTrapHistory = getProfileTrapHistory('daughter');
    const profilesPayload = {
      daughter: {
        trapHistory: daughterTrapHistory,
        updated_at: nowIso
      }
    };
    if (this.isTestProfileSyncEnabled()) {
      profilesPayload.test = {
        trapHistory: getProfileTrapHistory('test'),
        updated_at: nowIso
      };
    }
    batch.set(
      metaRef,
      {
        current_week_label: currentWeekLabel || 'Week 8',
        profiles: profilesPayload,
        trapHistory: daughterTrapHistory,
        updated_at: nowIso,
        updated_by: (auth.currentUser && auth.currentUser.email) || ''
      },
      { merge: true }
    );

    await batch.commit();
  }

  /**
   * Backfills default bundled audio URLs to existing remote Firestore documents
   * that currently have empty custom_audio_url. Preserves all SRS and attempt metrics.
   * @param {Array<{word: string, custom_audio_url: string}>} wordsList
   */
  async _backfillMissingDefaultAudio(wordsList) {
    if (!auth.currentUser || !Array.isArray(wordsList) || wordsList.length === 0) return;
    try {
      const batch = writeBatch(db);
      for (const item of wordsList) {
        const cleanWord = normalizeWord(item.word);
        if (!cleanWord) continue;
        const wordRef = doc(db, WORDS_COLLECTION, toWordDocId(cleanWord));
        batch.set(wordRef, { custom_audio_url: item.custom_audio_url }, { merge: true });
      }
      await batch.commit();
    } catch {
      // Background non-critical update; retry next sync if offline or interrupted
    }
  }

  /**
   * Flushes pending weekly batches and dirty SRS updates to Cloud Firestore.
   */
  async flushPendingChanges() {
    if (!auth.currentUser || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      return false;
    }

    // 1. Flush pending weekly word additions (shared curriculum)
    const weeklyBatches = this._loadWeeklyBatches();
    if (weeklyBatches.length > 0) {
      const remaining = [];
      for (const batchPayload of weeklyBatches) {
        try {
          await this._writeWeeklyBatchToFirestore(batchPayload);
        } catch {
          remaining.push(batchPayload);
        }
      }
      this._saveWeeklyBatches(remaining);
    }

    // 2. Flush dirty SRS word updates for daughter profile
    const daughterDirty = this._loadDirtyMap('daughter');
    const daughterUpdates = Object.values(daughterDirty);
    let daughterSuccess = true;
    if (daughterUpdates.length > 0) {
      try {
        const batch = writeBatch(db);
        const nowIso = new Date().toISOString();
        for (const item of daughterUpdates) {
          const cleanWord = normalizeWord(item.word);
          if (!cleanWord) continue;
          const wordRef = doc(db, WORDS_COLLECTION, toWordDocId(cleanWord));
          batch.set(
            wordRef,
            {
              word: cleanWord,
              week_label: item.week_label,
              active: item.active !== false,
              box: item.box,
              next_review: item.next_review,
              streak: item.streak,
              total_attempts: item.total_attempts,
              correct_attempts: item.correct_attempts || 0,
              custom_audio_url: item.custom_audio_url || '',
              updated_at: item.updated_at || nowIso,
              profiles: {
                daughter: {
                  box: item.box,
                  next_review: item.next_review,
                  streak: item.streak,
                  total_attempts: item.total_attempts,
                  correct_attempts: item.correct_attempts || 0,
                  updated_at: item.updated_at || nowIso
                }
              }
            },
            { merge: true }
          );
        }
        await batch.commit();
        this._saveDirtyMap({}, 'daughter');
        this._recordSyncSuccess();
      } catch {
        daughterSuccess = false;
      }
    }

    // 3. Flush dirty SRS word updates for other profiles (brigitte, eric, and test if enabled)
    const otherProfilesToFlush = ['brigitte', 'eric'];
    if (this.isTestProfileSyncEnabled()) {
      otherProfilesToFlush.push('test');
    }
    for (const pId of otherProfilesToFlush) {
      const pDirty = this._loadDirtyMap(pId);
      const pUpdates = Object.values(pDirty);
      if (pUpdates.length > 0) {
        try {
          const batch = writeBatch(db);
          const nowIso = new Date().toISOString();
          for (const item of pUpdates) {
            const cleanWord = normalizeWord(item.word);
            if (!cleanWord) continue;
            const wordRef = doc(db, WORDS_COLLECTION, toWordDocId(cleanWord));
            batch.set(
              wordRef,
              {
                word: cleanWord,
                profiles: {
                  [pId]: {
                    box: item.box,
                    next_review: item.next_review,
                    streak: item.streak,
                    total_attempts: item.total_attempts,
                    correct_attempts: item.correct_attempts || 0,
                    updated_at: item.updated_at || nowIso
                  }
                }
              },
              { merge: true }
            );
          }
          await batch.commit();
          this._saveDirtyMap({}, pId);
          this._recordSyncSuccess();
        } catch {
          // Keep dirty map for next retry
        }
      }
    }

    // 4. Flush dirty trap error history (personal performance) for daughter profile
    const daughterTrapDirty = getDirtyProfileTrapHistory('daughter');
    if (daughterTrapDirty) {
      try {
        const metaRef = doc(db, METADATA_COLLECTION, APP_STATE_DOC);
        const nowIso = new Date().toISOString();
        const payload = {
          profiles: {
            daughter: {
              trapHistory: daughterTrapDirty.trapHistory || {},
              updated_at: daughterTrapDirty.updated_at || nowIso
            }
          },
          trapHistory: daughterTrapDirty.trapHistory || {},
          updated_at: nowIso,
          updated_by: (auth.currentUser && auth.currentUser.email) || ''
        };
        await setDoc(metaRef, payload, { merge: true });
        clearDirtyProfileTrapHistory('daughter');
        this._recordSyncSuccess();
      } catch {
        // Keep dirty for next retry
      }
    }

    // 5. Flush dirty trap error history for other profiles (brigitte, eric, and test if enabled)
    for (const pId of otherProfilesToFlush) {
      const pTrapDirty = getDirtyProfileTrapHistory(pId);
      if (pTrapDirty) {
        try {
          const metaRef = doc(db, METADATA_COLLECTION, APP_STATE_DOC);
          const nowIso = new Date().toISOString();
          const payload = {
            profiles: {
              [pId]: {
                trapHistory: pTrapDirty.trapHistory || {},
                updated_at: pTrapDirty.updated_at || nowIso
              }
            },
            updated_at: nowIso,
            updated_by: (auth.currentUser && auth.currentUser.email) || ''
          };
          await setDoc(metaRef, payload, { merge: true });
          clearDirtyProfileTrapHistory(pId);
          this._recordSyncSuccess();
        } catch {
          // Keep dirty for next retry
        }
      }
    }

    return daughterSuccess;
  }

  _friendlyFirestoreError(err) {
    const code = String((err && err.code) || '');
    if (code === 'permission-denied') {
      return 'Firestore permission denied — check Firestore Security Rules for your email.';
    }
    if (code === 'unavailable') {
      return 'Firebase temporarily unreachable — playing offline.';
    }
    return String((err && err.message) || err || 'Sync error');
  }

  getDirtyWordSet(profileId) {
    const prof = profileId || getActiveProfileId();
    return new Set(Object.keys(this._loadDirtyMap(prof)));
  }

  getPendingSyncCount() {
    let count =
      Object.keys(this._loadDirtyMap('daughter')).length +
      Object.keys(this._loadDirtyMap('brigitte')).length +
      Object.keys(this._loadDirtyMap('eric')).length +
      (this.isTestProfileSyncEnabled() ? Object.keys(this._loadDirtyMap('test')).length : 0) +
      (getDirtyProfileTrapHistory('daughter') ? 1 : 0) +
      (getDirtyProfileTrapHistory('brigitte') ? 1 : 0) +
      (getDirtyProfileTrapHistory('eric') ? 1 : 0) +
      (this.isTestProfileSyncEnabled() && getDirtyProfileTrapHistory('test') ? 1 : 0) +
      this._loadWeeklyBatches().length;
    return count;
  }

  _recordSyncSuccess() {
    const iso = new Date().toISOString();
    localStorage.setItem(LAST_SYNC_STORAGE_KEY, iso);
  }

  _loadDirtyMap(profileId = 'daughter') {
    try {
      const key =
        profileId === 'test'
          ? TEST_DIRTY_WORDS_STORAGE_KEY
          : profileId === 'daughter'
          ? DIRTY_WORDS_STORAGE_KEY
          : `${DIRTY_WORDS_STORAGE_KEY}_${profileId}`;
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  _saveDirtyMap(map, profileId = 'daughter') {
    try {
      const key =
        profileId === 'test'
          ? TEST_DIRTY_WORDS_STORAGE_KEY
          : profileId === 'daughter'
          ? DIRTY_WORDS_STORAGE_KEY
          : `${DIRTY_WORDS_STORAGE_KEY}_${profileId}`;
      localStorage.setItem(key, JSON.stringify(map));
    } catch {
      // Ignore quota errors
    }
  }

  _loadWeeklyBatches() {
    try {
      const raw = localStorage.getItem(PENDING_WEEKLY_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  _saveWeeklyBatches(list) {
    try {
      localStorage.setItem(PENDING_WEEKLY_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Ignore
    }
  }

  _enqueueWeeklyBatch(batch) {
    const list = this._loadWeeklyBatches();
    list.push(batch);
    this._saveWeeklyBatches(list);
  }
}

export const syncManager = new CloudSyncManager();
