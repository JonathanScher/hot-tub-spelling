/**
 * Spaced Repetition System (Leitner Boxes 1-5) & Vocabulary Store
 *
 * Rules:
 * - Zero-Error Mastery: A word is recalled with mastery only when wordErrorCount === 0
 *   (zero wrong taps and Hint button not pressed).
 * - Long-Term Progression (based on first attempt in session):
 *     firstAttemptErrors === 0 -> box = min(5, box + 1), next_review = today + BOX_INTERVALS[box]
 *     firstAttemptErrors > 0   -> box = 1, next_review = today + 1 day
 * - Intervals: Box 1: +1d, Box 2: +2d, Box 3: +4d, Box 4: +7d, Box 5: +14d
 * - Historical Retention: Past weeks' words stay permanently in the store and resurface
 *   automatically when today >= next_review.
 */

export const WORDS_STORAGE_KEY = 'hottub_srs_words_v2';
export const CURRENT_WEEK_KEY = 'hottub_current_week_label_v2';

/**
 * @typedef {object} WordRecord
 * @property {string} word
 * @property {string} week_label
 * @property {boolean} active
 * @property {number} box
 * @property {string} next_review
 * @property {number} streak
 * @property {number} total_attempts
 * @property {number} correct_attempts
 * @property {string} custom_audio_url
 */

/**
 * @typedef {object} StorageLike
 * @property {(key: string) => string | null} getItem
 * @property {(key: string, value: string) => void} setItem
 * @property {(key: string) => void} [removeItem]
 */

/** @type {Map<string, string>} */
const memoryStorageMap = new Map();

/** @type {StorageLike} */
const fallbackMemoryStorage = {
  getItem: (key) => (memoryStorageMap.has(key) ? /** @type {string} */ (memoryStorageMap.get(key)) : null),
  setItem: (key, val) => {
    memoryStorageMap.set(key, String(val));
  },
  removeItem: (key) => {
    memoryStorageMap.delete(key);
  }
};

/**
 * Resolves the active storage adapter (browser localStorage or headless in-memory fallback).
 * @param {StorageLike} [customStorage]
 * @returns {StorageLike}
 */
export function getStorage(customStorage) {
  if (customStorage) return customStorage;
  if (typeof localStorage !== 'undefined' && localStorage !== null) {
    return localStorage;
  }
  return fallbackMemoryStorage;
}

/**
 * Clears the headless fallback memory storage (useful for deterministic test isolation).
 */
export function clearMemoryStorage() {
  memoryStorageMap.clear();
}

/** @type {Record<number, number>} */
export const BOX_INTERVALS = {
  1: 1,
  2: 2,
  3: 4,
  4: 7,
  5: 14
};

const BASE_LOWERCASE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');

/** @type {Record<string, string[]>} */
const ACCENT_FAMILIES = {
  a: ['a', 'à', 'â', 'ä', 'á'],
  c: ['c', 'ç'],
  e: ['e', 'é', 'è', 'ê', 'ë'],
  i: ['i', 'î', 'ï', 'í'],
  n: ['n', 'ñ'],
  o: ['o', 'ô', 'ö', 'ó'],
  u: ['u', 'ù', 'û', 'ü', 'ú']
};

