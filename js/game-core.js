/**
 * Cozy Tub Spelling — Pure, Deterministic Headless Game Core (`js/game-core.js`)
 *
 * Zero DOM/Canvas/Audio/Timer coupling. Runs identically in Node.js (Vitest)
 * and the browser (`js/game.js`).
 */

import { createPRNG } from './prng.js';
import { getPlausibleDistractors } from './srs.js';

export const MIN_BUBBLES = 5;
export const MAX_BUBBLES = 7;
export const SPAWN_INTERVAL_SEC = 0.78;
export const FAST_SPAWN_INTERVAL_SEC = 0.32;
export const MAX_DT_SEC = 0.05;

export const CHEER_MESSAGES_PERFECT = [
  'Splash-tastic!',
  'Pure magic!',
  'So cozy & clever!',
  'Wonderful spelling!',
  'Bubble master!',
  'Spotless!'
];

export const CHEER_MESSAGES_PRACTICE = [
  'Nice job! We’ll splash it once more soon!',
  'You built it! Let’s try again later!',
  'Great effort! Saved for one more round!'
];

/**
 * @typedef {object} SessionWordItem
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
 */

/**
 * @typedef {object} SessionResult
 * @property {string} word
 * @property {number} firstAttemptErrors
 * @property {boolean} masteredFirstTry
 */

/**
 * @typedef {object} SessionSummary
 * @property {number} totalWords
 * @property {number} firstTryPerfect
 * @property {SessionResult[]} results
 */

/**
 * @typedef {object} BubbleEntity
 * @property {number} id
 * @property {string} char
 * @property {number} baseX
 * @property {number} x
 * @property {number} y
 * @property {number} diameter
 * @property {number} radius
 * @property {number} speedY
 * @property {number} wobbleAmp
 * @property {number} wobbleFreq
 * @property {number} phase
 * @property {number} age
 * @property {'floating' | 'popping' | 'fizzling'} state
 * @property {any} [el]
 */

/**
 * @typedef {object} GameState
 * @property {Array<any>} allVocabWords
 * @property {SessionWordItem[]} queue
 * @property {number} totalUniqueWords
 * @property {number} masteredCount
 * @property {Set<string>} firstAttemptRecorded
 * @property {SessionResult[]} sessionResults
 * @property {SessionWordItem | null} currentWordObj
 * @property {string[]} targetChars
 * @property {number} currentIndex
 * @property {number} wordErrorCount
 * @property {number} letterErrorCount
 * @property {boolean} watermarkActive
 * @property {boolean} wordTransitioning
 * @property {boolean} running
 * @property {boolean} paused
 * @property {BubbleEntity[]} bubbles
 * @property {number} nextBubbleId
 * @property {number} spawnCounter
 * @property {number} spawnTimer
 * @property {number} stageWidth
 * @property {number} stageHeight
 * @property {string | null} lastCheerMessage
 * @property {SessionSummary | null} sessionSummary
 * @property {import('./prng.js').SeededPRNG} prng
 */

/**
 * @typedef {object} GameConfig
 * @property {Array<any>} [sessionWords]
 * @property {Array<any>} [allVocabWords]
 * @property {number} [stageWidth=360]
 * @property {number} [stageHeight=420]
 * @property {number} [seed=1]
 * @property {import('./prng.js').SeededPRNG | (() => number)} [prng]
 * @property {boolean} [autoStart=false]
 */

/**
 * @typedef {
 *   | { type: 'TICK', dt?: number }
 *   | { type: 'START_SESSION', sessionWords: Array<any>, allVocabWords?: Array<any> }
 *   | { type: 'TAP_BUBBLE', bubbleId: number }
 *   | { type: 'USE_HINT' }
 *   | { type: 'COMPLETE_WORD' }
 *   | { type: 'REMOVE_BUBBLE', bubbleId: number }
 *   | { type: 'PAUSE' }
 *   | { type: 'RESUME' }
 *   | { type: 'STOP' }
 *   | { type: 'RESIZE', width: number, height: number }
 * } GameAction
 */

/**
 * Wraps an arbitrary `() => number` function or `SeededPRNG` so `.clone()`, `.getState()`, `.setState()` are always safe.
 * @param {import('./prng.js').SeededPRNG | (() => number) | undefined} prngOrUndefined
 * @param {number} [seed=1]
 * @returns {import('./prng.js').SeededPRNG}
 */
