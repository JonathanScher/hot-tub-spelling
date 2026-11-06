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
export const PROFILES_METADATA_KEY = 'hottub_profiles_meta_v1';
export const ACTIVE_PROFILE_KEY = 'hottub_active_profile_v1';
export const PROFILE_STATS_STORAGE_PREFIX = 'hottub_srs_profile_stats_v1_';
export const COSMETIC_STARS_PREFIX = 'hottub_stars_';

/**
 * @typedef {object} LearnerProfile
 * @property {string} id
 * @property {string} name
 * @property {boolean} isTest
 * @property {string} avatar
 * @property {Record<string, number>} [trapHistory]
 */

/**
 * @typedef {object} ProfileProgressRecord
 * @property {number} box
 * @property {string} next_review
 * @property {number} streak
 * @property {number} total_attempts
 * @property {number} correct_attempts
 */

/** @type {LearnerProfile[]} */
export const DEFAULT_PROFILES = [
  { id: 'daughter', name: 'Zoé', isTest: false, avatar: '👧', trapHistory: {} },
  { id: 'test', name: 'Test / Sandbox', isTest: true, avatar: '🧪', trapHistory: {} }
];

/**
 * Detects whether the current execution is in a local development environment.
 * @returns {boolean}
 */
export function isLocalDev() {
  if (typeof window === 'undefined' || !window.location) return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || window.location.protocol === 'file:';
}

/**
 * Retrieves the configured learner profiles, seeding defaults if not found.
 * @param {StorageLike} [customStorage]
 * @returns {LearnerProfile[]}
 */
export function getProfiles(customStorage) {
  const store = getStorage(customStorage);
  try {
    const raw = store.getItem(PROFILES_METADATA_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((p) => {
          const id = String(p.id || 'daughter');
          let name = String(p.name || (id === 'daughter' ? 'Zoé' : 'Test / Sandbox'));
          if (id === 'daughter' && name === 'Daughter') {
            name = 'Zoé';
          }
          return {
            id,
            name,
            isTest: Boolean(p.isTest),
            avatar: String(p.avatar || (p.isTest ? '🧪' : '👧')),
            trapHistory: p.trapHistory && typeof p.trapHistory === 'object' ? { ...p.trapHistory } : {}
          };
        });
      }
    }
  } catch {
    // Fall back to defaults on parse error
  }
  return DEFAULT_PROFILES.map((p) => ({
    ...p,
    trapHistory: { ...(p.trapHistory || {}) }
  }));
}

/**
 * Resolves the active profile ID ('daughter' or 'test').
 * In local development (localhost / 127.0.0.1), defaults to 'test' for safety
 * unless explicitly set in storage.
 * @param {StorageLike} [customStorage]
 * @returns {string}
 */
export function getActiveProfileId(customStorage) {
  const store = getStorage(customStorage);
  try {
    const stored = store.getItem(ACTIVE_PROFILE_KEY);
    if (stored && typeof stored === 'string') {
      const trimmed = stored.trim();
      if (trimmed) return trimmed;
    }
  } catch {
    // Ignore storage errors
  }
  // If running in local dev and no explicit profile saved, default to test for safety
  if (isLocalDev()) {
    return 'test';
  }
  return 'daughter';
}

/**
 * Retrieves the active LearnerProfile object.
 * @param {StorageLike} [customStorage]
 * @returns {LearnerProfile}
 */
export function getActiveProfile(customStorage) {
  const store = getStorage(customStorage);
  const activeId = getActiveProfileId(store);
  const profiles = getProfiles(store);
  const found = profiles.find((p) => p.id === activeId);
  if (found) return found;
  return profiles[0] || DEFAULT_PROFILES[0];
}

/**
 * Sets the active profile ID.
 * @param {string} profileId
 * @param {StorageLike} [customStorage]
 */
export function setActiveProfileId(profileId, customStorage) {
  const store = getStorage(customStorage);
  const cleanId = String(profileId || '').trim();
  if (cleanId) {
    store.setItem(ACTIVE_PROFILE_KEY, cleanId);
  }
}

/**
 * Renames a profile (e.g., customizes daughter's actual first name).
 * @param {string} profileId
 * @param {string} newName
 * @param {StorageLike} [customStorage]
 * @returns {LearnerProfile[]}
 */
export function updateProfileName(profileId, newName, customStorage) {
  const store = getStorage(customStorage);
  const profiles = getProfiles(store);
  const target = profiles.find((p) => p.id === profileId);
  if (target && newName && String(newName).trim()) {
    target.name = String(newName).trim();
    try {
      store.setItem(PROFILES_METADATA_KEY, JSON.stringify(profiles));
    } catch {
      // Ignore
    }
  }
  return profiles;
}

/**
 * Loads the isolated SRS progress map for a profile: { [word]: ProfileProgressRecord }
 * @param {string} profileId
 * @param {StorageLike} [customStorage]
 * @returns {Record<string, ProfileProgressRecord>}
 */