// Visually/phonetically plausible lowercase distractor neighbors for kids
/** @type {Record<string, string[]>} */
const PLAUSIBLE_LETTER_NEIGHBORS = {
  a: ['e', 'o', 'u', 'c', 'd'],
  b: ['d', 'p', 'h', 'k', 'g'],
  c: ['o', 'e', 'a', 's', 'k'],
  d: ['b', 'p', 'q', 't', 'g'],
  e: ['a', 'c', 'o', 'i', 's'],
  f: ['t', 'l', 'v', 'r', 'p'],
  g: ['q', 'p', 'y', 'j', 'd'],
  h: ['n', 'b', 'k', 'm', 'r'],
  i: ['l', 'j', 'e', 'y', 't'],
  j: ['i', 'g', 'y', 'l', 'p'],
  k: ['h', 'c', 'x', 'b', 't'],
  l: ['i', 't', 'f', 'h', 'r'],
  m: ['n', 'w', 'h', 'u', 'r'],
  n: ['m', 'h', 'u', 'r', 'v'],
  o: ['a', 'c', 'e', 'u', 'q'],
  p: ['b', 'd', 'q', 'g', 'r'],
  q: ['p', 'g', 'd', 'o', 'b'],
  r: ['n', 'v', 'f', 't', 'm'],
  s: ['c', 'z', 'e', 'a', 'x'],
  t: ['f', 'l', 'd', 'i', 'r'],
  u: ['v', 'n', 'o', 'a', 'w'],
  v: ['u', 'w', 'y', 'r', 'n'],
  w: ['m', 'v', 'u', 'n', 'y'],
  x: ['k', 'z', 's', 'v', 'c'],
  y: ['v', 'g', 'j', 'u', 'i'],
  z: ['s', 'x', 'c', 'e', 'n']
};

/**
 * Formats a Date object as YYYY-MM-DD in the user's LOCAL timezone
 * (avoids UTC evening rollover bugs from toISOString()).
 * @param {Date} [date]
 * @returns {string}
 */
export function getLocalISODate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Adds whole days to a YYYY-MM-DD local date string.
 * @param {string} baseIso
 * @param {number} daysToAdd
 * @param {Date} [fallbackDate]
 * @returns {string}
 */
export function addDaysISO(baseIso, daysToAdd, fallbackDate) {
  const defaultIso = fallbackDate ? getLocalISODate(fallbackDate) : getLocalISODate();
  const parts = String(baseIso || defaultIso).split('-').map(Number);
  const d =
    parts.length === 3 && !parts.some(Number.isNaN)
      ? new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0)
      : fallbackDate
        ? new Date(fallbackDate.getTime())
        : new Date();
  d.setDate(d.getDate() + Number(daysToAdd || 0));
  return getLocalISODate(d);
}

/**
 * Initial starter word list (Week 7 & Week 8) so the game is immediately playable
 * and seeds Cloud Firestore on first connect.
 * @param {string} [todayIso]
 * @returns {WordRecord[]}
 */
export function getDefaultStarterWords(todayIso) {
  const today = todayIso || getLocalISODate();
  const week7Words = [
    'sans',
    'suivre',
    'savoir',
    'sauter',
    'semaine',
    'serpent',
    'sortir',
    'soleil',
    'souvent'
  ];
  const week8Words = [
    'câlin',
    'singe',
    'enfin',
    'quinze',
    'prince',
    'loin',
    'printemps'
  ];

  /** @type {WordRecord[]} */
  const records = [];
  for (const word of week7Words) {
    records.push({
      word,
      week_label: 'Week 7',
      active: true,
      box: 1,
      next_review: today,
      streak: 0,
      total_attempts: 0,
      correct_attempts: 0,
      custom_audio_url: ''
    });
  }
  for (const word of week8Words) {
    records.push({
      word,
      week_label: 'Week 8',
      active: true,
      box: 1,
      next_review: today,
      streak: 0,
      total_attempts: 0,
      correct_attempts: 0,
      custom_audio_url: ''
    });
  }

  return records;
}

/**
 * Normalizes a word string to strict lowercase while preserving accented letters.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeWord(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * Normalizes a full word record to match the Firestore & LocalStorage schema.
 * @param {any} raw
 * @param {string} [fallbackWeek='Week 8']
 * @param {string} [todayIso]
 * @returns {WordRecord}
 */
