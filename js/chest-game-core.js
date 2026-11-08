/**
 * Treasure Chest & Plushie Shelf Level — Pure, Deterministic Headless Core (`js/chest-game-core.js`)
 *
 * Zero DOM/Canvas/Audio/Timer coupling. Runs identically in Node.js (Vitest)
 * and the browser (`js/chest-game.js`).
 *
 * Integrates directly with existing modules:
 * - `getPlausibleDistractors`, `classifyTrapError`, `isMotorSlip`, `shuffleGently` from `./srs.js`
 * - `ensureSeededPRNG`, `clampDeltaTime` from `./game-core.js`
 * - `PLUSHIE_CATALOG`, `selectPlushieForReward`, `upsertPlushieOnShelf` from `./plushies.js`
 */

import {
  getPlausibleDistractors,
  classifyTrapError,
  isMotorSlip,
  shuffleGently
} from './srs.js';
import { ensureSeededPRNG } from './game-core.js';
import {
  selectPlushieForReward,
  upsertPlushieOnShelf
} from './plushies.js';

export const DIAL_OPTION_COUNT = 6;
export const GRAVITY_PX_S2 = 680;
export const PLUSHIE_BOX_SIZE = 54;

/**
 * Multi-tier wooden wall shelf surfaces (normalized to a 360x420 reference stage,
 * scaled proportionally when stage dimensions change).
 */
export const DEFAULT_SHELF_TIERS = [
  { tierIndex: 0, yRatio: 0.22, minXRatio: 0.14, maxXRatio: 0.86 },
  { tierIndex: 1, yRatio: 0.38, minXRatio: 0.14, maxXRatio: 0.86 },
  { tierIndex: 2, yRatio: 0.54, minXRatio: 0.14, maxXRatio: 0.78 }
];

/**
 * @typedef {object} ChestDialState
 * @property {number} index
 * @property {string} targetChar
 * @property {string[]} options
 * @property {number} selectedIndex
 * @property {string} currentChar
 * @property {boolean} isLocked
 * @property {number} rattleCount
 */

/**
 * @typedef {object} ChestSessionWordItem
 * @property {string} word
 * @property {string} [week_label]
 * @property {boolean} [active]
 * @property {number} [box]
 * @property {string} [next_review]
 * @property {number} [streak]
 * @property {number} [total_attempts]
 * @property {number} [correct_attempts]
 * @property {string} [custom_audio_url]
 * @property {boolean} isRetry
 * @property {number} [retryCount]
 * @property {boolean} [needsGoldenUpgrade]
 * @property {string | null} [targetPlushieId]
 */

/**
 * @typedef {object} ActivePlushieBody
 * @property {string} plushieId
 * @property {'standard' | 'golden'} variant
 * @property {string} word
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} width
 * @property {number} height
 * @property {boolean} isDragging
 * @property {boolean} placedOnShelf
 * @property {number} shelfTier
 */

/**
 * @typedef {object} ChestValidationResult
 * @property {boolean} handled
 * @property {boolean} unlocked
 * @property {number} attempt
 * @property {number[]} newlyLockedIndices
 * @property {number[]} lockedIndices
 * @property {number[]} incorrectIndices
 * @property {string[]} trapCategories
 * @property {{ plushieId: string, variant: 'standard' | 'golden' } | null} reward
 * @property {'golden-burst' | 'standard' | 'partial'} effect
 * @property {boolean} requeuedForGolden
 * @property {boolean} upgradedOnShelf
 */

/**
 * @typedef {object} ChestGameState
 * @property {Array<any>} allVocabWords
 * @property {ChestSessionWordItem[]} queue
 * @property {number} totalUniqueWords
 * @property {number} masteredCount
 * @property {Set<string>} firstAttemptRecorded
 * @property {Array<{ word: string, firstAttemptErrors: number, masteredFirstTry: boolean }>} sessionResults
 * @property {ChestSessionWordItem | null} currentWordObj
 * @property {string[]} targetChars
 * @property {ChestDialState[]} dials
 * @property {number} attempts
 * @property {number} wordErrorCount
 * @property {Record<string, number> | null} trapHistory
 * @property {boolean} chestOpen
 * @property {boolean} wordTransitioning
 * @property {boolean} running
 * @property {boolean} paused
 * @property {import('./plushies.js').PlushieShelfEntry[]} shelf
 * @property {ActivePlushieBody | null} activePlushie
 * @property {{ plushieId: string, variant: 'standard' | 'golden' } | null} lastAwardedReward
 * @property {number} stageWidth
 * @property {number} stageHeight
 * @property {{ totalWords: number, firstTryPerfect: number, results: Array<any> } | null} sessionSummary
 * @property {import('./prng.js').SeededPRNG} prng
 */