export function ensureSeededPRNG(prngOrUndefined, seed = 1) {
  if (typeof prngOrUndefined === 'function') {
    if ('clone' in prngOrUndefined && typeof prngOrUndefined.clone === 'function') {
      return prngOrUndefined.clone();
    }
    const fn = prngOrUndefined;
    const wrapped = /** @type {import('./prng.js').SeededPRNG} */ (function () {
      return fn();
    });
    wrapped.getState = () => 0;
    wrapped.setState = () => {};
    wrapped.clone = () => ensureSeededPRNG(fn, seed);
    return wrapped;
  }
  return createPRNG(seed);
}

/**
 * Deep-clones a `GameState` (including `firstAttemptRecorded` Set, `bubbles` array, and `prng` internal state).
 * @param {GameState} state
 * @returns {GameState}
 */
export function cloneGameState(state) {
  return {
    allVocabWords: state.allVocabWords.map((w) => (w && typeof w === 'object' ? { ...w } : w)),
    queue: state.queue.map((w) => ({ ...w })),
    totalUniqueWords: state.totalUniqueWords,
    masteredCount: state.masteredCount,
    firstAttemptRecorded: new Set(state.firstAttemptRecorded),
    sessionResults: state.sessionResults.map((r) => ({ ...r })),
    currentWordObj: state.currentWordObj ? { ...state.currentWordObj } : null,
    targetChars: [...state.targetChars],
    currentIndex: state.currentIndex,
    wordErrorCount: state.wordErrorCount,
    letterErrorCount: state.letterErrorCount,
    watermarkActive: state.watermarkActive,
    wordTransitioning: state.wordTransitioning,
    running: state.running,
    paused: state.paused,
    bubbles: state.bubbles.map((b) => ({
      id: b.id,
      char: b.char,
      baseX: b.baseX,
      x: b.x,
      y: b.y,
      diameter: b.diameter,
      radius: b.radius,
      speedY: b.speedY,
      wobbleAmp: b.wobbleAmp,
      wobbleFreq: b.wobbleFreq,
      phase: b.phase,
      age: b.age,
      state: b.state
    })),
    nextBubbleId: state.nextBubbleId,
    spawnCounter: state.spawnCounter,
    spawnTimer: state.spawnTimer,
    stageWidth: state.stageWidth,
    stageHeight: state.stageHeight,
    lastCheerMessage: state.lastCheerMessage,
    sessionSummary: state.sessionSummary
      ? {
          totalWords: state.sessionSummary.totalWords,
          firstTryPerfect: state.sessionSummary.firstTryPerfect,
          results: state.sessionSummary.results.map((r) => ({ ...r }))
        }
      : null,
    prng: state.prng.clone()
  };
}

/**
 * Pure factory that creates an initial headless `GameState`.
 * If `config.sessionWords` is provided and `config.autoStart !== false` (or when `sessionWords` is non-empty and `autoStart` is true),
 * starts the session immediately.
 *
 * @param {GameConfig} [config={}]
 * @returns {GameState}
 */
export function createGameState(config = {}) {
  const stageWidth =
    typeof config.stageWidth === 'number' && !Number.isNaN(config.stageWidth) ? config.stageWidth : 360;
  const stageHeight =
    typeof config.stageHeight === 'number' && !Number.isNaN(config.stageHeight) ? config.stageHeight : 420;
  const prng = ensureSeededPRNG(config.prng, config.seed !== undefined ? config.seed : 1);

  /** @type {GameState} */
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
    currentIndex: 0,
    wordErrorCount: 0,
    letterErrorCount: 0,
    watermarkActive: false,
    wordTransitioning: false,
    running: false,
    paused: false,
    bubbles: [],
    nextBubbleId: 1,
    spawnCounter: 0,
    spawnTimer: 0,
    stageWidth,
    stageHeight,
    lastCheerMessage: null,
    sessionSummary: null,
    prng
  };

  if (Array.isArray(config.sessionWords) && (config.autoStart === true || config.sessionWords.length > 0 && config.autoStart !== false)) {
    startSessionOnState(
      state,
      config.sessionWords,
      Array.isArray(config.allVocabWords) ? config.allVocabWords : config.sessionWords
    );
  }

  return state;
}