export function getProfileStatsMap(profileId, customStorage) {
  const store = getStorage(customStorage);
  try {
    const raw = store.getItem(PROFILE_STATS_STORAGE_PREFIX + profileId);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch {
    // Ignore
  }
  return {};
}

/**
 * Saves the isolated SRS progress map for a profile.
 * @param {string} profileId
 * @param {Record<string, ProfileProgressRecord>} statsMap
 * @param {StorageLike} [customStorage]
 */
export function saveProfileStatsMap(profileId, statsMap, customStorage) {
  const store = getStorage(customStorage);
  try {
    store.setItem(PROFILE_STATS_STORAGE_PREFIX + profileId, JSON.stringify(statsMap || {}));
  } catch (err) {
    console.warn('Failed to save profile stats map:', err);
  }
}

/**
 * Resets SRS progress for a specific profile (e.g. resets 'test' back to Box 1 and 0 attempts).
 * @param {string} profileId
 * @param {StorageLike} [customStorage]
 * @param {string} [todayIso]
 * @returns {WordRecord[]} The refreshed word list for that profile
 */
export function resetProfileProgress(profileId, customStorage, todayIso) {
  const store = getStorage(customStorage);
  const today = todayIso || getLocalISODate();
  const cleanId = String(profileId || '').trim();

  // Reset trapHistory in profile metadata as well
  const profiles = getProfiles(store);
  const targetProf = profiles.find((p) => p.id === cleanId);
  if (targetProf) {
    targetProf.trapHistory = {};
    try {
      store.setItem(PROFILES_METADATA_KEY, JSON.stringify(profiles));
    } catch {
      // Ignore
    }
  }

  if (cleanId === 'test') {
    if (typeof store.removeItem === 'function') {
      store.removeItem(PROFILE_STATS_STORAGE_PREFIX + 'test');
    } else {
      store.setItem(PROFILE_STATS_STORAGE_PREFIX + 'test', JSON.stringify({}));
    }
    return loadWords(store, today, 'test');
  }

  if (cleanId === 'daughter') {
    const words = loadWords(store, today, 'daughter');
    const reset = words.map((w) => ({
      ...w,
      box: 1,
      next_review: today,
      streak: 0,
      total_attempts: 0,
      correct_attempts: 0
    }));
    saveWords(reset, store, 'daughter');
    return reset;
  }

  if (typeof store.removeItem === 'function') {
    store.removeItem(PROFILE_STATS_STORAGE_PREFIX + cleanId);
  } else {
    store.setItem(PROFILE_STATS_STORAGE_PREFIX + cleanId, JSON.stringify({}));
  }
  return loadWords(store, today, cleanId);
}

/**
 * Normalizes a rule category name to canonical format.
 * @param {string} cat
 * @returns {string}
 */
export function normalizeCategoryName(cat) {
  const s = String(cat || '').toLowerCase().trim();
  if (s === 'silent finals' || s === 'silent_finals' || s === 'silentfinals' || s === 'silent-finals') {
    return 'silent finals';
  }
  if (s === 'b/d/p/q flips' || s === 'bd_flips' || s === 'bdflips' || s === 'visual_flips' || s === 'b/d/p/q' || s === 'bdpq_flips') {
    return 'b/d/p/q flips';
  }
  if (s === 'nasal vowels' || s === 'nasal_vowels' || s === 'nasalvowels' || s === 'nasal n/m' || s === 'nasal') {
    return 'nasal vowels';
  }
  if (s === 'accents' || s === 'accent') {
    return 'accents';
  }
  return s;
}

/**
 * Retrieves the trap history error counts map for a profile.
 * @param {string} [profileId]
 * @param {StorageLike} [customStorage]
 * @returns {Record<string, number>}
 */
export function getProfileTrapHistory(profileId, customStorage) {
  const store = getStorage(customStorage);
  const resolvedId = profileId || getActiveProfileId(store);
  const profiles = getProfiles(store);
  const prof = profiles.find((p) => p.id === resolvedId);
  return prof && prof.trapHistory && typeof prof.trapHistory === 'object'
    ? { ...prof.trapHistory }
    : {};
}

/**
 * Records a trap error for a specific rule category in a profile's trapHistory.
 * Supports:
 *   recordTrapError(category, { profileId, storage })
 *   recordTrapError(category, profileId, storage)
 *   recordTrapError(profileId, category, storage)
 *   recordTrapError(category) -> defaults to activeProfileId
 *
 * @param {string} categoryOrProfileId
 * @param {any} [profileIdOrCategoryOrOptions]
 * @param {StorageLike} [customStorage]
 * @returns {Record<string, number>}
 */
export function recordTrapError(categoryOrProfileId, profileIdOrCategoryOrOptions, customStorage) {
  let category = '';
  let profileId = '';
  let storage = customStorage;

  if (typeof categoryOrProfileId === 'string' && (categoryOrProfileId === 'daughter' || categoryOrProfileId === 'test')) {
    profileId = categoryOrProfileId;
    category = String(profileIdOrCategoryOrOptions || '');
  } else {
    category = String(categoryOrProfileId || '');
    if (typeof profileIdOrCategoryOrOptions === 'string') {
      profileId = profileIdOrCategoryOrOptions;
    } else if (profileIdOrCategoryOrOptions && typeof profileIdOrCategoryOrOptions === 'object') {
      profileId = profileIdOrCategoryOrOptions.profileId || '';
      if (profileIdOrCategoryOrOptions.storage) {
        storage = profileIdOrCategoryOrOptions.storage;
      }
    }
  }

  const store = getStorage(storage);
  const resolvedProfileId = profileId || getActiveProfileId(store);
  const profiles = getProfiles(store);
  const prof = profiles.find((p) => p.id === resolvedProfileId);
  if (!prof) return {};

  if (!prof.trapHistory || typeof prof.trapHistory !== 'object') {
    prof.trapHistory = {};
  }

  const rawCat = String(category || '').trim();
  const canonical = normalizeCategoryName(rawCat);
  const currentCount = prof.trapHistory[rawCat] || prof.trapHistory[canonical] || 0;
  const newCount = currentCount + 1;

  prof.trapHistory[rawCat] = newCount;
  prof.trapHistory[canonical] = newCount;
  // Also provide snake_case alias
  const snakeAlias = canonical.replace(/\s+/g, '_').replace(/[\/]/g, '');
  prof.trapHistory[snakeAlias] = newCount;

  try {
    store.setItem(PROFILES_METADATA_KEY, JSON.stringify(profiles));
  } catch (err) {
    console.warn('Failed to persist profile trapHistory:', err);
  }

  return { ...prof.trapHistory };
}

/**
 * Classifies a wrong tap error into a rule category.
 * @param {string} targetChar
 * @param {string} tappedChar
 * @param {string} [currentWord='']
 * @param {number} [currentIndex=-1]
 * @returns {string | null}
 */
export function classifyTrapError(targetChar, tappedChar, currentWord = '', currentIndex = -1) {
  const req = String(targetChar || '').toLowerCase();
  const tapped = String(tappedChar || '').toLowerCase();
  if (!req || !tapped || req === tapped) return null;

  const baseReq = req.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const baseTapped = tapped.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 1. Accents: same base letter with different accent (e.g. e vs é, c vs ç)
  if (baseReq === baseTapped && req !== tapped) {
    return 'accents';
  }
  if ((req === 'ç' && tapped === 'c') || (req === 'c' && tapped === 'ç')) {
    return 'accents';
  }

  // 2. b/d/p/q flips
  const bdSet = new Set(['b', 'd', 'p', 'q']);
  if (bdSet.has(req) && bdSet.has(tapped)) {
    return 'b/d/p/q flips';
  }

  // 3. Nasal vowels / n <-> m confusion
  if ((req === 'n' && tapped === 'm') || (req === 'm' && tapped === 'n')) {
    return 'nasal vowels';
  }

  // 4. Silent final consonants
  const chars = Array.from(String(currentWord || '').trim().toLowerCase());
  const idx = typeof currentIndex === 'number' ? currentIndex : -1;
  const isFinalChar = idx >= 0 && idx === chars.length - 1;
  const silentFinalTraps = new Set(['t', 'd', 's', 'x', 'p', 'g', 'c', 'z', 'e']);
  if (isFinalChar && isFrenchConsonant(req) && silentFinalTraps.has(tapped)) {
    return 'silent finals';
  }

  return null;
}

/**
 * Returns a summary of total words, due words, and mastered words for a given profile.
 * @param {string} profileId
 * @param {StorageLike} [customStorage]
 * @param {string} [todayIso]
 * @returns {{ totalWords: number, dueWords: number, masteredWords: number }}
 */
export function getProfileStatsSummary(profileId, customStorage, todayIso) {
  const store = getStorage(customStorage);
  const today = todayIso || getLocalISODate();
  const words = loadWords(store, today, profileId).filter((w) => w.active !== false);

  const totalWords = words.length;
  const dueWords = words.filter((w) => !w.next_review || w.next_review <= today).length;
  const masteredWords = words.filter((w) => w.box >= 4).length;

  return { totalWords, dueWords, masteredWords };
}

/**
 * @typedef {object} WordRecord
 * @property {string} word
 * @property {string} [week_label]
 * @property {boolean} active
 * @property {number} box
 * @property {string} next_review
 * @property {number} streak
 * @property {number} total_attempts
 * @property {number} correct_attempts
 * @property {string} [custom_audio_url]
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

/**
 * Visual Garden Metaphor stages corresponding to Leitner Boxes 1-5
 */
export const GARDEN_STAGES = {
  1: { level: 1, name: 'Seed', icon: 'assets/garden-stage-1.jpg', emoji: '🌱', intervalDays: 1, intervalLabel: 'Daily practice' },
  2: { level: 2, name: 'Sprout', icon: 'assets/garden-stage-2.jpg', emoji: '🌿', intervalDays: 2, intervalLabel: 'In 2 days' },
  3: { level: 3, name: 'Stem', icon: 'assets/garden-stage-3.jpg', emoji: '🪴', intervalDays: 4, intervalLabel: 'In 4 days' },
  4: { level: 4, name: 'Bud', icon: 'assets/garden-stage-4.jpg', emoji: '🌷', intervalDays: 7, intervalLabel: 'In 1 week' },
  5: { level: 5, name: 'Bloom', icon: 'assets/garden-stage-5.jpg', emoji: '🌻', intervalDays: 14, intervalLabel: 'In 2 weeks' }
};

/**
 * Returns the garden growth stage for a given box number.
 * @param {number | string} [boxNum]
 * @returns {typeof GARDEN_STAGES[1]}
 */
export function getGardenStage(boxNum) {
  const num = Math.min(5, Math.max(1, parseInt(String(boxNum), 10) || 1));
  return GARDEN_STAGES[num] || GARDEN_STAGES[1];
}

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
  b: ['d', 'p', 'q', 'g', 't', 'h'],
  c: ['s', 'k', 'q', 'g', 'o', 'e'],
  d: ['t', 'b', 'p', 'q', 'g'],
  e: ['a', 'o', 'i', 'u', 's'],
  f: ['v', 'p', 't', 'l', 'r'],
  g: ['c', 'j', 'k', 'q', 'd', 'p'],
  h: ['n', 'b', 'k', 'm', 'r'],
  i: ['e', 'y', 'l', 'j', 'u'],
  j: ['g', 'i', 'y', 'z', 's'],
  k: ['c', 'q', 'g', 'x'],
  l: ['i', 't', 'f', 'r'],
  m: ['n', 'u', 'w', 'b', 'r'],
  n: ['m', 'u', 'v', 'h', 'r'],
  o: ['a', 'u', 'e', 'c'],
  p: ['b', 'd', 'q', 'g', 't', 'r'],
  q: ['p', 'b', 'd', 'g', 'c', 'k'],
  r: ['n', 'l', 'v', 't'],
  s: ['c', 'z', 'x', 't'],
  t: ['d', 'f', 'p', 'l', 's'],
  u: ['v', 'n', 'm', 'o', 'a'],
  v: ['f', 'w', 'u', 'b'],
  w: ['v', 'm', 'u', 'n'],
  x: ['s', 'z', 'c', 'k'],
  y: ['i', 'j', 'u', 'v'],
  z: ['s', 'c', 'x']
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
 * Bundled offline audio files for Week 7 and Week 8 starter curriculum.
 * @type {Record<string, string>}
 */
export const DEFAULT_WORD_AUDIO_MAP = {
  'sans': 'assets/audio/words/sans.mp3',
  'suivre': 'assets/audio/words/suivre.mp3',
  'savoir': 'assets/audio/words/savoir.mp3',
  'sauter': 'assets/audio/words/sauter.mp3',
  'semaine': 'assets/audio/words/semaine.mp3',
  'serpent': 'assets/audio/words/serpent.mp3',
  'sortir': 'assets/audio/words/sortir.mp3',
  'soleil': 'assets/audio/words/soleil.mp3',
  'souvent': 'assets/audio/words/souvent.mp3',
  'câlin': 'assets/audio/words/câlin.mp3',
  'singe': 'assets/audio/words/singe.mp3',
  'enfin': 'assets/audio/words/enfin.mp3',
  'quinze': 'assets/audio/words/quinze.mp3',
  'prince': 'assets/audio/words/prince.mp3',
  'loin': 'assets/audio/words/loin.mp3',
  'printemps': 'assets/audio/words/printemps.mp3'
};

/**
 * Returns the default bundled audio URL for a given word if one exists.
 * @param {string} word
 * @returns {string}
 */
export function getDefaultAudioUrl(word) {
  const clean = normalizeWord(word);
  return DEFAULT_WORD_AUDIO_MAP[clean] || '';
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
      custom_audio_url: getDefaultAudioUrl(word)
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
      custom_audio_url: getDefaultAudioUrl(word)
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
 * Respects the active profile: if active profile is 'daughter', returns base words;
 * if 'test' (or other), overlays the isolated profile progress map onto the shared word list.
 *
 * @param {StorageLike} [customStorage]
 * @param {string} [todayIso]
 * @param {string} [profileId]
 * @returns {WordRecord[]}
 */
export function loadWords(customStorage, todayIso, profileId) {
  const store = getStorage(customStorage);
  const resolvedProfileId = profileId || getActiveProfileId(store);
  const today = todayIso || getLocalISODate();

  let baseWords = [];
  try {
    const raw = store.getItem(WORDS_STORAGE_KEY);
    if (!raw) {
      const defaults = getDefaultStarterWords(today);
      saveWords(defaults, store, 'daughter');
      store.setItem(CURRENT_WEEK_KEY, 'Week 8');
      baseWords = defaults;
    } else {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        const defaults = getDefaultStarterWords(today);
        saveWords(defaults, store, 'daughter');
        store.setItem(CURRENT_WEEK_KEY, 'Week 8');
        baseWords = defaults;
      } else {
        const seen = new Set();
        const cleaned = [];
        for (const item of parsed) {
          const rec = normalizeWordRecord(item, 'Week 8', today);
          if (rec.word && !seen.has(rec.word)) {
            seen.add(rec.word);
            if (!rec.custom_audio_url) {
              const def = getDefaultAudioUrl(rec.word);
              if (def) rec.custom_audio_url = def;
            }
            cleaned.push(rec);
          }
        }
        baseWords = cleaned.length > 0 ? cleaned : getDefaultStarterWords(today);
      }
    }
  } catch {
    baseWords = getDefaultStarterWords(today);
  }

  // If loading for daughter (default/production), base words hold daughter's stats directly
  if (resolvedProfileId === 'daughter') {
    return baseWords;
  }

  // For test profile (or custom profiles): overlay isolated profile stats onto base words
  const profileStats = getProfileStatsMap(resolvedProfileId, store);
  return baseWords.map((base) => {
    const prog = profileStats[base.word];
    if (prog) {
      return normalizeWordRecord(
        {
          ...base,
          box: prog.box,
          next_review: prog.next_review,
          streak: prog.streak,
          total_attempts: prog.total_attempts,
          correct_attempts: prog.correct_attempts
        },
        base.week_label,
        today
      );
    }
    // Brand new / unpracticed in this profile: fresh Box 1, due today, 0 attempts
    return {
      ...base,
      box: 1,
      next_review: today,
      streak: 0,
      total_attempts: 0,
      correct_attempts: 0
    };
  });
}

/**
 * Saves the complete word array to storage for the specified or active profile.
 * - For 'daughter': saves directly to WORDS_STORAGE_KEY.
 * - For other profiles (e.g. 'test'): updates base vocabulary in WORDS_STORAGE_KEY
 *   (word list, weeks, audio, active status) while isolating SRS stats to the profile's stats map.
 *
 * @param {WordRecord[]} words
 * @param {StorageLike} [customStorage]
 * @param {string} [profileId]
 */
export function saveWords(words, customStorage, profileId) {
  const store = getStorage(customStorage);
  const resolvedProfileId = profileId || getActiveProfileId(store);

  try {
    if (resolvedProfileId === 'daughter') {
      store.setItem(WORDS_STORAGE_KEY, JSON.stringify(words));
      return;
    }

    // For test or other profiles:
    // 1. Save SRS stats to isolated profile map
    const statsMap = getProfileStatsMap(resolvedProfileId, store);
    for (const w of words) {
      statsMap[w.word] = {
        box: w.box,
        next_review: w.next_review,
        streak: w.streak,
        total_attempts: w.total_attempts,
        correct_attempts: w.correct_attempts
      };
    }
    saveProfileStatsMap(resolvedProfileId, statsMap, store);

    // 2. If new words were introduced, ensure base vocabulary in WORDS_STORAGE_KEY has them
    // without overwriting existing daughter SRS progress for existing words
    const existingRaw = store.getItem(WORDS_STORAGE_KEY);
    if (existingRaw) {
      try {
        const existingList = JSON.parse(existingRaw);
        if (Array.isArray(existingList)) {
          const existingMap = new Map(existingList.map((item) => [item.word, item]));
          let modified = false;
          for (const w of words) {
            if (!existingMap.has(w.word)) {
              existingList.push({
                word: w.word,
                week_label: w.week_label,
                active: w.active !== false,
                box: 1,
                next_review: w.next_review,
                streak: 0,
                total_attempts: 0,
                correct_attempts: 0,
                custom_audio_url: w.custom_audio_url || ''
              });
              modified = true;
            }
          }
          if (modified) {
            store.setItem(WORDS_STORAGE_KEY, JSON.stringify(existingList));
          }
        }
      } catch {
        // Ignore
      }
    }
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
/**
 * Merges remote Firestore word documents with local storage without losing historical words
 * or overwriting un-synced offline local updates.
 * @param {Array<any>} remoteRows
 * @param {Set<string>} [dirtyWordsSet] - Words with pending offline SRS updates
 * @param {string} [remoteCurrentWeek] - Optional current week label from Firestore metadata
 * @param {StorageLike} [customStorage]
 * @param {string} [todayIso]
 * @param {string} [profileId]
 * @returns {WordRecord[]}
 */
export function mergeWordsFromCloud(
  remoteRows,
  dirtyWordsSet = new Set(),
  remoteCurrentWeek = '',
  customStorage = undefined,
  todayIso = '',
  profileId = ''
) {
  const store = getStorage(customStorage);
  const resolvedProfileId = profileId || getActiveProfileId(store);

  // Sync test profile stats from remote rows if present
  if (Array.isArray(remoteRows)) {
    const testStats = getProfileStatsMap('test', store);
    let testModified = false;
    for (const row of remoteRows) {
      if (row && row.word && row.profiles && typeof row.profiles === 'object' && row.profiles.test) {
        const pt = row.profiles.test;
        testStats[normalizeWord(row.word)] = {
          box: Math.min(5, Math.max(1, parseInt(String(pt.box), 10) || 1)),
          next_review: pt.next_review || todayIso || getLocalISODate(),
          streak: Math.max(0, parseInt(String(pt.streak), 10) || 0),
          total_attempts: Math.max(0, parseInt(String(pt.total_attempts), 10) || 0),
          correct_attempts: Math.max(0, parseInt(String(pt.correct_attempts), 10) || 0)
        };
        testModified = true;
      }
    }
    if (testModified) {
      saveProfileStatsMap('test', testStats, store);
    }
  }

  if (!Array.isArray(remoteRows) || remoteRows.length === 0) {
    return loadWords(store, todayIso, resolvedProfileId);
  }

  const localWords = loadWords(store, todayIso, 'daughter');
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
    if (!remoteRec.custom_audio_url) {
      const def = getDefaultAudioUrl(remoteRec.word);
      if (def) remoteRec.custom_audio_url = def;
    }

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
      // If remote row has explicit daughter profile progression, use it; otherwise fallback to root fields
      const dProg = row.profiles && row.profiles.daughter;
      if (dProg && typeof dProg === 'object') {
        mergedMap.set(remoteRec.word, {
          ...remoteRec,
          box: Math.min(5, Math.max(1, parseInt(String(dProg.box), 10) || 1)),
          next_review: dProg.next_review || remoteRec.next_review,
          streak: Math.max(0, parseInt(String(dProg.streak), 10) || 0),
          total_attempts: Math.max(0, parseInt(String(dProg.total_attempts), 10) || 0),
          correct_attempts: Math.max(0, parseInt(String(dProg.correct_attempts), 10) || 0)
        });
      } else {
        mergedMap.set(remoteRec.word, {
          ...remoteRec
        });
      }
    }
  }

  const mergedList = Array.from(mergedMap.values());
  saveWords(mergedList, store, 'daughter');

  const weekToUse = remoteCurrentWeek || highestWeekLabel;
  if (weekToUse) {
    setCurrentWeekLabel(weekToUse, store);
  }
  return loadWords(store, todayIso, resolvedProfileId);
}

/**
 * Retrieves the cosmetic stars count for a profile.
 * @param {string} [profileId]
 * @param {StorageLike} [customStorage]
 * @returns {number}
 */
export function getCosmeticStars(profileId, customStorage) {
  const store = getStorage(customStorage);
  const pid = profileId || getActiveProfileId(store);
  const raw = store.getItem(`${COSMETIC_STARS_PREFIX}${pid}`);
  const num = parseInt(raw || '0', 10);
  return Number.isNaN(num) || num < 0 ? 0 : num;
}

/**
 * Awards bonus cosmetic stars to a profile.
 * @param {number} count
 * @param {string} [profileId]
 * @param {StorageLike} [customStorage]
 * @returns {number} The updated total star count
 */
export function awardCosmeticStars(count = 1, profileId, customStorage) {
  const store = getStorage(customStorage);
  const pid = profileId || getActiveProfileId(store);
  const current = getCosmeticStars(pid, store);
  const updated = current + Math.max(0, count);
  try {
    store.setItem(`${COSMETIC_STARS_PREFIX}${pid}`, String(updated));
  } catch {
    // Ignore storage errors
  }
  return updated;
}

/**
 * Checks whether all active words for the profile have been reviewed for today (0 due words).
 * @param {string} [profileId]
 * @param {StorageLike} [customStorage]
 * @param {string} [todayIso]
 * @returns {boolean}
 */
export function areAllDueWordsCleared(profileId, customStorage, todayIso) {
  const summary = getProfileStatsSummary(profileId, customStorage, todayIso);
  return summary.dueWords === 0;
}

/**
 * Builds an 8 to 10 word session queue, or a 3-word Quick Splash queue:
 * - Prioritizes all active words from the current week due for practice,
 *   mixed with past weeks' words due for review based on next_review <= today.
 * - In Quick Splash mode (quickSplash: true or mode: 'quick' / 'quickSplash'):
 *   Extracts at most 3 words, ONLY due words (next_review <= today), without padding.
 * - In standard mode: If fewer than 8 words are currently due (e.g., playing an extra practice round),
 *   tops up cleanly from current week first, then past weeks, up to 8-10 words.
 *
 * @param {WordRecord[]} [allWords]
 * @param {number} [minWords=8]
 * @param {number} [maxWords=10]
 * @param {{ today?: string, prng?: () => number, storage?: StorageLike, profileId?: string, quickSplash?: boolean, quick?: boolean, mode?: string }} [options]
 * @returns {WordRecord[]}
 */
export function buildSessionWords(allWords, minWords = 8, maxWords = 10, options = {}) {
  const store = getStorage(options.storage);
  const today = options.today || getLocalISODate();
  const prng = options.prng || Math.random;
  const profileId = options.profileId;
  const isQuickSplash = Boolean(
    options.quickSplash ||
    options.quick ||
    options.mode === 'quickSplash' ||
    options.mode === 'quick'
  );
  const effectiveMax = isQuickSplash ? 3 : maxWords;
  const sourceWords = allWords !== undefined ? allWords : loadWords(store, today, profileId);

  const active = sourceWords.filter((w) => w && w.active !== false && w.word && w.word.length > 0);
  if (active.length === 0) {
    if (isQuickSplash) return [];
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
    if (!pickedSet.has(w.word) && selected.length < effectiveMax) {
      pickedSet.add(w.word);
      selected.push({ ...w });
    }
  };

  // Reserve up to 2 slots for overdue past-week words when current week alone fills >= 9 slots,
  // ensuring past weeks' due reviews always mix into the 8-10 word session.
  const reservedPastSlots =
    !isQuickSplash && duePast.length > 0 && dueCurrent.length >= effectiveMax - 1 ? Math.min(2, duePast.length) : 0;
  const maxCurrentDueSlots = Math.max(0, effectiveMax - reservedPastSlots);

  for (const w of dueCurrent.slice(0, maxCurrentDueSlots)) {
    addCandidate(w);
  }
  for (const w of duePast) {
    addCandidate(w);
  }
  // If room remains and dueCurrent had more items, fill up to effectiveMax
  for (const w of dueCurrent.slice(maxCurrentDueSlots)) {
    addCandidate(w);
  }

  // If total due words < minWords (8), top up to min(minWords, active.length) for a full session
  if (!isQuickSplash) {
    const targetMin = Math.min(minWords, active.length);
    if (selected.length < targetMin) {
      const extraCurrent = currentWeekWords.filter((w) => !pickedSet.has(w.word)).sort(sortByUrgency);
      const extraPast = pastWeekWords.filter((w) => !pickedSet.has(w.word)).sort(sortByUrgency);

      for (const w of [...extraCurrent, ...extraPast]) {
        if (selected.length >= targetMin) break;
        addCandidate(w);
      }
    }
  }

  return shuffleGently(selected, prng);
}

/**
 * Checks whether two characters are unaccented lookalikes (e.g. 'a' vs 'à' or 'é' vs 'è'),
 * sharing the same base Latin character while not being identical.
 * @param {string} charA
 * @param {string} charB
 * @returns {boolean}
 */
export function isUnaccentedLookalike(charA, charB) {
  if (!charA || !charB) return false;
  const a = String(charA).trim().toLowerCase();
  const b = String(charB).trim().toLowerCase();
  if (a === b) return false;
  const baseA = a.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const baseB = b.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return Boolean(baseA && baseA === baseB);
}

/**
 * Checks whether tappedChar is an adjacent letter in the target word
 * (immediately preceding or following targetIndex) or adjacent in the alphabet.
 * @param {string} tappedChar
 * @param {string} [targetChar]
 * @param {string} [word]
 * @param {number} [targetIndex]
 * @returns {boolean}
 */
export function isAdjacentLetter(tappedChar, targetChar, word, targetIndex) {
  if (!tappedChar) return false;
  const tapped = String(tappedChar).trim().toLowerCase();
  const baseTapped = tapped.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 1. Check adjacency in the target word (previous or next letter in word)
  if (word) {
    const chars = Array.from(String(word).trim().toLowerCase());
    const idx =
      typeof targetIndex === 'number' && targetIndex >= 0
        ? targetIndex
        : (targetChar ? chars.findIndex((ch) => ch === targetChar || ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '') === targetChar) : -1);

    if (idx !== -1) {
      const candidates = [];
      if (idx > 0) candidates.push(chars[idx - 1]);
      if (idx < chars.length - 1) candidates.push(chars[idx + 1]);

      for (const cand of candidates) {
        if (tapped === cand) return true;
        const baseCand = cand.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (baseTapped === baseCand) return true;
      }
    }
  }

  // 2. Check adjacency in the alphabet (e.g. 'b' or 'd' for 'c')
  if (targetChar) {
    const target = String(targetChar).trim().toLowerCase();
    const baseTarget = target.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (baseTapped && baseTarget && baseTapped !== baseTarget) {
      if (Math.abs(baseTapped.charCodeAt(0) - baseTarget.charCodeAt(0)) === 1) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Determines whether a first-attempt error was a motor slip vs a spelling gap.
 * A motor slip occurs ONLY when:
 * 1) firstAttemptErrors is exactly 1,
 * 2) hint watermark was NOT used,
 * 3) the wrong tap was an unaccented lookalike or adjacent letter.
 *
 * @param {Record<string, any>} [details={}]
 * @returns {boolean}
 */