/**
 * Builds a single-character vertical scrolling dial for a specific character position in `word`.
 * Uses `getPlausibleDistractors` from `./srs.js` to populate realistic Canadian French distractors.
 *
 * @param {string} targetChar
 * @param {number} index
 * @param {string} word
 * @param {Array<any>} allVocabWords
 * @param {Record<string, number> | null} trapHistory
 * @param {import('./prng.js').SeededPRNG} prng
 * @param {number} [optionCount=DIAL_OPTION_COUNT]
 * @returns {ChestDialState}
 */
export function createDialForChar(
  targetChar,
  index,
  word,
  allVocabWords = [],
  trapHistory = null,
  prng = ensureSeededPRNG(undefined, 1),
  optionCount = DIAL_OPTION_COUNT
) {
  const cleanTarget = String(targetChar || 'a').trim().toLowerCase();
  const distractorPool = getPlausibleDistractors(
    cleanTarget,
    word,
    allVocabWords,
    index,
    trapHistory
  );

  /** @type {string[]} */
  const uniqueDistractors = [];
  /** @type {Set<string>} */
  const seen = new Set([cleanTarget]);

  // Draw weighted distractors from the pool using PRNG first so high-weight traps appear often
  const maxAttempts = distractorPool.length * 2 + 12;
  for (let attempt = 0; attempt < maxAttempts && uniqueDistractors.length < optionCount - 1; attempt++) {
    if (distractorPool.length === 0) break;
    const candidate = distractorPool[Math.floor(prng() * distractorPool.length)];
    if (candidate && Array.from(candidate).length === 1 && !seen.has(candidate)) {
      seen.add(candidate);
      uniqueDistractors.push(candidate);
    }
  }

  // Top up deterministically from distractorPool if random sampling hit duplicates
  for (const ch of distractorPool) {
    if (uniqueDistractors.length >= optionCount - 1) break;
    if (ch && Array.from(ch).length === 1 && !seen.has(ch)) {
      seen.add(ch);
      uniqueDistractors.push(ch);
    }
  }

  const rawOptions = [cleanTarget, ...uniqueDistractors];
  const options = shuffleGently(rawOptions, prng);

  // Start the dial on a non-matching distractor option so dials never spawn pre-solved
  let selectedIndex = options.findIndex((ch) => ch !== cleanTarget);
  if (selectedIndex < 0) selectedIndex = 0;
  // Offset across non-target options using PRNG
  const nonTargetIndices = options
    .map((ch, idx) => (ch !== cleanTarget ? idx : -1))
    .filter((idx) => idx >= 0);
  if (nonTargetIndices.length > 0) {
    selectedIndex = nonTargetIndices[Math.floor(prng() * nonTargetIndices.length)];
  }

  return {
    index,
    targetChar: cleanTarget,
    options,
    selectedIndex,
    currentChar: options[selectedIndex],
    isLocked: false,
    rattleCount: 0
  };
}

/**
 * Initializes the horizontal row of vertical scrolling dials for a word—strictly 1 single character per dial.
 * @param {string} word
 * @param {Array<any>} allVocabWords
 * @param {Record<string, number> | null} trapHistory
 * @param {import('./prng.js').SeededPRNG} prng
 * @returns {ChestDialState[]}
 */
export function initializeDialsForWord(word, allVocabWords = [], trapHistory = null, prng = ensureSeededPRNG(undefined, 1)) {
  const chars = Array.from(String(word || '').trim().toLowerCase());
  return chars.map((ch, idx) =>
    createDialForChar(ch, idx, word, allVocabWords, trapHistory, prng)
  );
}