/**
 * Computes bubble diameter in pixels from stage dimensions:
 * `Math.round(Math.min(98, Math.max(66, Math.min(width, height) * 0.165)))`
 * @param {{ width: number, height: number }} stageRect
 * @returns {number}
 */
export function computeBubbleDiameter(stageRect) {
  const shortest = Math.min(stageRect.width, stageRect.height);
  return Math.round(Math.min(98, Math.max(66, shortest * 0.165)));
}

/**
 * Smart Spawning Algorithm:
 * - Increments `state.spawnCounter += 1`.
 * - Every 3rd bubble (`spawnCounter % 3 === 0`) MUST be `targetChars[currentIndex]`.
 * - 30% of remaining bubbles are future letters from `targetChars.slice(currentIndex + 1)`.
 * - 70% of remaining bubbles are plausible distractor letters.
 *
 * @param {GameState} state
 * @returns {string}
 */
export function chooseNextBubbleCharOnState(state) {
  state.spawnCounter += 1;
  const requiredChar = state.targetChars[state.currentIndex];
  if (!requiredChar) return 'a';

  // Rule 1: Every 3rd bubble MUST be the exact next required letter
  if (state.spawnCounter % 3 === 0) {
    return requiredChar;
  }

  // Rule 2: 30% of remaining bubbles are future letters from the current word
  const futureChars = state.targetChars.slice(state.currentIndex + 1);
  // CHARACTERIZATION NOTE: If futureChars.length > 0, prng() is consumed for the < 0.30 check even when it fails.
  // If futureChars is empty (last letter of word), prng() is NOT consumed for the 0.30 check.
  if (futureChars.length > 0 && state.prng() < 0.30) {
    return futureChars[Math.floor(state.prng() * futureChars.length)];
  }

  // Rule 3: 70% of remaining bubbles are plausible distractor letters
  const distractors = getPlausibleDistractors(
    requiredChar,
    state.currentWordObj ? state.currentWordObj.word : '',
    state.allVocabWords,
    state.currentIndex
  );
  if (distractors.length > 0) {
    return distractors[Math.floor(state.prng() * distractors.length)];
  }

  return requiredChar === 'e' ? 'a' : 'e';
}

/**
 * Picks a horizontal spawn coordinate `baseX` in `[minX, maxX]` that maximizes distance
 * to nearby floating bubbles within `|b.y - spawnY| < diameter * 1.65`.
 *
 * @param {GameState} state
 * @param {number} minX
 * @param {number} maxX
 * @param {number} spawnY
 * @param {number} diameter
 * @returns {number}
 */
export function pickNonOverlappingXOnState(state, minX, maxX, spawnY, diameter) {
  const candidates = 7;
  // CHARACTERIZATION NOTE: Initial bestX consumes 1 PRNG roll before the 7 stratified candidate rolls,
  // even though candidate i=0 (nearest >= 0 > -1) always replaces bestX on the first loop iteration.
  let bestX = minX + state.prng() * (maxX - minX);
  let bestMinDist = -1;

  for (let i = 0; i < candidates; i++) {
    const candidateX = minX + ((i + state.prng() * 0.85) / candidates) * (maxX - minX);
    let nearest = Infinity;
    for (const b of state.bubbles) {
      if (b.state !== 'floating') continue;
      const dy = Math.abs(b.y - spawnY);
      if (dy < diameter * 1.65) {
        const dist = Math.hypot(b.baseX - candidateX, b.y - spawnY);
        if (dist < nearest) nearest = dist;
      }
    }
    if (nearest > bestMinDist) {
      bestMinDist = nearest;
      bestX = candidateX;
    }
  }

  return Math.min(maxX, Math.max(minX, bestX));
}

/**
 * Spawns a single bubble on `state` (mutating `state.bubbles`, `state.nextBubbleId`, `state.spawnCounter`, and `state.prng`).
 * Returns the newly created `BubbleEntity` or `null` if spawning is guarded off.
 *
 * @param {GameState} state
 * @param {number | null} [overrideY=null]
 * @returns {BubbleEntity | null}
 */