export function normalizeWordRecord(raw, fallbackWeek = 'Week 8', todayIso) {
  const today = todayIso || getLocalISODate();
  const word = normalizeWord(raw && typeof raw === 'object' && 'word' in raw ? raw.word : raw);
  const rawBox = raw && typeof raw === 'object' ? raw.box : undefined;
  const boxNum = Math.min(5, Math.max(1, parseInt(String(rawBox), 10) || 1));
  const rawTotal = raw && typeof raw === 'object' ? raw.total_attempts : undefined;
  const totalAttempts = Math.max(0, parseInt(String(rawTotal), 10) || 0);
  const rawStreak = raw && typeof raw === 'object' ? raw.streak : undefined;
  const streak = Math.max(0, parseInt(String(rawStreak), 10) || 0);

  let correctAttempts;
  if (raw && typeof raw === 'object' && typeof raw.correct_attempts === 'number' && !Number.isNaN(raw.correct_attempts)) {
    correctAttempts = Math.min(totalAttempts, Math.max(0, Math.round(raw.correct_attempts)));
  } else if (totalAttempts > 0) {
    correctAttempts = Math.min(totalAttempts, Math.max(streak, boxNum > 1 ? boxNum - 1 : 0));
  } else {
    correctAttempts = 0;
  }

  let active = true;
  if (raw && typeof raw === 'object' && (raw.active === false || String(raw.active).toLowerCase() === 'false')) {
    active = false;
  }

  const nextReviewRaw =
    raw && typeof raw === 'object' && raw.next_review ? String(raw.next_review).trim().slice(0, 10) : '';
  const nextReview = /^\d{4}-\d{2}-\d{2}$/.test(nextReviewRaw) ? nextReviewRaw : today;

  return {
    word,
    week_label: String((raw && typeof raw === 'object' && raw.week_label) || fallbackWeek).trim() || fallbackWeek,
    active,
    box: boxNum,
    next_review: nextReview,
    streak,
    total_attempts: totalAttempts,
    correct_attempts: correctAttempts,
    custom_audio_url: String(
      (raw && typeof raw === 'object' && (raw.custom_audio_url || raw.audio_url)) || ''
    ).trim()
  };
}

/**
 * Loads all words from storage, seeding the Week 7 & Week 8 starter words on first run.
 * @param {StorageLike} [customStorage]
 * @param {string} [todayIso]
 * @returns {WordRecord[]}
 */
export function loadWords(customStorage, todayIso) {
  const store = getStorage(customStorage);
  try {
    const raw = store.getItem(WORDS_STORAGE_KEY);
    if (!raw) {
      const defaults = getDefaultStarterWords(todayIso);
      saveWords(defaults, store);
      store.setItem(CURRENT_WEEK_KEY, 'Week 8');
      return defaults;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const defaults = getDefaultStarterWords(todayIso);
      saveWords(defaults, store);
      store.setItem(CURRENT_WEEK_KEY, 'Week 8');
      return defaults;
    }

    const seen = new Set();
    const cleaned = [];
    for (const item of parsed) {
      const rec = normalizeWordRecord(item, 'Week 8', todayIso);
      if (rec.word && !seen.has(rec.word)) {
        seen.add(rec.word);
        cleaned.push(rec);
      }
    }

    if (cleaned.length === 0) {
      const defaults = getDefaultStarterWords(todayIso);
      saveWords(defaults, store);
      store.setItem(CURRENT_WEEK_KEY, 'Week 8');
      return defaults;
    }

    return cleaned;
  } catch {
    const defaults = getDefaultStarterWords(todayIso);
    return defaults;
  }
}

/**
 * Saves the complete word array to storage.
 * @param {WordRecord[]} words
 * @param {StorageLike} [customStorage]
 */
export function saveWords(words, customStorage) {
  const store = getStorage(customStorage);
  try {
    store.setItem(WORDS_STORAGE_KEY, JSON.stringify(words));
  } catch (err) {
    console.warn('Failed to save words to localStorage:', err);
  }
}

/**
 * Determines the current active week label (most recently added week).
 * @param {WordRecord[]} [words]
 * @param {StorageLike} [customStorage]
 * @returns {string}
 */
