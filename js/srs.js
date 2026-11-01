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

const WORDS_STORAGE_KEY = 'hottub_srs_words_v1';
const CURRENT_WEEK_KEY = 'hottub_current_week_label_v1';

export const BOX_INTERVALS = {
  1: 1,
  2: 2,
  3: 4,
  4: 7,
  5: 14
};

const BASE_LOWERCASE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');

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
 * @returns {string}
 */
export function addDaysISO(baseIso, daysToAdd) {
  const parts = String(baseIso || getLocalISODate()).split('-').map(Number);
  const d = parts.length === 3 && !parts.some(Number.isNaN)
    ? new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0)
    : new Date();
  d.setDate(d.getDate() + Number(daysToAdd || 0));
  return getLocalISODate(d);
}

/**
 * Default starter list of 8 kid-friendly English words so the game is
 * immediately playable out of the box before connecting Google Sheets.
 */
export function getDefaultStarterWords() {
  const today = getLocalISODate();
  const starter = [
    'water',
    'bubble',
    'warm',
    'duck',
    'soap',
    'towel',
    'happy',
    'clean'
  ];

  return starter.map((word) => ({
    word,
    week_label: 'Week 1',
    active: true,
    box: 1,
    next_review: today,
    streak: 0,
    total_attempts: 0,
    correct_attempts: 0,
    custom_audio_url: ''
  }));
}

/**
 * Normalizes a word string to strict lowercase while preserving accented letters.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeWord(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * Normalizes a full word record to match the Google Sheets & LocalStorage schema.
 */
export function normalizeWordRecord(raw, fallbackWeek = 'Week 1') {
  const today = getLocalISODate();
  const word = normalizeWord(raw && raw.word ? raw.word : raw);
  const boxNum = Math.min(5, Math.max(1, parseInt(raw && raw.box, 10) || 1));
  const totalAttempts = Math.max(0, parseInt(raw && raw.total_attempts, 10) || 0);
  const streak = Math.max(0, parseInt(raw && raw.streak, 10) || 0);

  let correctAttempts;
  if (raw && typeof raw.correct_attempts === 'number' && !Number.isNaN(raw.correct_attempts)) {
    correctAttempts = Math.min(totalAttempts, Math.max(0, Math.round(raw.correct_attempts)));
  } else if (totalAttempts > 0) {
    // Estimate accurately when importing rows from 8-column Google Sheet
    correctAttempts = Math.min(totalAttempts, Math.max(streak, boxNum > 1 ? boxNum - 1 : 0));
  } else {
    correctAttempts = 0;
  }

  let active = true;
  if (raw && (raw.active === false || String(raw.active).toLowerCase() === 'false')) {
    active = false;
  }

  const nextReviewRaw = raw && raw.next_review ? String(raw.next_review).trim().slice(0, 10) : '';
  const nextReview = /^\d{4}-\d{2}-\d{2}$/.test(nextReviewRaw) ? nextReviewRaw : today;

  return {
    word,
    week_label: String((raw && raw.week_label) || fallbackWeek).trim() || fallbackWeek,
    active,
    box: boxNum,
    next_review: nextReview,
    streak,
    total_attempts: totalAttempts,
    correct_attempts: correctAttempts,
    custom_audio_url: String((raw && (raw.custom_audio_url || raw.audio_url)) || '').trim()
  };
}

/**
 * Loads all words from localStorage, seeding the 8 starter words on first run.
 */
export function loadWords() {
  try {
    const raw = localStorage.getItem(WORDS_STORAGE_KEY);
    if (!raw) {
      const defaults = getDefaultStarterWords();
      saveWords(defaults);
      localStorage.setItem(CURRENT_WEEK_KEY, 'Week 1');
      return defaults;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const defaults = getDefaultStarterWords();
      saveWords(defaults);
      return defaults;
    }

    const seen = new Set();
    const cleaned = [];
    for (const item of parsed) {
      const rec = normalizeWordRecord(item);
      if (rec.word && !seen.has(rec.word)) {
        seen.add(rec.word);
        cleaned.push(rec);
      }
    }

    if (cleaned.length === 0) {
      const defaults = getDefaultStarterWords();
      saveWords(defaults);
      return defaults;
    }

    return cleaned;
  } catch {
    const defaults = getDefaultStarterWords();
    return defaults;
  }
}