export function isMotorSlip(details = {}) {
  if (!details || typeof details !== 'object') return false;
  if (details.isMotorSlip === true) return true;
  if (details.isMotorSlip === false) return false;

  const errors =
    typeof details.errors === 'number'
      ? details.errors
      : typeof details.firstAttemptErrors === 'number'
      ? details.firstAttemptErrors
      : 0;

  if (errors !== 1) return false;

  const hintUsed = Boolean(details.hintWatermarkUsed || details.watermarkUsed || details.hintUsed);
  if (hintUsed) return false;

  let wrongTap = details.wrongTap || details.tappedChar || '';
  let targetChar = details.targetChar || '';
  let targetIndex = typeof details.targetIndex === 'number' ? details.targetIndex : -1;
  const word = details.word || '';

  if (Array.isArray(details.wrongTaps) && details.wrongTaps.length > 0) {
    const firstWrong = details.wrongTaps[0];
    if (firstWrong) {
      wrongTap = firstWrong.tappedChar || firstWrong.wrongTap || wrongTap;
      targetChar = firstWrong.targetChar || targetChar;
      if (typeof firstWrong.targetIndex === 'number') {
        targetIndex = firstWrong.targetIndex;
      }
    }
  }

  if (!wrongTap) return false;

  if (targetChar && isUnaccentedLookalike(wrongTap, targetChar)) {
    return true;
  }

  if (isAdjacentLetter(wrongTap, targetChar, word, targetIndex)) {
    return true;
  }

  return false;
}