export function spawnBubbleOnState(state, overrideY = null) {
  if (state.wordTransitioning || state.currentIndex >= state.targetChars.length) {
    return null;
  }

  const width = state.stageWidth;
  const height = state.stageHeight;
  if (width < 40 || height < 40) return null;

  const diameter = computeBubbleDiameter({ width, height });
  const radius = diameter / 2;
  const wobbleAmp = Math.min(22, Math.max(10, width * 0.028));
  const safeMinX = radius + wobbleAmp + 10;
  const safeMaxX = Math.max(safeMinX + 10, width - radius - wobbleAmp - 10);

  const startY = overrideY !== null ? overrideY : height + radius * 0.55;
  const baseX = pickNonOverlappingXOnState(state, safeMinX, safeMaxX, startY, diameter);
  const char = chooseNextBubbleCharOnState(state);

  // Calm, relaxing upward speed (~7.8 to 9.8 seconds to cross full arena height)
  const traverseSeconds = 7.8 + state.prng() * 2.0;
  const speedY = (height + diameter) / traverseSeconds;
  const wobbleFreq = 1.35 + state.prng() * 0.75;
  const phase = state.prng() * Math.PI * 2;

  /** @type {BubbleEntity} */
  const bubbleObj = {
    id: state.nextBubbleId++,
    char,
    baseX,
    x: baseX,
    y: startY,
    diameter,
    radius,
    speedY,
    wobbleAmp,
    wobbleFreq,
    phase,
    age: 0,
    state: 'floating'
  };

  state.bubbles.push(bubbleObj);
  return bubbleObj;
}

/**
 * Spawns `MIN_BUBBLES` (5) initial bubbles staggered across the lower arena.
 * @param {GameState} state
 * @returns {BubbleEntity[]}
 */
export function spawnInitialWaveOnState(state) {
  /** @type {BubbleEntity[]} */
  const spawned = [];
  for (let i = 0; i < MIN_BUBBLES; i++) {
    const startY =
      state.stageHeight - 20 - (MIN_BUBBLES - 1 - i) * Math.min(72, state.stageHeight * 0.12);
    const b = spawnBubbleOnState(state, startY);
    if (b) spawned.push(b);
  }
  return spawned;
}

/**
 * Clamps all existing bubbles' `baseX` and `x` into the safe horizontal stage bounds on resize.
 * @param {GameState} state
 * @param {number} [newWidth]
 * @param {number} [newHeight]
 */
export function clampBubblesToStageOnState(state, newWidth, newHeight) {
  if (typeof newWidth === 'number' && !Number.isNaN(newWidth) && newWidth > 0) {
    state.stageWidth = newWidth;
  }
  if (typeof newHeight === 'number' && !Number.isNaN(newHeight) && newHeight > 0) {
    state.stageHeight = newHeight;
  }
  if (state.bubbles.length === 0 || state.stageWidth < 40) return;

  for (const b of state.bubbles) {
    const minX = b.radius + b.wobbleAmp + 8;
    const maxX = Math.max(minX + 4, state.stageWidth - b.radius - b.wobbleAmp - 8);
    if (b.baseX > maxX || b.baseX < minX) {
      b.baseX = minX + state.prng() * (maxX - minX);
      b.x = b.baseX;
    }
  }
}

/**
 * Starts a new session on `state`.
 * @param {GameState} state
 * @param {Array<any>} sessionWords
 * @param {Array<any>} [allVocabularyWords]
 */
export function startSessionOnState(state, sessionWords, allVocabularyWords = sessionWords) {
  stopSessionOnState(state);

  const safeSession = Array.isArray(sessionWords) ? sessionWords : [];
  state.allVocabWords = Array.isArray(allVocabularyWords)
    ? allVocabularyWords.map((w) => (w && typeof w === 'object' ? { ...w } : w))
    : safeSession.map((w) => (w && typeof w === 'object' ? { ...w } : w));
  state.queue = safeSession.map((w) => ({
    ...(typeof w === 'string' ? { word: w } : w),
    isRetry: false
  }));
  state.totalUniqueWords = state.queue.length;
  state.masteredCount = 0;
  state.firstAttemptRecorded.clear();
  state.sessionResults = [];
  state.sessionSummary = null;
  state.lastCheerMessage = null;

  state.running = true;
  state.paused = false;

  startNextWordOnState(state);
}

/**
 * Stops the active session and clears all bubbles.
 * @param {GameState} state
 */
export function stopSessionOnState(state) {
  state.running = false;
  state.paused = false;
  state.bubbles = [];
}