/**
 * Saves the complete word array to localStorage.
 */
export function saveWords(words) {
  try {
    localStorage.setItem(WORDS_STORAGE_KEY, JSON.stringify(words));
  } catch (err) {
    console.warn('Failed to save words to localStorage:', err);
  }
}

/**
 * Determines the current active week label (most recently added week).
 */
export function getCurrentWeekLabel(words = loadWords()) {
  const stored = localStorage.getItem(CURRENT_WEEK_KEY);
  const activeWords = words.filter((w) => w.active !== false);
  if (stored && activeWords.some((w) => w.week_label === stored)) {
    return stored;
  }
  if (activeWords.length > 0) {
    return activeWords[activeWords.length - 1].week_label;
  }
  return 'Week 1';
}

export function setCurrentWeekLabel(weekLabel) {
  if (weekLabel && String(weekLabel).trim()) {
    localStorage.setItem(CURRENT_WEEK_KEY, String(weekLabel).trim());
  }
}

/**
 * Merges remote Google Sheets rows with local storage without losing historical words
 * or overwriting un-synced offline local updates.
 * @param {Array} remoteRows
 * @param {Set<string>} dirtyWordsSet - Words with pending offline SRS updates
 */
export function mergeWordsFromCloud(remoteRows, dirtyWordsSet = new Set()) {
  if (!Array.isArray(remoteRows) || remoteRows.length === 0) {
    return loadWords();
  }

  const localWords = loadWords();
  const localByWord = new Map(localWords.map((w) => [w.word, w]));
  const mergedMap = new Map();

  // Keep local words if they are only starter words? Wait: if remote sheet has real words,
  // merge remote rows while preserving any local dirty words or locally added words!
  const localIsUntouchedStarter =
    localWords.length === 8 &&
    localWords.every((w) => w.total_attempts === 0 && w.week_label === 'Week 1') &&
    dirtyWordsSet.size === 0;

  if (!localIsUntouchedStarter) {
    for (const loc of localWords) {
      mergedMap.set(loc.word, loc);
    }
  }

  let latestRemoteWeek = '';
  for (const row of remoteRows) {
    const remoteRec = normalizeWordRecord(row);
    if (!remoteRec.word) continue;
    latestRemoteWeek = remoteRec.week_label || latestRemoteWeek;

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
      // Reconcile local correct_attempts accuracy counter when total_attempts matches
      let correctAttempts = remoteRec.correct_attempts;
      if (existingLocal && existingLocal.total_attempts === remoteRec.total_attempts) {
        correctAttempts = existingLocal.correct_attempts;
      }
      mergedMap.set(remoteRec.word, {
        ...remoteRec,
        correct_attempts: correctAttempts
      });
    }
  }

  const mergedList = Array.from(mergedMap.values());
  saveWords(mergedList);
  if (latestRemoteWeek) {
    setCurrentWeekLabel(latestRemoteWeek);
  }
  return mergedList;
}

/**
 * Builds an 8 to 10 word session queue:
 * - Prioritizes all active words from the current week due for practice,
 *   mixed with past weeks' words due for review based on next_review <= today.
 * - If fewer than 8 words are currently due (e.g., playing an extra practice round),
 *   tops up cleanly from current week first, then past weeks, up to 8-10 words.
 */