/**
 * Creates a pure, deterministic headless `ChestGameState`.
 * @param {{
 *   sessionWords?: Array<any>,
 *   allVocabWords?: Array<any>,
 *   shelf?: import('./plushies.js').PlushieShelfEntry[],
 *   stageWidth?: number,
 *   stageHeight?: number,
 *   seed?: number,
 *   prng?: import('./prng.js').SeededPRNG | (() => number),
 *   trapHistory?: Record<string, number>,
 *   autoStart?: boolean
 * }} [config={}]
 * @returns {ChestGameState}
 */
export function createChestGameState(config = {}) {
  const stageWidth =
    typeof config.stageWidth === 'number' && Number.isFinite(config.stageWidth) && config.stageWidth > 0
      ? config.stageWidth
      : 360;
  const stageHeight =
    typeof config.stageHeight === 'number' && Number.isFinite(config.stageHeight) && config.stageHeight > 0
      ? config.stageHeight
      : 420;
  const prng = ensureSeededPRNG(config.prng, config.seed !== undefined ? config.seed : 1);

  /** @type {ChestGameState} */
  const state = {
    allVocabWords: Array.isArray(config.allVocabWords)
      ? config.allVocabWords.map((w) => (w && typeof w === 'object' ? { ...w } : w))
      : [],
    queue: [],
    totalUniqueWords: 0,
    masteredCount: 0,
    firstAttemptRecorded: new Set(),
    sessionResults: [],
    currentWordObj: null,
    targetChars: [],
    dials: [],
    attempts: 0,
    wordErrorCount: 0,
    trapHistory:
      config.trapHistory && typeof config.trapHistory === 'object'
        ? { ...config.trapHistory }
        : null,
    chestOpen: false,
    wordTransitioning: false,
    running: false,
    paused: false,
    shelf: Array.isArray(config.shelf) ? config.shelf.map((p) => ({ ...p })) : [],
    activePlushie: null,
    lastAwardedReward: null,
    stageWidth,
    stageHeight,
    sessionSummary: null,
    prng
  };

  if (
    Array.isArray(config.sessionWords) &&
    (config.autoStart === true || (config.sessionWords.length > 0 && config.autoStart !== false))
  ) {
    startChestSessionOnState(
      state,
      config.sessionWords,
      Array.isArray(config.allVocabWords) ? config.allVocabWords : config.sessionWords
    );
  }

  return state;
}

/**
 * Starts a new chest-unlocking session on `state`.
 * @param {ChestGameState} state
 * @param {Array<any>} sessionWords
 * @param {Array<any>} [allVocabularyWords]
 */
export function startChestSessionOnState(state, sessionWords, allVocabularyWords = sessionWords) {
  const safeSession = Array.isArray(sessionWords) ? sessionWords : [];
  state.allVocabWords = Array.isArray(allVocabularyWords)
    ? allVocabularyWords.map((w) => (w && typeof w === 'object' ? { ...w } : w))
    : safeSession.map((w) => (w && typeof w === 'object' ? { ...w } : w));
  state.queue = safeSession.map((w) => ({
    ...(typeof w === 'string' ? { word: w } : w),
    isRetry: false,
    retryCount: 0,
    needsGoldenUpgrade: false,
    targetPlushieId: null
  }));
  state.totalUniqueWords = state.queue.length;
  state.masteredCount = 0;
  state.firstAttemptRecorded.clear();
  state.sessionResults = [];
  state.sessionSummary = null;
  state.activePlushie = null;
  state.lastAwardedReward = null;
  state.running = true;
  state.paused = false;

  startNextChestWordOnState(state);
}

/**
 * Loads the next locked chest word from `state.queue`, or finishes the session if `state.queue` is empty.
 * @param {ChestGameState} state
 * @returns {{ finished: boolean, summary?: any, wordObj?: ChestSessionWordItem }}
 */