export function getCurrentWeekLabel(words, customStorage) {
  const store = getStorage(customStorage);
  const resolvedWords = words || loadWords(store);
  const stored = store.getItem(CURRENT_WEEK_KEY);
  const activeWords = resolvedWords.filter((w) => w.active !== false);
  if (stored && activeWords.some((w) => w.week_label === stored)) {
    return stored;
  }
  if (activeWords.length > 0) {
    // Pick highest numeric week if present, or last active week
    let bestLabel = activeWords[activeWords.length - 1].week_label;
    let bestNum = -1;
    for (const w of activeWords) {
      const m = /^week\s*(\d+)$/i.exec(String(w.week_label).trim());
      if (m) {
        const num = parseInt(m[1], 10);
        if (num >= bestNum) {
          bestNum = num;
          bestLabel = w.week_label;
        }
      }
    }
    return bestLabel;
  }
  return 'Week 8';
}

/**
 * @param {string} weekLabel
 * @param {StorageLike} [customStorage]
 */
export function setCurrentWeekLabel(weekLabel, customStorage) {
  const store = getStorage(customStorage);
  if (weekLabel && String(weekLabel).trim()) {
    store.setItem(CURRENT_WEEK_KEY, String(weekLabel).trim());
  }
}

/**
 * Merges remote Firestore word documents with local storage without losing historical words
 * or overwriting un-synced offline local updates.
 * @param {Array<any>} remoteRows
 * @param {Set<string>} [dirtyWordsSet] - Words with pending offline SRS updates
 * @param {string} [remoteCurrentWeek] - Optional current week label from Firestore metadata
 * @param {StorageLike} [customStorage]
 * @param {string} [todayIso]
 * @returns {WordRecord[]}
 */
export function mergeWordsFromCloud(
  remoteRows,
  dirtyWordsSet = new Set(),
  remoteCurrentWeek = '',
  customStorage,
  todayIso
) {
  const store = getStorage(customStorage);
  if (!Array.isArray(remoteRows) || remoteRows.length === 0) {
    return loadWords(store, todayIso);
  }

  const localWords = loadWords(store, todayIso);
  const localByWord = new Map(localWords.map((w) => [w.word, w]));
  /** @type {Map<string, WordRecord>} */
  const mergedMap = new Map();

  const starterSet = new Set(getDefaultStarterWords(todayIso).map((w) => w.word));
  const localIsUntouchedStarter =
    localWords.length === starterSet.size &&
    localWords.every((w) => w.total_attempts === 0 && starterSet.has(w.word)) &&
    dirtyWordsSet.size === 0;

  if (!localIsUntouchedStarter) {
    for (const loc of localWords) {
      mergedMap.set(loc.word, loc);
    }
  }

  let highestWeekLabel = '';
  let highestWeekNum = -1;

  for (const row of remoteRows) {
    const remoteRec = normalizeWordRecord(row, 'Week 8', todayIso);
    if (!remoteRec.word) continue;

    const m = /^week\s*(\d+)$/i.exec(String(remoteRec.week_label).trim());
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= highestWeekNum) {
        highestWeekNum = n;
        highestWeekLabel = remoteRec.week_label;
      }
    } else if (!highestWeekLabel) {
      highestWeekLabel = remoteRec.week_label;
    }

    const existingLocal = localByWord.get(remoteRec.word);
    if (existingLocal && dirtyWordsSet.has(remoteRec.word)) {
      // Preserve fresher offline SRS progress until dirty queue flushes
      mergedMap.set(remoteRec.word, {
        ...remoteRec,
        box: existingLocal.box,
        next_review: existingLocal.next_review,
        streak: existingLocal.streak,
        total_attempts: Math.max(existingLocal.total_attempts, remoteRec.total_attempts),
        correct_attempts: existingLocal.correct_attempts
      });
    } else {
      mergedMap.set(remoteRec.word, {
        ...remoteRec
      });
    }
  }

  const mergedList = Array.from(mergedMap.values());
  saveWords(mergedList, store);

  const weekToUse = remoteCurrentWeek || highestWeekLabel;
  if (weekToUse) {
    setCurrentWeekLabel(weekToUse, store);
  }
  return mergedList;
}