/**
 * Pure computation of a single word record's SRS update after its first attempt in a session.
 *
 * Softened Leitner Reset Rules:
 * - firstAttemptErrors === 0:
 *     box = min(5, box + 1), next_review = today + BOX_INTERVALS[box], streak = streak + 1, correct_attempts += 1
 * - firstAttemptErrors === 1 AND motor slip (unaccented lookalike or adjacent letter, without hint watermark):
 *     box = max(1, box - 1), next_review = today + BOX_INTERVALS[box], streak = max(0, min(streak - 1, box - 1))
 * - firstAttemptErrors >= 2 OR hint watermark used OR non-slip error (spelling gap):
 *     box = 1, next_review = today + 1 day, streak = 0
 *
 * @param {WordRecord} current
 * @param {number | Record<string, any>} firstAttemptErrors
 * @param {string} [todayIso]
 * @param {Record<string, any>} [options={}]
 * @returns {WordRecord}
 */
export function computeFirstAttemptSRSUpdate(current, firstAttemptErrors, todayIso, options = {}) {
  const today = todayIso || getLocalISODate();
  const totalAttempts = (current.total_attempts || 0) + 1;

  let errors = 0;
  let opts = options || {};

  if (typeof firstAttemptErrors === 'number') {
    errors = firstAttemptErrors;
  } else if (firstAttemptErrors && typeof firstAttemptErrors === 'object') {
    errors =
      typeof firstAttemptErrors.firstAttemptErrors === 'number'
        ? firstAttemptErrors.firstAttemptErrors
        : typeof firstAttemptErrors.errors === 'number'
        ? firstAttemptErrors.errors
        : 0;
    opts = { ...firstAttemptErrors, ...opts };
  }

  if (!opts.word && current.word) opts.word = current.word;

  let nextBox;
  let nextReview;
  let streak;
  let correctAttempts = current.correct_attempts || 0;

  if (errors === 0) {
    nextBox = Math.min(5, (current.box || 1) + 1);
    const intervalDays = BOX_INTERVALS[nextBox] || 1;
    nextReview = addDaysISO(today, intervalDays);
    streak = (current.streak || 0) + 1;
    correctAttempts += 1;
  } else {
    const motorSlip = isMotorSlip({ ...opts, errors });
    if (motorSlip) {
      nextBox = Math.max(1, (current.box || 1) - 1);
      const intervalDays = BOX_INTERVALS[nextBox] || 1;
      nextReview = addDaysISO(today, intervalDays);
      streak = Math.max(0, Math.min((current.streak || 0) > 0 ? current.streak - 1 : 0, nextBox - 1));
    } else {
      nextBox = 1;
      nextReview = addDaysISO(today, 1); // Tomorrow (+1 day)
      streak = 0;
    }
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
 * @param {number | object} firstAttemptErrors
 * @param {{ today?: string, storage?: StorageLike, profileId?: string, [key: string]: any }} [options]
 * @returns {WordRecord | null} The updated word record
 */
export function recordFirstAttemptSRS(targetWord, firstAttemptErrors, options = {}) {
  const clean = normalizeWord(targetWord);
  if (!clean) return null;

  const store = getStorage(options.storage);
  const today = options.today || getLocalISODate();
  const profileId = options.profileId || getActiveProfileId(store);
  const words = loadWords(store, today, profileId);
  const idx = words.findIndex((w) => w.word === clean);
  if (idx === -1) return null;

  const mergedOpts = {
    word: clean,
    ...options
  };

  const updated = computeFirstAttemptSRSUpdate(words[idx], firstAttemptErrors, today, mergedOpts);
  words[idx] = updated;
  saveWords(words, store, profileId);
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
  const words = loadWords(store, today, 'daughter');
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
    saveWords(words, store, 'daughter');
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
  const words = loadWords(store, today, 'daughter').filter((w) => w.word !== clean);
  const finalWords = words.length > 0 ? words : getDefaultStarterWords(today);
  saveWords(finalWords, store, 'daughter');

  // Also clean up from test stats map if present
  const testStats = getProfileStatsMap('test', store);
  if (testStats[clean]) {
    delete testStats[clean];
    saveProfileStatsMap('test', testStats, store);
  }

  return loadWords(store, today);
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

const FRENCH_VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y', 'à', 'â', 'ä', 'é', 'è', 'ê', 'ë', 'î', 'ï', 'ô', 'ö', 'ù', 'û', 'ü']);

function isFrenchVowel(c) {
  return FRENCH_VOWELS.has(c);
}

function isFrenchConsonant(c) {
  return /^[a-zç]$/i.test(c) && !FRENCH_VOWELS.has(c);
}

/**
 * Helper to add weighted trap letters to the pool.
 * Prevents adding reqChar and strictly obeys vocabHasAccents constraint.
 * @param {string[]} pool
 * @param {string} ch
 * @param {number} count
 * @param {boolean} vocabHasAccents
 * @param {string} req
 */
function addDistractorTrap(pool, ch, count, vocabHasAccents, req) {
  if (!ch || ch === req) return;
  if (ch.charCodeAt(0) > 127 && !vocabHasAccents) return;
  for (let i = 0; i < count; i++) {
    pool.push(ch);
  }
}

/**
 * Builds a weighted list of plausible lowercase distractor characters for smart bubble spawning.
 * Includes accented variants ONLY if the word list (or current word) uses accented characters,
 * and strictly excludes `requiredChar` so distractors never match `targetWord[currentIndex]`.
 * Supports dynamic category weighting according to personal profile error history (trapHistory)
 * and strictly caps any single category at 50% of the total distractor pool.
 *
 * @param {string} requiredChar
 * @param {string} currentWord
 * @param {Array<string | { word?: string }>} [allWords=[]]
 * @param {number} [targetIndex=-1]
 * @param {any} [profileOrTrapHistory=null]
 * @returns {string[]}
 */
export function getPlausibleDistractors(
  requiredChar,
  currentWord,
  allWords = [],
  targetIndex = -1,
  profileOrTrapHistory = null
) {
  const req = String(requiredChar || '').toLowerCase();
  const vocabChars = new Set();
  let vocabHasAccents = false;

  if (req.charCodeAt(0) > 127) {
    vocabHasAccents = true;
  }

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

  // Resolve personal profile trapHistory
  let trapHistory = null;
  if (profileOrTrapHistory) {
    if (typeof profileOrTrapHistory === 'object') {
      if (profileOrTrapHistory.trapHistory && typeof profileOrTrapHistory.trapHistory === 'object') {
        trapHistory = profileOrTrapHistory.trapHistory;
      } else {
        trapHistory = profileOrTrapHistory;
      }
    } else if (typeof profileOrTrapHistory === 'string') {
      trapHistory = getProfileTrapHistory(profileOrTrapHistory);
    }
  }

  const getCatErrors = (cat) => {
    if (!trapHistory || typeof trapHistory !== 'object') return 0;
    const targetNorm = normalizeCategoryName(cat);
    for (const [k, v] of Object.entries(trapHistory)) {
      if (normalizeCategoryName(k) === targetNorm) {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : 0;
      }
    }
    return 0;
  };

  const silentErrors = getCatErrors('silent finals');
  const bdErrors = getCatErrors('b/d/p/q flips');
  const nasalErrors = getCatErrors('nasal vowels');
  const accentErrors = getCatErrors('accents');
  const totalTrackedErrors = silentErrors + bdErrors + nasalErrors + accentErrors;

  const getWeightMultiplier = (errors) => {
    if (totalTrackedErrors === 0) return 1.0;
    if (errors === 0) return 0.5;
    const ratio = errors / totalTrackedErrors;
    return Math.max(1.5, 1.0 + ratio * 3.5);
  };

  const silentMult = getWeightMultiplier(silentErrors);
  const bdMult = getWeightMultiplier(bdErrors);
  const nasalMult = getWeightMultiplier(nasalErrors);
  const accentMult = getWeightMultiplier(accentErrors);

  /** @type {Array<{ char: string, category: string }>} */
  const taggedPool = [];

  function addTagged(ch, count, category) {
    if (!ch || ch === req) return;
    if (ch.charCodeAt(0) > 127 && !vocabHasAccents) return;
    for (let i = 0; i < count; i++) {
      taggedPool.push({ char: ch, category });
    }
  }

  const chars = Array.from(String(currentWord || '').trim().toLowerCase());
  const idx = typeof targetIndex === 'number' ? targetIndex : -1;
  const prevChar = idx > 0 ? chars[idx - 1] : '';
  const nextChar = idx >= 0 && idx < chars.length - 1 ? chars[idx + 1] : '';
  const nextNextChar = idx >= 0 && idx < chars.length - 2 ? chars[idx + 2] : '';
  const baseKey = req.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 1. Contextual Nasal Consonant Rule (n <-> m after a vowel / devant m, b, p)
  if (req === 'm' || req === 'n') {
    const isAfterVowel = prevChar && isFrenchVowel(prevChar);
    const isBeforeMBP = nextChar === 'm' || nextChar === 'b' || nextChar === 'p';
    if (isAfterVowel || isBeforeMBP) {
      const nasalCount = Math.max(2, Math.round(7 * nasalMult));
      if (req === 'm') {
        addTagged('n', nasalCount, 'nasal vowels');
      } else {
        addTagged('m', nasalCount, 'nasal vowels');
      }
    }
  }

  // 2. Double Consonant Trap (L[i] === L[i-1])
  if (idx > 0 && prevChar === req) {
    if (nextChar) {
      addTagged(nextChar, 7, 'double consonants');
    }
  }

  // 3. Silent Final Consonants (i === chars.length - 1)
  if (idx === chars.length - 1 && isFrenchConsonant(req)) {
    const finalSilentTraps = ['t', 'd', 's', 'x', 'p', 'g', 'c', 'z', 'e'];
    const silentCount = Math.max(2, Math.round(5 * silentMult));
    for (const trap of finalSilentTraps) {
      addTagged(trap, silentCount, 'silent finals');
    }
  }

  // 4. Phoneme-Grapheme Matrix (CPG Auditory Traps)
  // 4.1 [s] and [z] traps
  if (req === 'c') {
    addTagged('s', 6, 'phonemes');
    addTagged('z', 4, 'phonemes');
    if (vocabHasAccents) {
      const accCount = Math.max(2, Math.round(5 * accentMult));
      addTagged('ç', accCount, 'accents');
    }
  } else if (req === 'ç') {
    const accCount = Math.max(2, Math.round(6 * accentMult));
    addTagged('c', accCount, 'accents');
    addTagged('s', 6, 'phonemes');
  } else if (req === 's') {
    addTagged('c', 5, 'phonemes');
    if (vocabHasAccents) {
      const accCount = Math.max(2, Math.round(5 * accentMult));
      addTagged('ç', accCount, 'accents');
    }
    if (prevChar && isFrenchVowel(prevChar) && nextChar && isFrenchVowel(nextChar)) {
      addTagged('z', 6, 'phonemes');
      addTagged('c', 6, 'phonemes');
    } else {
      addTagged('z', 4, 'phonemes');
    }
  } else if (req === 'z') {
    addTagged('s', 6, 'phonemes');
    addTagged('c', 5, 'phonemes');
  }

  // 4.2 [k] and mandatory 'u' after 'q'
  if (req === 'q') {
    addTagged('c', 6, 'phonemes');
    addTagged('k', 6, 'phonemes');
  } else if (req === 'k') {
    addTagged('c', 6, 'phonemes');
    addTagged('q', 6, 'phonemes');
  } else if (req === 'c' && (!nextChar || nextChar === 'a' || nextChar === 'o' || nextChar === 'u' || isFrenchConsonant(nextChar))) {
    addTagged('q', 5, 'phonemes');
    addTagged('k', 5, 'phonemes');
  }

  if (req === 'u' && prevChar === 'q') {
    if (nextChar) {
      addTagged(nextChar, 14, 'phonemes');
    }
  }

  // 4.3 [ʒ] traps & euphonious 'e' after 'g'
  if (req === 'g') {
    addTagged('j', 6, 'phonemes');
  } else if (req === 'j') {
    addTagged('g', 6, 'phonemes');
  }

  if (req === 'e' && prevChar === 'g' && (nextChar === 'a' || nextChar === 'o' || nextChar === 'u')) {
    addTagged(nextChar, 6, 'phonemes');
    addTagged('j', 6, 'phonemes');
  }

  // 4.4 Mandatory 'u' omission after 'g' (e.g. guêpe)
  if (req === 'u' && prevChar === 'g') {
    if (nextChar) {
      addTagged(nextChar, 6, 'phonemes');
    }
    addTagged('e', 6, 'phonemes');
    if (vocabHasAccents) {
      const accCount = Math.max(2, Math.round(6 * accentMult));
      addTagged('ê', accCount, 'accents');
      addTagged('é', Math.max(2, Math.round(5 * accentMult)), 'accents');
    }
  }

  // 4.5 [o] traps (eau, au)
  if (req === 'e' && nextChar === 'a' && nextNextChar === 'u') {
    addTagged('o', 6, 'phonemes');
    addTagged('a', 6, 'phonemes');
    if (vocabHasAccents) {
      addTagged('ô', Math.max(2, Math.round(5 * accentMult)), 'accents');
    }
  }
  if (req === 'a' && nextChar === 'u') {
    addTagged('o', 6, 'phonemes');
    addTagged('e', 6, 'phonemes');
    if (vocabHasAccents) {
      addTagged('ô', Math.max(2, Math.round(5 * accentMult)), 'accents');
    }
  }

  // 4.6 [f] traps (f vs p from ph, and voiced v)
  if (req === 'f') {
    addTagged('p', 5, 'phonemes');
    addTagged('v', 5, 'phonemes');
  } else if (req === 'p' && nextChar === 'h') {
    addTagged('f', 6, 'phonemes');
  }

  // 4.7 [e] / [ɛ] variants
  if (baseKey === 'e' && vocabHasAccents) {
    const eVariants = ['e', 'é', 'è', 'ê', 'a'];
    const accCount = Math.max(2, Math.round(6 * accentMult));
    for (const v of eVariants) {
      addTagged(v, accCount, 'accents');
    }
  }

  // 5. Silent H (index 0)
  if (idx === 0) {
    if (req === 'h' && nextChar) {
      addTagged(nextChar, 7, 'silent h');
    } else if (isFrenchVowel(req)) {
      addTagged('h', 5, 'silent h');
    }
  }

  // 6. Plausible Neighbor Letters (Minimal Pairs & Visual Symmetries)
  const neighbors = PLAUSIBLE_LETTER_NEIGHBORS[baseKey] || ['a', 'e', 'i', 'o', 's', 't', 'n', 'r'];
  const bdChars = new Set(['b', 'd', 'p', 'q']);
  for (const n of neighbors) {
    if (n !== req) {
      if (bdChars.has(baseKey) && bdChars.has(n)) {
        const count = Math.max(1, Math.round(4 * bdMult));
        addTagged(n, count, 'b/d/p/q flips');
      } else {
        addTagged(n, 4, 'neighbors');
      }
    }
  }

  // 7. Accented Families & Vocab Accents
  if (vocabHasAccents) {
    if (ACCENT_FAMILIES[baseKey]) {
      const accCount = Math.max(1, Math.round(3 * accentMult));
      for (const variant of ACCENT_FAMILIES[baseKey]) {
        if (variant !== req) {
          addTagged(variant, accCount, 'accents');
        }
      }
    }
    for (const ch of vocabChars) {
      if (ch.charCodeAt(0) > 127 && ch !== req) {
        addTagged(ch, 2, 'accents');
      }
    }
  }

  // 8. General Lowercase Alphabet
  for (const letter of BASE_LOWERCASE_ALPHABET) {
    if (letter !== req) {
      addTagged(letter, 1, 'alphabet');
    }
  }

  // Strict Capping: Cap any single category at 50% of the distractor pool
  let changed = true;
  while (changed) {
    changed = false;
    const catCounts = new Map();
    for (const item of taggedPool) {
      catCounts.set(item.category, (catCounts.get(item.category) || 0) + 1);
    }

    const total = taggedPool.length;
    for (const [cat, count] of catCounts.entries()) {
      const otherCount = total - count;
      const maxAllowed = Math.max(1, otherCount);
      if (count > maxAllowed) {
        const indices = [];
        for (let i = 0; i < taggedPool.length; i++) {
          if (taggedPool[i].category === cat) {
            indices.push(i);
          }
        }

        const byChar = new Map();
        for (const i of indices) {
          const ch = taggedPool[i].char;
          if (!byChar.has(ch)) byChar.set(ch, []);
          byChar.get(ch).push(i);
        }

        const distinctChars = Array.from(byChar.keys());
        const targetPerChar = Math.floor(maxAllowed / distinctChars.length);
        const remainder = maxAllowed % distinctChars.length;
        const toKeepIndices = new Set();
        distinctChars.forEach((ch, idx) => {
          const charIndices = byChar.get(ch);
          const keepNum = Math.max(1, targetPerChar + (idx < remainder ? 1 : 0));
          charIndices.slice(0, keepNum).forEach((id) => toKeepIndices.add(id));
        });

        if (toKeepIndices.size > maxAllowed) {
          const arr = Array.from(toKeepIndices);
          while (arr.length > maxAllowed) {
            toKeepIndices.delete(arr.pop());
          }
        }

        const filtered = [];
        for (let i = 0; i < taggedPool.length; i++) {
          if (taggedPool[i].category !== cat || toKeepIndices.has(i)) {
            filtered.push(taggedPool[i]);
          }
        }
        taggedPool.length = 0;
        taggedPool.push(...filtered);
        changed = true;
        break;
      }
    }
  }

  const pool = taggedPool.map((item) => item.char);

  const categoryCounts = {};
  for (const item of taggedPool) {
    categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
    const norm = normalizeCategoryName(item.category);
    if (norm !== item.category) {
      categoryCounts[norm] = categoryCounts[item.category];
    }
    const snakeAlias = norm.replace(/\s+/g, '_').replace(/[\/]/g, '');
    categoryCounts[snakeAlias] = categoryCounts[item.category];
  }

  Object.defineProperty(pool, 'categoryCounts', {
    value: categoryCounts,
    writable: true,
    enumerable: false,
    configurable: true
  });

  return pool;
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