export function startNextChestWordOnState(state) {
  if (!state.running) return { finished: false };

  if (state.queue.length === 0) {
    state.running = false;
    state.dials = [];
    const firstTryPerfect = state.sessionResults.filter((r) => r.masteredFirstTry).length;
    const summary = {
      totalWords: state.totalUniqueWords,
      firstTryPerfect,
      results: state.sessionResults.map((r) => ({ ...r }))
    };
    state.sessionSummary = summary;
    return { finished: true, summary };
  }

  const nextWord = /** @type {ChestSessionWordItem} */ (state.queue.shift());
  state.currentWordObj = nextWord;
  state.targetChars = Array.from(String(nextWord.word || '').trim().toLowerCase());
  state.dials = initializeDialsForWord(
    nextWord.word,
    state.allVocabWords,
    state.trapHistory,
    state.prng
  );
  state.attempts = 0;
  state.wordErrorCount = 0;
  state.chestOpen = false;
  state.wordTransitioning = false;
  state.activePlushie = null;

  return { finished: false, wordObj: nextWord };
}

/**
 * Scrolls a single dial by `deltaSteps` (e.g. +1 or -1).
 * Strictly rejects the event if `dial.isLocked === true`.
 *
 * @param {ChestGameState} state
 * @param {number} dialIndex
 * @param {number} [deltaSteps=1]
 * @returns {{ changed: boolean, locked: boolean, currentChar?: string, selectedIndex?: number }}
 */
export function scrollDialOnState(state, dialIndex, deltaSteps = 1) {
  if (!state.running || state.paused || state.chestOpen) {
    return { changed: false, locked: false };
  }
  const dial = state.dials[dialIndex];
  if (!dial) {
    return { changed: false, locked: false };
  }
  if (dial.isLocked) {
    return { changed: false, locked: true, currentChar: dial.currentChar, selectedIndex: dial.selectedIndex };
  }

  const step = Math.trunc(Number(deltaSteps) || 0);
  if (step === 0 || dial.options.length === 0) {
    return { changed: false, locked: false, currentChar: dial.currentChar, selectedIndex: dial.selectedIndex };
  }

  const len = dial.options.length;
  const nextIdx = ((dial.selectedIndex + step) % len + len) % len;
  dial.selectedIndex = nextIdx;
  dial.currentChar = dial.options[nextIdx];

  return {
    changed: true,
    locked: false,
    currentChar: dial.currentChar,
    selectedIndex: dial.selectedIndex
  };
}

/**
 * Sets a dial directly to a specific character or option index (used by tests and wheel snap).
 * Strictly rejects the change if `dial.isLocked === true`.
 *
 * @param {ChestGameState} state
 * @param {number} dialIndex
 * @param {string | number} charOrOptionIndex
 * @returns {{ changed: boolean, locked: boolean, currentChar?: string, selectedIndex?: number }}
 */
export function setDialCharOnState(state, dialIndex, charOrOptionIndex) {
  if (!state.running || state.paused || state.chestOpen) {
    return { changed: false, locked: false };
  }
  const dial = state.dials[dialIndex];
  if (!dial) {
    return { changed: false, locked: false };
  }
  if (dial.isLocked) {
    return { changed: false, locked: true, currentChar: dial.currentChar, selectedIndex: dial.selectedIndex };
  }

  if (typeof charOrOptionIndex === 'number') {
    const len = dial.options.length;
    if (len === 0) return { changed: false, locked: false };
    const idx = ((Math.trunc(charOrOptionIndex) % len) + len) % len;
    dial.selectedIndex = idx;
    dial.currentChar = dial.options[idx];
    return { changed: true, locked: false, currentChar: dial.currentChar, selectedIndex: idx };
  }

  const targetStr = String(charOrOptionIndex || '').trim().toLowerCase();
  let idx = dial.options.findIndex((c) => c === targetStr);
  if (idx === -1) {
    // Ensure option is present if caller sets a valid character
    dial.options.push(targetStr);
    idx = dial.options.length - 1;
  }
  dial.selectedIndex = idx;
  dial.currentChar = dial.options[idx];
  return { changed: true, locked: false, currentChar: dial.currentChar, selectedIndex: idx };
}