/**
 * Builds an 8 to 10 word session queue:
 * - Prioritizes all active words from the current week due for practice,
 *   mixed with past weeks' words due for review based on next_review <= today.
 * - If fewer than 8 words are currently due (e.g., playing an extra practice round),
 *   tops up cleanly from current week first, then past weeks, up to 8-10 words.
 *
 * @param {WordRecord[]} [allWords]
 * @param {number} [minWords=8]
 * @param {number} [maxWords=10]
 * @param {{ today?: string, prng?: () => number, storage?: StorageLike }} [options]
 * @returns {WordRecord[]}
 */
export function buildSessionWords(allWords, minWords = 8, maxWords = 10, options = {}) {
  const store = getStorage(options.storage);
  const today = options.today || getLocalISODate();
  const prng = options.prng || Math.random;
  const sourceWords = allWords !== undefined ? allWords : loadWords(store, today);

  const active = sourceWords.filter((w) => w && w.active !== false && w.word && w.word.length > 0);
  if (active.length === 0) {
    // CHARACTERIZATION NOTE: When active list is empty, returns slice of starter words without shuffling.
    return getDefaultStarterWords(today).slice(0, maxWords);
  }

  const currentWeek = getCurrentWeekLabel(active, store);
  /** @param {WordRecord} w */
  const isDue = (w) => !w.next_review || w.next_review <= today;

  /**
   * @param {WordRecord} a
   * @param {WordRecord} b
   */
  const sortByUrgency = (a, b) => {
    if (a.box !== b.box) return a.box - b.box;
    if (a.next_review !== b.next_review) return a.next_review.localeCompare(b.next_review);
    return a.total_attempts - b.total_attempts;
  };

  const currentWeekWords = active.filter((w) => w.week_label === currentWeek);
  const pastWeekWords = active.filter((w) => w.week_label !== currentWeek);

  const dueCurrent = currentWeekWords.filter(isDue).sort(sortByUrgency);
  const duePast = pastWeekWords.filter(isDue).sort(sortByUrgency);

  /** @type {WordRecord[]} */
  const selected = [];
  /** @type {Set<string>} */
  const pickedSet = new Set();

  /** @param {WordRecord} w */
  const addCandidate = (w) => {
    if (!pickedSet.has(w.word) && selected.length < maxWords) {
      pickedSet.add(w.word);
      selected.push({ ...w });
    }
  };

  // Reserve up to 2 slots for overdue past-week words when current week alone fills >= 9 slots,
  // ensuring past weeks' due reviews always mix into the 8-10 word session.
  const reservedPastSlots =
    duePast.length > 0 && dueCurrent.length >= maxWords - 1 ? Math.min(2, duePast.length) : 0;
  const maxCurrentDueSlots = Math.max(0, maxWords - reservedPastSlots);

  for (const w of dueCurrent.slice(0, maxCurrentDueSlots)) {
    addCandidate(w);
  }
  for (const w of duePast) {
    addCandidate(w);
  }
  // If room remains and dueCurrent had more items, fill up to maxWords
  for (const w of dueCurrent.slice(maxCurrentDueSlots)) {
    addCandidate(w);
  }

  // If total due words < minWords (8), top up to min(minWords, active.length) for a full session
  const targetMin = Math.min(minWords, active.length);
  if (selected.length < targetMin) {
    const extraCurrent = currentWeekWords.filter((w) => !pickedSet.has(w.word)).sort(sortByUrgency);
    const extraPast = pastWeekWords.filter((w) => !pickedSet.has(w.word)).sort(sortByUrgency);

    for (const w of [...extraCurrent, ...extraPast]) {
      if (selected.length >= targetMin) break;
      addCandidate(w);
    }
  }

  return shuffleGently(selected, prng);
}

/**
 * Pure computation of a single word record's SRS update after its first attempt in a session.
 * @param {WordRecord} current
 * @param {number} firstAttemptErrors
 * @param {string} [todayIso]
 * @returns {WordRecord}
 */