/**
 * Advances to the next word in `state.queue`, or finishes the session if `state.queue` is empty.
 * @param {GameState} state
 * @returns {{ finished: boolean, summary?: SessionSummary, wordObj?: SessionWordItem }}
 */
export function startNextWordOnState(state) {
  if (!state.running) return { finished: false };

  if (state.queue.length === 0) {
    const summary = finishSessionOnState(state);
    return { finished: true, summary };
  }

  state.bubbles = [];
  const nextWord = /** @type {SessionWordItem} */ (state.queue.shift());
  state.currentWordObj = nextWord;
  state.targetChars = Array.from(String(nextWord.word || '').trim().toLowerCase());
  state.currentIndex = 0;
  state.wordErrorCount = 0;
  state.letterErrorCount = 0;
  state.watermarkActive = false;
  state.wordTransitioning = false;
  state.spawnCounter = 0;
  state.spawnTimer = 0;

  // CHARACTERIZATION NOTE: If a word in the queue normalizes to 0 characters (empty string),
  // currentIndex (0) >= targetChars.length (0), so spawnInitialWaveOnState is a no-op.
  spawnInitialWaveOnState(state);
  return { finished: false, wordObj: nextWord };
}

/**
 * Finishes the active session, clearing bubbles and computing the `SessionSummary`.
 * @param {GameState} state
 * @returns {SessionSummary}
 */
export function finishSessionOnState(state) {
  state.running = false;
  state.bubbles = [];
  const firstTryPerfect = state.sessionResults.filter((r) => r.masteredFirstTry).length;
  const summary = {
    totalWords: state.totalUniqueWords,
    firstTryPerfect,
    results: state.sessionResults.map((r) => ({ ...r }))
  };
  state.sessionSummary = summary;
  return summary;
}

/**
 * Activates the Hint button on `state`.
 * @param {GameState} state
 * @returns {{ activated: boolean, pulsed: boolean }}
 */
export function useHintOnState(state) {
  if (!state.running || state.wordTransitioning || !state.currentWordObj) {
    return { activated: false, pulsed: false };
  }

  if (!state.watermarkActive) {
    state.wordErrorCount += 1;
    state.watermarkActive = true;
    return { activated: true, pulsed: false };
  } else {
    return { activated: false, pulsed: true };
  }
}

/**
 * Processes tapping a bubble on `state`.
 * @param {GameState} state
 * @param {number | BubbleEntity} bubbleOrId
 * @returns {{
 *   handled: boolean,
 *   correct?: boolean,
 *   bubble?: BubbleEntity,
 *   matchedSlotIndex?: number,
 *   matchedChar?: string,
 *   wordCompleted?: boolean,
 *   autoWatermarkTriggered?: boolean
 * }}
 */
export function handleBubbleTapOnState(state, bubbleOrId) {
  const bubble =
    typeof bubbleOrId === 'number'
      ? state.bubbles.find((b) => b.id === bubbleOrId)
      : bubbleOrId;

  if (
    !bubble ||
    !state.running ||
    state.paused ||
    state.wordTransitioning ||
    bubble.state !== 'floating' ||
    state.currentIndex >= state.targetChars.length
  ) {
    return { handled: false };
  }

  const targetChar = state.targetChars[state.currentIndex];
  const tappedChar = bubble.char;

  // Strict character & accent matching (e.g. 'e' !== 'é')
  if (tappedChar === targetChar) {
    bubble.state = 'popping';
    const matchedSlotIndex = state.currentIndex;
    const matchedChar = bubble.char;

    state.currentIndex += 1;
    state.letterErrorCount = 0;

    // Ensure next 3rd spawn cycle delivers the new required letter promptly if not already floating
    const nextRequired = state.targetChars[state.currentIndex];
    if (
      nextRequired &&
      !state.bubbles.some((b) => b.state === 'floating' && b.char === nextRequired)
    ) {
      state.spawnCounter = 2;
    }

    const wordCompleted = state.currentIndex >= state.targetChars.length;
    if (wordCompleted) {
      state.wordTransitioning = true;
    }

    return {
      handled: true,
      correct: true,
      bubble,
      matchedSlotIndex,
      matchedChar,
      wordCompleted,
      autoWatermarkTriggered: false
    };
  } else {
    bubble.state = 'fizzling';
    state.wordErrorCount += 1;
    state.letterErrorCount += 1;

    let autoWatermarkTriggered = false;
    if (state.letterErrorCount >= 2 && !state.watermarkActive) {
      state.watermarkActive = true;
      autoWatermarkTriggered = true;
    }

    return {
      handled: true,
      correct: false,
      bubble,
      wordCompleted: false,
      autoWatermarkTriggered
    };
  }
}