/**
 * Validates the current dial alignment (Pin-Locking State Machine & Tiered Reward Logic):
 * - Increments `state.attempts += 1`.
 * - Locks dials where `currentChar === targetChar` (`isLocked = true`).
 * - Leaves non-matching dials unlocked (`isLocked = false`) and increments their `rattleCount`.
 * - When all dials are locked:
 *   - `attempt === 1` -> `{ plushieId, variant: 'golden' }`, celebratory golden burst, word NOT re-queued.
 *   - `attempt > 1` -> `{ plushieId, variant: 'standard' }`, standard effect, and returns the word to `state.queue`
 *     flagged with `needsGoldenUpgrade = true` so the player can earn the golden upgrade later.
 *
 * @param {ChestGameState} state
 * @returns {ChestValidationResult}
 */
export function validateChestLockOnState(state) {
  if (!state.running || state.paused || state.chestOpen || !state.currentWordObj || state.dials.length === 0) {
    return {
      handled: false,
      unlocked: false,
      attempt: state.attempts,
      newlyLockedIndices: [],
      lockedIndices: state.dials.filter((d) => d.isLocked).map((d) => d.index),
      incorrectIndices: [],
      trapCategories: [],
      reward: null,
      effect: 'partial',
      requeuedForGolden: false,
      upgradedOnShelf: false
    };
  }

  state.attempts += 1;
  const wordStr = state.currentWordObj.word;

  /** @type {number[]} */
  const newlyLockedIndices = [];
  /** @type {number[]} */
  const lockedIndices = [];
  /** @type {number[]} */
  const incorrectIndices = [];
  /** @type {string[]} */
  const trapCategories = [];

  for (let i = 0; i < state.dials.length; i++) {
    const dial = state.dials[i];
    if (dial.isLocked) {
      lockedIndices.push(i);
      continue;
    }

    if (dial.currentChar === dial.targetChar) {
      dial.isLocked = true;
      newlyLockedIndices.push(i);
      lockedIndices.push(i);
    } else {
      dial.isLocked = false;
      dial.rattleCount += 1;
      incorrectIndices.push(i);
      state.wordErrorCount += 1;
      const trapCat = classifyTrapError(dial.targetChar, dial.currentChar, wordStr, i);
      if (trapCat) {
        trapCategories.push(trapCat);
      }
    }
  }

  const allLocked = incorrectIndices.length === 0 && lockedIndices.length === state.dials.length;

  if (!allLocked) {
    return {
      handled: true,
      unlocked: false,
      attempt: state.attempts,
      newlyLockedIndices,
      lockedIndices,
      incorrectIndices,
      trapCategories,
      reward: null,
      effect: 'partial',
      requeuedForGolden: false,
      upgradedOnShelf: false
    };
  }

  // Full Unlock!
  state.chestOpen = true;
  state.wordTransitioning = true;

  const isFirstSessionAttempt = !state.firstAttemptRecorded.has(wordStr);
  if (isFirstSessionAttempt) {
    state.firstAttemptRecorded.add(wordStr);
    state.sessionResults.push({
      word: wordStr,
      firstAttemptErrors: state.attempts === 1 ? 0 : state.wordErrorCount,
      masteredFirstTry: state.attempts === 1
    });
  }

  const preferredPlushieId = state.currentWordObj.targetPlushieId || null;
  const reward = selectPlushieForReward(state.shelf, state.attempts, state.prng, preferredPlushieId);
  state.lastAwardedReward = reward;

  const shelfCoords = computeNextShelfCoordinates(state, reward.plushieId);
  const shelfUpsert = upsertPlushieOnShelf(state.shelf, reward, {
    word: wordStr,
    x: shelfCoords.x,
    y: shelfCoords.y,
    shelfTier: shelfCoords.shelfTier
  });
  state.shelf = shelfUpsert.shelf;

  // Pop the plushie out of the chest into the foreground play area for interactive 2D shelf physics
  state.activePlushie = {
    plushieId: reward.plushieId,
    variant: reward.variant,
    word: wordStr,
    x: state.stageWidth * 0.5,
    y: state.stageHeight * 0.62,
    vx: (state.prng() - 0.5) * 30,
    vy: -180,
    width: PLUSHIE_BOX_SIZE,
    height: PLUSHIE_BOX_SIZE,
    isDragging: false,
    placedOnShelf: false,
    shelfTier: shelfCoords.shelfTier
  };

  let requeuedForGolden = false;
  /** @type {'golden-burst' | 'standard'} */
  let effect = 'golden-burst';

  if (state.attempts === 1) {
    effect = 'golden-burst';
    requeuedForGolden = false;
    state.masteredCount = Math.min(state.totalUniqueWords, state.masteredCount + 1);
  } else {
    effect = 'standard';
    requeuedForGolden = true;
    const retryCount = (state.currentWordObj.retryCount || 0) + 1;
    // Flag the word to remain in rotation for a future golden upgrade (capped safely for infinite-loop prevention in random fuzzing if retryCount > 6)
    if (retryCount <= 6) {
      state.queue.push({
        ...state.currentWordObj,
        isRetry: true,
        retryCount,
        needsGoldenUpgrade: true,
        targetPlushieId: reward.plushieId
      });
    }
  }

  return {
    handled: true,
    unlocked: true,
    attempt: state.attempts,
    newlyLockedIndices,
    lockedIndices,
    incorrectIndices: [],
    trapCategories,
    reward,
    effect,
    requeuedForGolden,
    upgradedOnShelf: shelfUpsert.upgraded
  };
}