export function computeFirstAttemptSRSUpdate(current, firstAttemptErrors, todayIso) {
  const today = todayIso || getLocalISODate();
  const totalAttempts = (current.total_attempts || 0) + 1;

  let nextBox;
  let nextReview;
  let streak;
  let correctAttempts = current.correct_attempts || 0;

  if (firstAttemptErrors === 0) {
    nextBox = Math.min(5, (current.box || 1) + 1);
    const intervalDays = BOX_INTERVALS[nextBox] || 1;
    nextReview = addDaysISO(today, intervalDays);
    streak = (current.streak || 0) + 1;
    correctAttempts += 1;
  } else {
    nextBox = 1;
    nextReview = addDaysISO(today, 1); // Tomorrow (+1 day)
    streak = 0;
  }

  return {
    ...current,
    box: nextBox,
    next_review: nextReview,
    streak,
    total_attempts: totalAttempts,
    correct_attempts: correctAttempts
  };
}

/**
 * Updates long-term Leitner Box stats based ONLY on the FIRST attempt of the word in a session.
 * @param {string} targetWord
 * @param {number} firstAttemptErrors
 * @param {{ today?: string, storage?: StorageLike }} [options]
 * @returns {WordRecord | null} The updated word record
 */
export function recordFirstAttemptSRS(targetWord, firstAttemptErrors, options = {}) {
  const clean = normalizeWord(targetWord);
  if (!clean) return null;

  const store = getStorage(options.storage);
  const today = options.today || getLocalISODate();
  const words = loadWords(store, today);
  const idx = words.findIndex((w) => w.word === clean);
  if (idx === -1) return null;

  const updated = computeFirstAttemptSRSUpdate(words[idx], firstAttemptErrors, today);
  words[idx] = updated;
  saveWords(words, store);
  return updated;
}

/**
 * Adds or updates a weekly list of words from Parent Mode while keeping all historical words.
 * @param {Array<string | {word: string, custom_audio_url?: string}>} rawEntries
 * @param {string} [weekLabel]
 * @param {{ today?: string, storage?: StorageLike }} [options]
 */
export function addWeeklyWordList(rawEntries, weekLabel, options = {}) {
  const store = getStorage(options.storage);
  const today = options.today || getLocalISODate();
  const words = loadWords(store, today);
  const cleanWeek = String(weekLabel || '').trim() || suggestNextWeekLabel(words, store);
  const byWord = new Map(words.map((w, i) => [w.word, i]));
  /** @type {WordRecord[]} */
  const addedOrUpdated = [];

  for (const entry of rawEntries) {
    const rawText = typeof entry === 'string' ? entry : entry && entry.word ? entry.word : '';
    const customAudio =
      typeof entry === 'object' && entry && entry.custom_audio_url
        ? String(entry.custom_audio_url).trim()
        : '';
    const clean = normalizeWord(rawText);
    if (!clean) continue;

    if (byWord.has(clean)) {
      const existingIdx = /** @type {number} */ (byWord.get(clean));
      const existing = words[existingIdx];
      const refreshed = {
        ...existing,
        week_label: cleanWeek,
        active: true,
        next_review: today, // Make immediately due for the new week's practice
        custom_audio_url: customAudio || existing.custom_audio_url || ''
      };
      words[existingIdx] = refreshed;
      addedOrUpdated.push(refreshed);
    } else {
      const created = {
        word: clean,
        week_label: cleanWeek,
        active: true,
        box: 1,
        next_review: today,
        streak: 0,
        total_attempts: 0,
        correct_attempts: 0,
        custom_audio_url: customAudio
      };
      words.push(created);
      byWord.set(clean, words.length - 1);
      addedOrUpdated.push(created);
    }
  }

  if (addedOrUpdated.length > 0) {
    saveWords(words, store);
    setCurrentWeekLabel(cleanWeek, store);
  }

  return {
    weekLabel: cleanWeek,
    addedRecords: addedOrUpdated,
    allWords: words
  };
}