/**
 * Completes the current word (recording first-attempt SRS outcome, incrementing `masteredCount`
 * or re-queueing with `isRetry: true`, and choosing a celebration message), and optionally
 * advances immediately to the next word (`advanceImmediately = true` in headless mode).
 *
 * @param {GameState} state
 * @param {{ advanceImmediately?: boolean }} [options={}]
 * @returns {{
 *   completed: boolean,
 *   word?: string,
 *   errorsThisRound?: number,
 *   isFirstAttempt?: boolean,
 *   cheerMessage?: string,
 *   fadedBubbles?: BubbleEntity[]
 * }}
 */
export function recordWordCompletionOnState(state, options = {}) {
  if (!state.running || !state.currentWordObj) {
    return { completed: false };
  }

  const wordStr = state.currentWordObj.word;
  const errorsThisRound = state.wordErrorCount;
  const isFirstAttempt = !state.firstAttemptRecorded.has(wordStr);

  /** @type {BubbleEntity[]} */
  const fadedBubbles = [];
  for (const b of [...state.bubbles]) {
    if (b.state === 'floating') {
      b.state = 'popping';
      fadedBubbles.push(b);
    }
  }

  if (isFirstAttempt) {
    state.firstAttemptRecorded.add(wordStr);
    state.sessionResults.push({
      word: wordStr,
      firstAttemptErrors: errorsThisRound,
      masteredFirstTry: errorsThisRound === 0
    });
  }

  if (errorsThisRound === 0) {
    state.masteredCount += 1;
  } else {
    state.queue.push({
      ...state.currentWordObj,
      isRetry: true
    });
  }

  const cheerList = errorsThisRound === 0 ? CHEER_MESSAGES_PERFECT : CHEER_MESSAGES_PRACTICE;
  const cheerMessage = cheerList[Math.floor(state.prng() * cheerList.length)];
  state.lastCheerMessage = cheerMessage;

  if (options.advanceImmediately !== false) {
    startNextWordOnState(state);
  }

  return {
    completed: true,
    word: wordStr,
    errorsThisRound,
    isFirstAttempt,
    cheerMessage,
    fadedBubbles
  };
}

/**
 * Removes a specific bubble from `state.bubbles`.
 * @param {GameState} state
 * @param {number | BubbleEntity} bubbleOrId
 * @returns {BubbleEntity | null}
 */
export function removeBubbleOnState(state, bubbleOrId) {
  const idx =
    typeof bubbleOrId === 'number'
      ? state.bubbles.findIndex((b) => b.id === bubbleOrId)
      : state.bubbles.indexOf(bubbleOrId);
  if (idx !== -1) {
    const [removed] = state.bubbles.splice(idx, 1);
    return removed;
  }
  return null;
}

/**
 * Advances all `'floating'` bubbles by `dt` seconds and removes bubbles that floated past the top (`y < -radius * 0.35`).
 * @param {GameState} state
 * @param {number} dt
 * @returns {{ expired: BubbleEntity[], topFading: BubbleEntity[], floating: BubbleEntity[] }}
 */
export function updateBubblesOnState(state, dt) {
  /** @type {BubbleEntity[]} */
  const expired = [];
  /** @type {BubbleEntity[]} */
  const topFading = [];
  /** @type {BubbleEntity[]} */
  const floating = [];

  for (const b of state.bubbles) {
    if (b.state !== 'floating') continue;

    b.age += dt;
    b.y -= b.speedY * dt;
    b.x = b.baseX + Math.sin(b.age * b.wobbleFreq + b.phase) * b.wobbleAmp;

    if (b.y < -b.radius * 0.35) {
      expired.push(b);
    } else if (b.y < b.radius * 0.45) {
      topFading.push(b);
      floating.push(b);
    } else {
      floating.push(b);
    }
  }

  for (const exp of expired) {
    removeBubbleOnState(state, exp);
  }

  return { expired, topFading, floating };
}