export function buildSessionWords(allWords = loadWords(), minWords = 8, maxWords = 10) {
  const today = getLocalISODate();
  const active = allWords.filter((w) => w.active !== false && w.word && w.word.length > 0);
  if (active.length === 0) {
    return getDefaultStarterWords();
  }

  const currentWeek = getCurrentWeekLabel(active);
  const isDue = (w) => !w.next_review || w.next_review <= today;

  const sortByUrgency = (a, b) => {
    if (a.box !== b.box) return a.box - b.box;
    if (a.next_review !== b.next_review) return a.next_review.localeCompare(b.next_review);
    return a.total_attempts - b.total_attempts;
  };

  const currentWeekWords = active.filter((w) => w.week_label === currentWeek);
  const pastWeekWords = active.filter((w) => w.week_label !== currentWeek);

  const dueCurrent = currentWeekWords.filter(isDue).sort(sortByUrgency);
  const duePast = pastWeekWords.filter(isDue).sort(sortByUrgency);

  const selected = [];
  const pickedSet = new Set();

  const addCandidate = (w) => {
    if (!pickedSet.has(w.word) && selected.length < maxWords) {
      pickedSet.add(w.word);
      selected.push({ ...w });
    }
  };

  // Reserve up to 2 slots for overdue past-week words when current week alone fills >= 9 slots,
  // ensuring past weeks' due reviews always mix into the 8-10 word session.
  const reservedPastSlots = duePast.length > 0 && dueCurrent.length >= maxWords - 1
    ? Math.min(2, duePast.length)
    : 0;
  const maxCurrentDueSlots = maxWords - reservedPastSlots;

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

  return shuffleGently(selected);
}

/**
 * Updates long-term Leitner Box stats based ONLY on the FIRST attempt of the word in a session.
 * @param {string} targetWord
 * @param {number} firstAttemptErrors
 * @returns {object | null} The updated word record
 */
export function recordFirstAttemptSRS(targetWord, firstAttemptErrors) {
  const clean = normalizeWord(targetWord);
  if (!clean) return null;

  const words = loadWords();
  const idx = words.findIndex((w) => w.word === clean);
  if (idx === -1) return null;

  const today = getLocalISODate();
  const current = words[idx];
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

  const updated = {
    ...current,
    box: nextBox,
    next_review: nextReview,
    streak,
    total_attempts: totalAttempts,
    correct_attempts: correctAttempts
  };

  words[idx] = updated;
  saveWords(words);
  return updated;
}

/**
 * Adds or updates a weekly list of words from Parent Mode while keeping all historical words.
 * @param {Array<string | {word: string, custom_audio_url?: string}>} rawEntries
 * @param {string} weekLabel
 */
export function addWeeklyWordList(rawEntries, weekLabel) {
  const cleanWeek = String(weekLabel || '').trim() || suggestNextWeekLabel();
  const today = getLocalISODate();
  const words = loadWords();
  const byWord = new Map(words.map((w, i) => [w.word, i]));
  const addedOrUpdated = [];

  for (const entry of rawEntries) {
    const rawText = typeof entry === 'string' ? entry : (entry && entry.word ? entry.word : '');
    const customAudio = typeof entry === 'object' && entry && entry.custom_audio_url
      ? String(entry.custom_audio_url).trim()
      : '';
    const clean = normalizeWord(rawText);
    if (!clean) continue;

    if (byWord.has(clean)) {
      const existingIdx = byWord.get(clean);
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
    saveWords(words);
    setCurrentWeekLabel(cleanWeek);
  }

  return {
    weekLabel: cleanWeek,
    addedRecords: addedOrUpdated,
    allWords: words
  };
}

/**
 * Deletes a word from local storage (used if a parent removes an accidental typo).
 */
export function removeWordFromStore(wordToRemove) {
  const clean = normalizeWord(wordToRemove);
  const words = loadWords().filter((w) => w.word !== clean);
  const finalWords = words.length > 0 ? words : getDefaultStarterWords();
  saveWords(finalWords);
  return finalWords;
}

/**
 * Suggests a friendly next week label for the Parent Mode editor.
 */
export function suggestNextWeekLabel(words = loadWords()) {
  const labels = new Set(words.map((w) => w.week_label));
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
 */
export function getPlausibleDistractors(requiredChar, currentWord, allWords = []) {
  const req = String(requiredChar || '').toLowerCase();
  const vocabChars = new Set();
  let vocabHasAccents = false;

  for (const item of allWords) {
    const w = typeof item === 'string' ? item : (item && item.word ? item.word : '');
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

function shuffleGently(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