/**
 * Deletes a word from storage (used if a parent removes an accidental typo).
 * @param {string} wordToRemove
 * @param {{ today?: string, storage?: StorageLike }} [options]
 * @returns {WordRecord[]}
 */
export function removeWordFromStore(wordToRemove, options = {}) {
  const store = getStorage(options.storage);
  const today = options.today || getLocalISODate();
  const clean = normalizeWord(wordToRemove);
  const words = loadWords(store, today).filter((w) => w.word !== clean);
  const finalWords = words.length > 0 ? words : getDefaultStarterWords(today);
  saveWords(finalWords, store);
  return finalWords;
}

/**
 * Suggests a friendly next week label for the Parent Mode editor.
 * @param {WordRecord[]} [words]
 * @param {StorageLike} [customStorage]
 * @returns {string}
 */
export function suggestNextWeekLabel(words, customStorage) {
  const store = getStorage(customStorage);
  const resolvedWords = words || loadWords(store);
  const labels = new Set(resolvedWords.map((w) => w.week_label));
  let maxWeekNum = 0;
  for (const lbl of labels) {
    const m = /^week\s*(\d+)$/i.exec(String(lbl).trim());
    if (m) {
      maxWeekNum = Math.max(maxWeekNum, parseInt(m[1], 10));
    }
  }
  return `Week ${maxWeekNum + 1}`;
}

/**
 * Builds a weighted list of plausible lowercase distractor characters for smart bubble spawning.
 * Includes accented variants ONLY if the word list (or current word) uses accented characters,
 * and strictly excludes `requiredChar` so distractors never match `targetWord[currentIndex]`.
 *
 * @param {string} requiredChar
 * @param {string} currentWord
 * @param {Array<string | { word?: string }>} [allWords=[]]
 * @returns {string[]}
 */
export function getPlausibleDistractors(requiredChar, currentWord, allWords = []) {
  const req = String(requiredChar || '').toLowerCase();
  const vocabChars = new Set();
  let vocabHasAccents = false;

  for (const item of allWords) {
    const w = typeof item === 'string' ? item : item && item.word ? item.word : '';
    for (const ch of w.toLowerCase()) {
      vocabChars.add(ch);
      if (ch.charCodeAt(0) > 127) {
        vocabHasAccents = true;
      }
    }
  }
  for (const ch of String(currentWord || '').toLowerCase()) {
    vocabChars.add(ch);
    if (ch.charCodeAt(0) > 127) {
      vocabHasAccents = true;
    }
  }

  /** @type {string[]} */
  const pool = [];

  // 1. Add visually/phonetically plausible neighbor letters with higher weight
  const baseKey = req.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const neighbors = PLAUSIBLE_LETTER_NEIGHBORS[baseKey] || ['a', 'e', 'i', 'o', 's', 't', 'n', 'r'];
  for (const n of neighbors) {
    if (n !== req) {
      pool.push(n, n);
    }
  }

  // 2. If the word list uses accented characters, include accented variants as plausible distractors
  if (vocabHasAccents) {
    if (ACCENT_FAMILIES[baseKey]) {
      for (const variant of ACCENT_FAMILIES[baseKey]) {
        if (variant !== req) {
          pool.push(variant, variant, variant);
        }
      }
    }
    for (const ch of vocabChars) {
      if (ch.charCodeAt(0) > 127 && ch !== req) {
        pool.push(ch, ch);
      }
    }
  }

  // 3. Add general lowercase alphabet characters for natural variety
  for (const letter of BASE_LOWERCASE_ALPHABET) {
    if (letter !== req) {
      pool.push(letter);
    }
  }

  return pool.filter((ch) => ch !== req);
}

/**
 * Fisher-Yates shuffle with injectable PRNG.
 * @template T
 * @param {T[]} items
 * @param {() => number} [prng=Math.random]
 * @returns {T[]}
 */
export function shuffleGently(items, prng = Math.random) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