/**
 * Maintains the floating bubble population between `MIN_BUBBLES` (5) and `MAX_BUBBLES` (7).
 * @param {GameState} state
 * @param {number} dt
 * @returns {BubbleEntity | null} Newly spawned bubble if one was spawned on this tick.
 */
export function maintainBubblePopulationOnState(state, dt) {
  const activeCount = state.bubbles.filter((b) => b.state === 'floating').length;
  // CHARACTERIZATION NOTE: spawnTimer always increments by dt even when activeCount >= MAX_BUBBLES (7).
  state.spawnTimer += dt;

  if (activeCount < MIN_BUBBLES && state.spawnTimer >= FAST_SPAWN_INTERVAL_SEC) {
    state.spawnTimer = 0;
    return spawnBubbleOnState(state);
  } else if (activeCount < MAX_BUBBLES && state.spawnTimer >= SPAWN_INTERVAL_SEC) {
    state.spawnTimer = 0;
    return spawnBubbleOnState(state);
  }
  return null;
}

/**
 * Clamps a raw deltaTime (`dt`) to `[0, MAX_DT_SEC]` (`[0, 0.05]`), guarding against `NaN` or negative values.
 * @param {number} [rawDt=0]
 * @returns {number}
 */
export function clampDeltaTime(rawDt = 0) {
  if (typeof rawDt !== 'number' || Number.isNaN(rawDt)) return 0;
  return Math.min(MAX_DT_SEC, Math.max(0, rawDt));
}

/**
 * Pure, deterministic state transition function: `nextState = stepGame(initialState, action, dt)`.
 * Does not mutate `initialState` — clones the state first, applies the action and/or `dt` tick, and returns `nextState`.
 *
 * @param {GameState} initialState
 * @param {GameAction | null | undefined} [action]
 * @param {number} [dt=0]
 * @returns {GameState}
 */
export function stepGame(initialState, action = null, dt = 0) {
  const nextState = cloneGameState(initialState);

  if (action && typeof action === 'object') {
    switch (action.type) {
      case 'START_SESSION': {
        startSessionOnState(
          nextState,
          action.sessionWords,
          action.allVocabWords || action.sessionWords
        );
        break;
      }
      case 'PAUSE': {
        if (nextState.running) {
          nextState.paused = true;
        }
        break;
      }
      case 'RESUME': {
        if (nextState.running) {
          nextState.paused = false;
        }
        break;
      }
      case 'STOP': {
        stopSessionOnState(nextState);
        break;
      }
      case 'RESIZE': {
        clampBubblesToStageOnState(nextState, action.width, action.height);
        break;
      }
      case 'USE_HINT': {
        useHintOnState(nextState);
        break;
      }
      case 'TAP_BUBBLE': {
        const res = handleBubbleTapOnState(nextState, action.bubbleId);
        // Remove popped/fizzled bubble in headless stepper if it was tapped
        if (res.handled && res.bubble) {
          removeBubbleOnState(nextState, res.bubble.id);
        }
        break;
      }
      case 'REMOVE_BUBBLE': {
        removeBubbleOnState(nextState, action.bubbleId);
        break;
      }
      case 'COMPLETE_WORD': {
        if (nextState.running && nextState.wordTransitioning && nextState.currentWordObj) {
          recordWordCompletionOnState(nextState, { advanceImmediately: true });
        }
        break;
      }
      case 'TICK': {
        const rawTickDt = typeof action.dt === 'number' ? action.dt : dt;
        const clampedDt = clampDeltaTime(rawTickDt);
        if (nextState.running && !nextState.paused && !nextState.wordTransitioning && clampedDt > 0) {
          updateBubblesOnState(nextState, clampedDt);
          maintainBubblePopulationOnState(nextState, clampedDt);
        }
        return nextState;
      }
      default:
        break;
    }
  }

  // If a positive dt was passed alongside a non-TICK action (or with action === null), advance kinematics
  const clampedDt = clampDeltaTime(dt);
  if (
    (!action || action.type !== 'TICK') &&
    clampedDt > 0 &&
    nextState.running &&
    !nextState.paused &&
    !nextState.wordTransitioning
  ) {
    updateBubblesOnState(nextState, clampedDt);
    maintainBubblePopulationOnState(nextState, clampedDt);
  }

  return nextState;
}