/**
 * Computes tidy target coordinates on the multi-tier wooden wall shelves for a plushie.
 * @param {ChestGameState} state
 * @param {string} plushieId
 * @returns {{ x: number, y: number, shelfTier: number }}
 */
export function computeNextShelfCoordinates(state, plushieId) {
  const existing = state.shelf.find((p) => p.plushieId === plushieId);
  if (
    existing &&
    typeof existing.x === 'number' &&
    Number.isFinite(existing.x) &&
    typeof existing.y === 'number' &&
    Number.isFinite(existing.y)
  ) {
    return {
      x: existing.x,
      y: existing.y,
      shelfTier: typeof existing.shelfTier === 'number' ? existing.shelfTier : 0
    };
  }

  const slotIdx = state.shelf.length;
  const tierDef = DEFAULT_SHELF_TIERS[slotIdx % DEFAULT_SHELF_TIERS.length];
  const indexOnTier = Math.floor(slotIdx / DEFAULT_SHELF_TIERS.length);
  const minX = state.stageWidth * tierDef.minXRatio;
  const maxX = state.stageWidth * tierDef.maxXRatio;
  const span = Math.max(40, maxX - minX);
  const stepX = PLUSHIE_BOX_SIZE * 0.82;
  const x = minX + ((indexOnTier * stepX) % span);
  const y = state.stageHeight * tierDef.yRatio;

  return {
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    shelfTier: tierDef.tierIndex
  };
}

/**
 * Begins or updates pointer dragging of the popped-out plushie.
 * @param {ChestGameState} state
 * @param {number} x
 * @param {number} y
 */
export function dragPlushieOnState(state, x, y) {
  if (!state.activePlushie) return;
  const safeX = Number.isFinite(x) ? Math.max(16, Math.min(state.stageWidth - 16, x)) : state.activePlushie.x;
  const safeY = Number.isFinite(y) ? Math.max(16, Math.min(state.stageHeight - 16, y)) : state.activePlushie.y;
  state.activePlushie.isDragging = true;
  state.activePlushie.placedOnShelf = false;
  state.activePlushie.x = safeX;
  state.activePlushie.y = safeY;
  state.activePlushie.vx = 0;
  state.activePlushie.vy = 0;
}

/**
 * Releases the dragged plushie with an optional flick velocity `(vx, vy)`.
 * @param {ChestGameState} state
 * @param {number} [vx=0]
 * @param {number} [vy=0]
 */
export function releasePlushieOnState(state, vx = 0, vy = 0) {
  if (!state.activePlushie) return;
  state.activePlushie.isDragging = false;
  state.activePlushie.vx = Number.isFinite(vx) ? Math.max(-600, Math.min(600, vx)) : 0;
  state.activePlushie.vy = Number.isFinite(vy) ? Math.max(-600, Math.min(600, vy)) : 0;
}

/**
 * Steps lightweight 2D shelf physics (gravity, horizontal shelf bounds, shelf surface collision, and bounding-box stacking).
 * @param {ChestGameState} state
 * @param {number} [dt=0.016]
 */
export function stepShelfPhysicsOnState(state, dt = 0.016) {
  const body = state.activePlushie;
  if (!body || body.isDragging || body.placedOnShelf) return;

  const safeDt = Number.isFinite(dt) ? Math.max(0.001, Math.min(0.05, dt)) : 0.016;
  const prevY = body.y;

  body.vy += GRAVITY_PX_S2 * safeDt;
  body.x += body.vx * safeDt;
  body.y += body.vy * safeDt;

  // Horizontal wall bounce
  const minStageX = body.width * 0.5;
  const maxStageX = Math.max(minStageX + 10, state.stageWidth - body.width * 0.5);
  if (body.x < minStageX) {
    body.x = minStageX;
    body.vx = Math.abs(body.vx) * 0.45;
  } else if (body.x > maxStageX) {
    body.x = maxStageX;
    body.vx = -Math.abs(body.vx) * 0.45;
  }

  // Check collision against wooden wall shelf tiers when moving downward
  if (body.vy >= 0) {
    for (const tier of DEFAULT_SHELF_TIERS) {
      const shelfY = state.stageHeight * tier.yRatio;
      const minX = state.stageWidth * tier.minXRatio;
      const maxX = state.stageWidth * tier.maxXRatio;

      if (body.x >= minX && body.x <= maxX && prevY <= shelfY + 12 && body.y >= shelfY) {
        body.y = shelfY;
        body.vx = 0;
        body.vy = 0;
        body.placedOnShelf = true;
        body.shelfTier = tier.tierIndex;

        // Simple bounding-box horizontal nudging if overlapping another plushie on the same shelf tier
        for (const other of state.shelf) {
          if (other.plushieId === body.plushieId) continue;
          if (
            other.shelfTier === tier.tierIndex &&
            typeof other.x === 'number' &&
            Math.abs(other.x - body.x) < body.width * 0.65
          ) {
            body.x = Math.min(maxX, Math.max(minX, other.x + body.width * 0.7));
          }
        }

        // Persist updated coordinates onto the shelf entry
        const entry = state.shelf.find((p) => p.plushieId === body.plushieId);
        if (entry) {
          entry.x = Math.round(body.x * 10) / 10;
          entry.y = Math.round(body.y * 10) / 10;
          entry.shelfTier = body.shelfTier;
        }
        return;
      }
    }
  }

  // If the plushie falls below the lowest shelf toward the floor, gently snap/hop it onto the nearest shelf
  const floorLimit = state.stageHeight * 0.72;
  if (body.y >= floorLimit) {
    autoHopPlushieToShelfOnState(state);
  }
}

/**
 * Automatically hops/settles the active popped-out plushie onto its wooden shelf spot.
 * @param {ChestGameState} state
 */
export function autoHopPlushieToShelfOnState(state) {
  if (!state.activePlushie) return;
  const coords = computeNextShelfCoordinates(state, state.activePlushie.plushieId);
  state.activePlushie.x = coords.x;
  state.activePlushie.y = coords.y;
  state.activePlushie.vx = 0;
  state.activePlushie.vy = 0;
  state.activePlushie.isDragging = false;
  state.activePlushie.placedOnShelf = true;
  state.activePlushie.shelfTier = coords.shelfTier;

  const entry = state.shelf.find((p) => p.plushieId === state.activePlushie?.plushieId);
  if (entry) {
    entry.x = coords.x;
    entry.y = coords.y;
    entry.shelfTier = coords.shelfTier;
  }
}

/**
 * Advances to the next chest in the session, automatically hopping any unplaced plushie onto the shelf first.
 * @param {ChestGameState} state
 * @returns {{ finished: boolean, summary?: any, wordObj?: ChestSessionWordItem }}
 */
export function advanceToNextChestOnState(state) {
  if (state.activePlushie && !state.activePlushie.placedOnShelf) {
    autoHopPlushieToShelfOnState(state);
  }
  return startNextChestWordOnState(state);
}

export { isMotorSlip };
