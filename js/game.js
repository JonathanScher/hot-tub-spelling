/**
 * Cozy Tub Spelling - Core Floating Bubble & Sequential Spelling Engine
 *
 * Implements:
 * - Smart Spawning Algorithm:
 *     * Maintains 5 to 7 floating lowercase bubbles on screen.
 *     * Every 3rd bubble spawned is strictly targetWord[currentIndex].
 *     * 30% of remaining bubbles are future letters from targetWord.
 *     * 70% of remaining bubbles are plausible distractors (including accented variants if used).
 * - Strict lowercase & accent character matching (tappedChar === targetChar).
 * - Watermark scaffolding triggered via Hint button (wordErrorCount++) or 2 mistakes on current letter.
 * - Zero-error mastery criterion with automatic in-session re-queueing when wordErrorCount > 0.
 *
 * Delegates pure state & deterministic PRNG mechanics to `js/game-core.js` (`createGameState`, `stepGame`).
 */

import { soundEngine } from './audio.js';
import { speechEngine } from './speech.js';
import { recordTrapError, getProfileTrapHistory } from './srs.js';
import { createPRNG } from './prng.js';
import {
  MIN_BUBBLES,
  MAX_BUBBLES,
  SPAWN_INTERVAL_SEC,
  CHEER_MESSAGES_PERFECT,
  CHEER_MESSAGES_PRACTICE,
  ensureSeededPRNG,
  createGameState,
  stepGame,
  isMotorSlip,
  computeBubbleDiameter,
  chooseNextBubbleCharOnState,
  pickNonOverlappingXOnState,
  spawnBubbleOnState,
  spawnBubbleWithCharOnState,
  hasTargetInLowerTwoThirds,
  useHintOnState,
  isSlotWatermarkVisible,
  handleBubbleTapOnState,
  clampDeltaTime,
  getNextUnfilledIndex
} from './game-core.js';

export {
  MIN_BUBBLES,
  MAX_BUBBLES,
  SPAWN_INTERVAL_SEC,
  CHEER_MESSAGES_PERFECT,
  CHEER_MESSAGES_PRACTICE,
  createGameState,
  stepGame,
  createPRNG,
  getNextUnfilledIndex
};

export class HotTubGame {
  /**
   * @param {object} [config={}]
   * @param {HTMLElement | null} [config.bubbleStage] - Container where bubbles float upward
   * @param {HTMLElement | null} [config.slotsContainer] - Wooden signboard container for word letter slots
   * @param {HTMLElement | null} [config.flyingLayer] - Overlay layer for flying popped letters & particles
   * @param {HTMLElement | null} [config.mascotWrap] - Bath companion mascot element
   * @param {HTMLElement | null} [config.mascotSpeech] - Mascot speech bubble element
   * @param {HTMLElement | null} [config.hintButton] - Hint button element
   * @param {HTMLElement | null} [config.progressFill] - Progress bar / pebbles container
   * @param {HTMLElement | null} [config.progressLabel] - Text label e.g. "3 / 8"
   * @param {HTMLElement | null} [config.retryBadge] - Subtle badge shown when revisiting a word in-session
   * @param {(wordStr: string, firstAttemptErrors: number, attemptDetails?: any) => void} [config.onFirstAttemptComplete]
   * @param {(summary: import('./game-core.js').SessionSummary) => void} [config.onSessionComplete]
   * @param {number} [config.seed] - Optional seed for deterministic PRNG
   * @param {import('./prng.js').SeededPRNG | (() => number)} [config.prng] - Optional injectable PRNG
   */
  constructor(config = {}) {
    this.stage = config.bubbleStage || null;
    this.slotsContainer = config.slotsContainer || null;
    this.flyingLayer = config.flyingLayer || null;
    this.mascotWrap = config.mascotWrap || null;
    this.mascotSpeech = config.mascotSpeech || null;
    this.hintButton = config.hintButton || null;
    this.progressFill = config.progressFill || null;
    this.progressLabel = config.progressLabel || null;
    this.retryBadge = config.retryBadge || null;
    this.progressPillEl = typeof document !== 'undefined' ? document.getElementById('session-progress-pill') : null;
    this.tubeContainer = typeof document !== 'undefined' ? document.getElementById('progress-tube') : null;
    this.tubeFillEl = typeof document !== 'undefined' ? document.getElementById('progress-tube-fill') : null;
    this.duckDockEl = typeof document !== 'undefined' ? document.getElementById('progress-duck-dock') : null;
    this.splashAnchorEl = typeof document !== 'undefined' ? document.getElementById('tube-splash-anchor') : null;

    this.onFirstAttemptComplete = config.onFirstAttemptComplete || (() => {});
    this.onSessionComplete = config.onSessionComplete || (() => {});

    const initialSeed =
      typeof config.seed === 'number'
        ? config.seed
        : typeof Date !== 'undefined'
          ? Date.now() >>> 0
          : 1;
    this.prng = ensureSeededPRNG(config.prng, initialSeed);

    /** @type {Array<any>} */
    this.allVocabWords = [];
    /** @type {import('./game-core.js').SessionWordItem[]} */
    this.queue = [];
    this.totalUniqueWords = 0;
    this.masteredCount = 0;
    /** @type {Set<string>} */
    this.firstAttemptRecorded = new Set();
    /** @type {import('./game-core.js').SessionResult[]} */
    this.sessionResults = [];

    /** @type {import('./game-core.js').SessionWordItem | null} */
    this.currentWordObj = null;
    /** @type {string[]} */
    this.targetChars = [];
    this.currentIndex = 0;
    this.wordErrorCount = 0;
    this.letterErrorCount = 0;
    this.prefilledIndices = [];
    this.letterErrorsThisRound = new Set();
    this.watermarkActive = false;
    this.hintWatermarkUsed = false;
    this.wrongTapsOnWord = [];
    this.fullWordWatermark = false;
    this.wordTransitioning = false;
    this.running = false;
    this.paused = false;

    /** @type {import('./game-core.js').BubbleEntity[]} */
    this.bubbles = [];
    this.nextBubbleId = 1;
    this.spawnCounter = 0;
    this.spawnTimer = 0;
    this.targetSpawnIn = 1 + Math.floor(this.prng() * 3);
    this.targetSpawnIn = 0;
    this.lastFrameTime = 0;
    /** @type {number | null} */
    this.rafId = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this.nextWordTimeout = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this.mascotHideTimeout = null;
    this.bubbleImgAvailable = true;

    const bounds = this._getStageBounds();
    this.stageWidth = bounds.width;
    this.stageHeight = bounds.height;
    /** @type {string | null} */
    this.lastCheerMessage = null;
    /** @type {import('./game-core.js').SessionSummary | null} */
    this.sessionSummary = null;

    this._onResize = () => this._clampBubblesToStage();
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', this._onResize);
    }

    this._checkBubbleSprite();
  }

  _clampBubblesToStage() {
    if (!this.stage || this.bubbles.length === 0) return;
    const rect = this._getStageBounds();
    this.stageWidth = rect.width;
    this.stageHeight = rect.height;
    if (rect.width < 40) return;
    for (const b of this.bubbles) {
      const minX = b.radius + b.wobbleAmp + 8;
      const maxX = Math.max(minX + 4, rect.width - b.radius - b.wobbleAmp - 8);
      if (b.baseX > maxX || b.baseX < minX) {
        b.baseX = minX + this.prng() * (maxX - minX);
        b.x = b.baseX;
        this._positionBubbleElement(b);
      }
    }
  }

  _checkBubbleSprite() {
    if (typeof Image === 'undefined') {
      this.bubbleImgAvailable = true;
      return;
    }
    const probe = new Image();
    probe.onload = () => {
      this.bubbleImgAvailable = true;
    };
    probe.onerror = () => {
      this.bubbleImgAvailable = false;
    };
    probe.src = 'assets/bubble.webp';
  }

  /**
   * Starts a new 8-10 word session.
   * @param {Array<any>} sessionWords
   * @param {Array<any>} [allVocabularyWords]
   */
  startSession(sessionWords, allVocabularyWords = sessionWords) {
    this.stop();

    this.allVocabWords = Array.isArray(allVocabularyWords) ? allVocabularyWords : sessionWords;
    this.queue = sessionWords.map((w) => ({ ...w, isRetry: false, retryCount: 0 }));
    this.prefilledIndices = [];
    this.letterErrorsThisRound = new Set();
    this.totalUniqueWords = this.queue.length;
    this.masteredCount = 0;
    this.firstAttemptRecorded.clear();
    this.sessionResults = [];
    this.sessionSummary = null;
    this.lastCheerMessage = null;
    this.trapHistory = getProfileTrapHistory();

    this.running = true;
    this.paused = false;
    this._renderProgressPebbles();

    speechEngine.prefetchWords(this.queue);

    this._startNextWord();
    this.lastFrameTime = typeof performance !== 'undefined' ? performance.now() : 0;
    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame((ts) => this._loop(ts));
    }
  }

  pause() {
    this.paused = true;
  }

  resume() {
    if (!this.running) return;
    this.paused = false;
    this.lastFrameTime = typeof performance !== 'undefined' ? performance.now() : 0;
  }

  stop() {
    this.running = false;
    this.paused = false;
    if (this.rafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.nextWordTimeout) {
      clearTimeout(this.nextWordTimeout);
      this.nextWordTimeout = null;
    }
    if (this.mascotHideTimeout) {
      clearTimeout(this.mascotHideTimeout);
      this.mascotHideTimeout = null;
    }
    this._clearAllBubbles();
    if (this.flyingLayer) {
      this.flyingLayer.innerHTML = '';
    }
  }

  /**
   * Replays pronunciation of the active word ("Listen Again" button).
   */
  replayCurrentWord() {
    if (!this.currentWordObj) return;
    speechEngine.speakWord(this.currentWordObj);
  }

  /**
   * Activates the watermark scaffolding via the Hint button.
   * Counts as an error (wordErrorCount++) for SRS & in-session retry rules.
   */
  useHintButton() {
    const res = useHintOnState(this);
    if (!res.activated && !res.pulsed) return;

    if (res.activated) {
      soundEngine.playHintWhisper();
      this._activateWatermark();
      this._showMascotMessage('Follow the faint letters in order!', 2400);
    } else if (res.pulsed) {
      // Gentle visual pulse if watermark is already showing
      soundEngine.playUiTap();
      this._pulseEmptyWatermarkSlots();
    }
  }

  _startNextWord() {
    if (!this.running) return;

    if (this.queue.length === 0) {
      this._finishSession();
      return;
    }

    this._clearAllBubbles();
    const nextItem = /** @type {import('./game-core.js').SessionWordItem} */ (this.queue.shift());
    this.currentWordObj = nextItem;
    // Use Array.from to split cleanly by Unicode code point while keeping lowercase accents intact
    this.targetChars = Array.from(String(this.currentWordObj.word || '').trim().toLowerCase());
    this.wordErrorCount = 0;
    this.letterErrorCount = 0;
    this.watermarkActive = false;
    this.hintWatermarkUsed = false;
    this.wrongTapsOnWord = [];
    this.fullWordWatermark = false;
    this.wordTransitioning = false;
    this.spawnCounter = 0;
    this.spawnTimer = 0;
    this.letterErrorsThisRound = new Set();

    const retryCount = nextItem.retryCount || 0;
    if (retryCount === 2 && Array.isArray(nextItem.firstTryCorrectIndices)) {
      let prefilled = nextItem.firstTryCorrectIndices.filter((idx) => idx < this.targetChars.length);
      if (prefilled.length >= this.targetChars.length && this.targetChars.length > 0) {
        prefilled = prefilled.slice(0, this.targetChars.length - 1);
      }
      this.prefilledIndices = prefilled;
    } else {
      this.prefilledIndices = [];
    }

    this.currentIndex = getNextUnfilledIndex(this.targetChars, this.prefilledIndices, 0);

    if (this.hintButton) {
      this.hintButton.classList.remove('is-active');
      this.hintButton.setAttribute('aria-pressed', 'false');
    }

    if (this.retryBadge) {
      if (this.currentWordObj.isRetry) {
        this.retryBadge.hidden = false;
        this.retryBadge.textContent = 'Practice Again';
      } else {
        this.retryBadge.hidden = true;
      }
    }

    this._renderWordSlots();
    this._spawnInitialWave();

    // Automatically pronounce the word out loud at the start of each word
    speechEngine.speakWord(this.currentWordObj);
  }

  _renderWordSlots() {
    if (!this.slotsContainer || typeof document === 'undefined') return;
    this.slotsContainer.innerHTML = '';

    const count = this.targetChars.length;
    this.slotsContainer.style.setProperty('--word-len', String(count));
    this.slotsContainer.classList.toggle('is-long-word', count >= 8);
    this.slotsContainer.classList.toggle('is-very-long-word', count >= 10);

    this.targetChars.forEach((ch, idx) => {
      const slot = document.createElement('div');
      slot.className = 'letter-slot';
      if (idx === this.currentIndex) slot.classList.add('is-current');
      slot.dataset.index = String(idx);
      slot.dataset.targetChar = ch;

      const watermarkSpan = document.createElement('span');
      watermarkSpan.className = 'slot-watermark';
      watermarkSpan.textContent = ch;
      watermarkSpan.setAttribute('aria-hidden', 'true');

      const filledSpan = document.createElement('span');
      filledSpan.className = 'slot-letter';

      const isPrefilled = this.prefilledIndices && this.prefilledIndices.includes(idx);
      if (isPrefilled) {
        slot.classList.add('is-filled', 'is-prefilled');
        filledSpan.textContent = ch;
      } else {
        filledSpan.textContent = '';
      }

      const underline = document.createElement('span');
      underline.className = 'slot-underline';

      slot.appendChild(watermarkSpan);
      slot.appendChild(filledSpan);
      slot.appendChild(underline);
      if (this.slotsContainer) {
        this.slotsContainer.appendChild(slot);
      }
    });
  }

  _updateSlotStates() {
    if (!this.slotsContainer) return;
    const slots = this.slotsContainer.querySelectorAll('.letter-slot');
    const prefilledSet = new Set(this.prefilledIndices || []);
    slots.forEach((slot, idx) => {
      const isPrefilled = prefilledSet.has(idx);
      const isFilled = idx < this.currentIndex || isPrefilled;
      const isCurrent = idx === this.currentIndex && !this.wordTransitioning;
      slot.classList.toggle('is-filled', isFilled);
      slot.classList.toggle('is-current', isCurrent);
      slot.classList.toggle('show-watermark', isSlotWatermarkVisible(this, idx));
    });
  }

  _activateWatermark() {
    this.watermarkActive = true;
    if (this.hintButton) {
      const isHintActive = Boolean(this.fullWordWatermark);
      this.hintButton.classList.toggle('is-active', isHintActive);
      this.hintButton.setAttribute('aria-pressed', String(isHintActive));
    }
    this._updateSlotStates();
  }

  _pulseEmptyWatermarkSlots() {
    if (!this.slotsContainer) return;
    const emptySlots = this.slotsContainer.querySelectorAll('.letter-slot.show-watermark');
    emptySlots.forEach((el) => {
      const htmlEl = /** @type {HTMLElement} */ (el);
      htmlEl.classList.remove('watermark-pulse');
      void htmlEl.offsetWidth;
      htmlEl.classList.add('watermark-pulse');
    });
  }

  /**
   * Spawns 5 initial bubbles gently staggered across the lower tub so the player
   * immediately sees 5-7 rising bubbles without waiting on an empty screen.
   */
  _spawnInitialWave() {
    const rect = this._getStageBounds();
    this.stageWidth = rect.width;
    this.stageHeight = rect.height;
    for (let i = 0; i < MIN_BUBBLES; i++) {
      const startY = rect.height - 20 - (MIN_BUBBLES - 1 - i) * Math.min(72, rect.height * 0.12);
      this._spawnBubble(startY);
    }
  }

  /**
   * Smart Spawning Algorithm (Crucial for Child UX):
   * - Every 3rd bubble spawned MUST be targetWord[currentIndex].
   * - 30% of remaining bubbles are future letters from the current word.
   * - 70% of remaining bubbles are plausible distractor letters (including accented variants if used).
   */
  _chooseNextBubbleChar() {
    return chooseNextBubbleCharOnState(this);
  }

  /**
   * Mounts a DOM button element for a newly spawned bubble entity.
   * @param {import('./game-core.js').BubbleEntity} bubbleObj
   */
  _mountBubbleElement(bubbleObj) {
    if (!this.stage || typeof document === 'undefined') return;

    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'soap-bubble';
    if (!this.bubbleImgAvailable) {
      el.classList.add('use-svg-fallback');
    }
    el.style.width = `${bubbleObj.diameter}px`;
    el.style.height = `${bubbleObj.diameter}px`;
    el.setAttribute('aria-label', `Letter ${bubbleObj.char}`);

    const innerHtml = `
      <span class="bubble-art" aria-hidden="true"></span>
      <span class="bubble-char">${this._escapeHtml(bubbleObj.char)}</span>
    `;
    el.innerHTML = innerHtml;

    bubbleObj.el = el;

    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this._handleBubbleTap(bubbleObj);
    });

    this._positionBubbleElement(bubbleObj);
    this.stage.appendChild(el);
  }

  /**
   * @param {number | null} [overrideY=null]
   */
  _spawnBubble(overrideY = null) {
    if (!this.stage || this.wordTransitioning || this.currentIndex >= this.targetChars.length) {
      return;
    }

    const rect = this._getStageBounds();
    this.stageWidth = rect.width;
    this.stageHeight = rect.height;
    if (rect.width < 40 || rect.height < 40) return;

    const bubbleObj = spawnBubbleOnState(this, overrideY);
    if (!bubbleObj) return;

    this._mountBubbleElement(bubbleObj);
  }

  /**
   * @param {number} minX
   * @param {number} maxX
   * @param {number} spawnY
   * @param {number} diameter
   */
  _pickNonOverlappingX(minX, maxX, spawnY, diameter) {
    return pickNonOverlappingXOnState(this, minX, maxX, spawnY, diameter);
  }

  /**
   * @param {{ width: number, height: number }} stageRect
   */
  _computeBubbleDiameter(stageRect) {
    return computeBubbleDiameter(stageRect);
  }

  /**
   * @param {import('./game-core.js').BubbleEntity} bubble
   */
  _handleBubbleTap(bubble) {
    if (
      !this.running ||
      this.paused ||
      this.wordTransitioning ||
      bubble.state !== 'floating' ||
      this.currentIndex >= this.targetChars.length
    ) {
      return;
    }

    const targetChar = this.targetChars[this.currentIndex];
    const tappedChar = bubble.char;

    // Strict character & accent matching (e.g. 'e' !== 'é')
    if (tappedChar === targetChar) {
      this._onCorrectBubbleTap(bubble);
    } else {
      this._onWrongBubbleTap(bubble);
    }
  }

  /**
   * @param {import('./game-core.js').BubbleEntity} bubble
   */
  _onCorrectBubbleTap(bubble) {
    const res = handleBubbleTapOnState(this, bubble);
    if (!res.handled || !res.correct) return;

    if (Array.isArray(res.urgentSpawned) && res.urgentSpawned.length > 0) {
      for (const b of res.urgentSpawned) {
        this._mountBubbleElement(b);
      }
    }

    const matchedSlotIndex = /** @type {number} */ (res.matchedSlotIndex);
    const matchedChar = /** @type {string} */ (res.matchedChar);

    soundEngine.playBubblePop(matchedSlotIndex);
    this._spawnPopDroplets(bubble.x, bubble.y, bubble.diameter);

    if (bubble.el) {
      bubble.el.classList.add('is-popping');
    }
    setTimeout(() => this._removeBubble(bubble), 220);

    this._animateFlyingLetterToSlot(bubble, matchedSlotIndex, matchedChar);
    this._nudgeMascotHappy();

    if (res.wordCompleted) {
      this._updateSlotStates();
      setTimeout(() => this._completeCurrentWord(), 340);
    } else {
      this._updateSlotStates();
    }
  }

  /**
   * @param {import('./game-core.js').BubbleEntity} bubble
   */
  _onWrongBubbleTap(bubble) {
    if (this.letterErrorsThisRound) {
      this.letterErrorsThisRound.add(this.currentIndex);
    }
    const res = handleBubbleTapOnState(this, bubble);
    if (!res.handled || res.correct) return;

    if (res.trapCategory) {
      recordTrapError(res.trapCategory);
    }

    soundEngine.playWrongFizzle();

    if (bubble.el) {
      bubble.el.classList.add('is-wrong-fizzle');
    }
    setTimeout(() => this._removeBubble(bubble), 460);

    // Gentle wobble feedback on current target slot
    if (this.slotsContainer) {
      const currentSlot = /** @type {HTMLElement | null} */ (
        this.slotsContainer.querySelector(`.letter-slot[data-index="${this.currentIndex}"]`)
      );
      if (currentSlot) {
        currentSlot.classList.remove('slot-gentle-shake');
        void currentSlot.offsetWidth;
        currentSlot.classList.add('slot-gentle-shake');
      }
    }

    // Trigger watermark scaffolding automatically after 2 mistakes on the current letter
    if (res.autoWatermarkTriggered) {
      soundEngine.playHintWhisper();
      this._activateWatermark();
      this._showMascotMessage('Here is a gentle hint for this letter!', 2400);
    }
  }

  /**
   * @param {import('./game-core.js').BubbleEntity} bubble
   * @param {number} slotIndex
   * @param {string} char
   */
  _animateFlyingLetterToSlot(bubble, slotIndex, char) {
    const slotEl = this.slotsContainer
      ? this.slotsContainer.querySelector(`.letter-slot[data-index="${slotIndex}"]`)
      : null;

    if (!slotEl || !this.flyingLayer || !bubble.el || typeof document === 'undefined') {
      this._fillSlotText(slotIndex, char);
      return;
    }

    const bubbleRect = bubble.el.getBoundingClientRect();
    const slotRect = slotEl.getBoundingClientRect();
    const layerRect = this.flyingLayer.getBoundingClientRect();

    const startX = bubbleRect.left + bubbleRect.width / 2 - layerRect.left;
    const startY = bubbleRect.top + bubbleRect.height / 2 - layerRect.top;
    const endX = slotRect.left + slotRect.width / 2 - layerRect.left;
    const endY = slotRect.top + slotRect.height / 2 - layerRect.top;

    const flyer = document.createElement('div');
    flyer.className = 'flying-letter';
    flyer.textContent = char;
    flyer.style.transform = `translate3d(${startX}px, ${startY}px, 0) translate(-50%, -50%) scale(1.15)`;
    this.flyingLayer.appendChild(flyer);

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          flyer.style.transform = `translate3d(${endX}px, ${endY}px, 0) translate(-50%, -50%) scale(0.95)`;
          flyer.style.opacity = '0.92';
        });
      });
    }

    setTimeout(() => {
      flyer.remove();
      this._fillSlotText(slotIndex, char);
    }, 300);
  }

  /**
   * @param {number} slotIndex
   * @param {string} char
   */
  _fillSlotText(slotIndex, char) {
    if (!this.slotsContainer) return;
    const slotEl = this.slotsContainer.querySelector(`.letter-slot[data-index="${slotIndex}"]`);
    if (!slotEl) return;

    const letterSpan = slotEl.querySelector('.slot-letter');
    if (letterSpan) {
      letterSpan.textContent = char;
    }
    slotEl.classList.add('is-filled', 'just-landed');
    slotEl.classList.remove('show-watermark');
    setTimeout(() => slotEl.classList.remove('just-landed'), 420);
  }

  /**
   * @param {number} cx
   * @param {number} cy
   * @param {number} diameter
   */
  _spawnPopDroplets(cx, cy, diameter) {
    if (!this.stage || typeof document === 'undefined') return;
    const count = 7;
    const colors = ['#BCE0F2', '#F6B8AD', '#D8CEE8', '#FFF6E6', '#B8DEC8'];

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (this.prng() - 0.5) * 0.4;
      const dist = diameter * (0.45 + this.prng() * 0.35);
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;

      const drop = document.createElement('span');
      drop.className = 'pop-droplet';
      drop.style.left = `${cx}px`;
      drop.style.top = `${cy}px`;
      drop.style.backgroundColor = colors[i % colors.length];
      drop.style.setProperty('--dx', `${dx.toFixed(1)}px`);
      drop.style.setProperty('--dy', `${dy.toFixed(1)}px`);

      this.stage.appendChild(drop);
      setTimeout(() => drop.remove(), 480);
    }
  }

  async _completeCurrentWord() {
    if (!this.running || !this.currentWordObj) return;

    const wordStr = this.currentWordObj.word;
    const errorsThisRound = this.wordErrorCount;
    const isFirstAttempt = !this.firstAttemptRecorded.has(wordStr);

    // Gently float away remaining bubbles
    for (const b of [...this.bubbles]) {
      if (b.state === 'floating') {
        b.state = 'popping';
        if (b.el) {
          b.el.classList.add('is-gentle-fade');
        }
        setTimeout(() => this._removeBubble(b), 350);
      }
    }

    // 1. Long-term Leitner SRS progression is determined strictly by the FIRST attempt in the session
    let firstTryCorrectIndices = this.currentWordObj.firstTryCorrectIndices;
    if (isFirstAttempt) {
      this.firstAttemptRecorded.add(wordStr);
      this.sessionResults.push({
        word: wordStr,
        firstAttemptErrors: errorsThisRound,
        masteredFirstTry: errorsThisRound === 0
      });
      firstTryCorrectIndices = this.targetChars
        .map((_, idx) => idx)
        .filter((idx) => !this.letterErrorsThisRound?.has(idx));
      this.currentWordObj.firstTryCorrectIndices = firstTryCorrectIndices;

      const hintWatermarkUsed = Boolean(this.hintWatermarkUsed);
      const motorSlip = isMotorSlip({
        errors: errorsThisRound,
        hintWatermarkUsed,
        wrongTaps: this.wrongTapsOnWord,
        word: wordStr
      });
      const attemptDetails = {
        errors: errorsThisRound,
        firstAttemptErrors: errorsThisRound,
        isMotorSlip: motorSlip,
        hintWatermarkUsed,
        wrongTaps: [...(this.wrongTapsOnWord || [])],
        word: wordStr
      };
      this.onFirstAttemptComplete(wordStr, errorsThisRound, attemptDetails);
    }

    // 2. Zero-Error Mastery check & In-Session Retry re-queueing (capped at 2 retries per session)
    const currentRetryCount = this.currentWordObj.retryCount || 0;
    const willBeMastered = errorsThisRound === 0;
    if (willBeMastered) {
      this.masteredCount += 1;
    } else if (currentRetryCount < 2) {
      this.queue.push({
        ...this.currentWordObj,
        isRetry: true,
        retryCount: currentRetryCount + 1,
        firstTryCorrectIndices: firstTryCorrectIndices ? [...firstTryCorrectIndices] : []
      });
    }

    const isFinalMastery = willBeMastered && this.queue.length === 0 && this.masteredCount === this.totalUniqueWords;

    if (willBeMastered) {
      this._updateProgressPebbles();
      this._triggerWinCelebration(isFinalMastery);
    }

    // 3. Celebration feedback: warm chime arpeggio, mascot celebration, and pronounce word again
    soundEngine.playWordComplete();
    if (this.slotsContainer) {
      this.slotsContainer.classList.add('word-celebrating');
    }

    const cheerList = errorsThisRound === 0 ? CHEER_MESSAGES_PERFECT : CHEER_MESSAGES_PRACTICE;
    const msg = isFinalMastery
      ? '🏆 Incroyable ! Toutes les bulles terminées !'
      : cheerList[Math.floor(this.prng() * cheerList.length)];
    this.lastCheerMessage = msg;
    this._celebrateMascot(msg);

    // Pronounce the full word again and pause before moving to the next word
    const pauseDuration = isFinalMastery ? 3200 : 2000;
    const minPausePromise = new Promise((resolve) => {
      this.nextWordTimeout = setTimeout(resolve, pauseDuration);
    });
    const cappedSpeechPromise = Promise.race([
      speechEngine.speakWord(this.currentWordObj).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 2600))
    ]);

    await Promise.all([minPausePromise, cappedSpeechPromise]);
    this.nextWordTimeout = null;

    if (!this.running) return;
    if (this.slotsContainer) {
      this.slotsContainer.classList.remove('word-celebrating');
    }
    this._startNextWord();
  }

  _finishSession() {
    this.running = false;
    if (this.rafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this._clearAllBubbles();
    soundEngine.playSessionComplete();

    const firstTryPerfect = this.sessionResults.filter((r) => r.masteredFirstTry).length;
    const summary = {
      totalWords: this.totalUniqueWords,
      firstTryPerfect,
      results: this.sessionResults
    };
    this.sessionSummary = summary;
    this.onSessionComplete(summary);
  }

  /**
   * @param {number} timestamp
   */
  _loop(timestamp) {
    if (!this.running) return;

    const rawDt = (timestamp - this.lastFrameTime) / 1000;
    this.lastFrameTime = timestamp;
    const dt = clampDeltaTime(rawDt);

    if (!this.paused && !this.wordTransitioning) {
      this._updateBubbles(dt);
      this._maintainBubblePopulation(dt);
    }

    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame((ts) => this._loop(ts));
    }
  }

  /**
   * @param {number} dt
   */
  _updateBubbles(dt) {
    const toRemove = [];

    for (const b of this.bubbles) {
      if (b.state !== 'floating') continue;

      b.age += dt;
      b.y -= b.speedY * dt;
      b.x = b.baseX + Math.sin(b.age * b.wobbleFreq + b.phase) * b.wobbleAmp;

      // Pop gently at the top of the screen
      if (b.y < -b.radius * 0.35) {
        toRemove.push(b);
      } else if (b.y < b.radius * 0.45) {
        if (b.el) {
          b.el.classList.add('is-top-fading');
        }
        this._positionBubbleElement(b);
      } else {
        this._positionBubbleElement(b);
      }
    }

    for (const expired of toRemove) {
      this._removeBubble(expired);
    }
  }

  /**
   * @param {number} dt
   */
  _maintainBubblePopulation(dt) {
    const activeCount = this.bubbles.filter((b) => b.state === 'floating').length;
    this.spawnTimer += dt;

    if (activeCount < MIN_BUBBLES && this.spawnTimer >= 0.32) {
      this.spawnTimer = 0;
      this._spawnBubble();
    } else if (activeCount < MAX_BUBBLES && this.spawnTimer >= SPAWN_INTERVAL_SEC) {
      this.spawnTimer = 0;
      this._spawnBubble();
    }
  }

  /**
   * @param {import('./game-core.js').BubbleEntity} b
   */
  _positionBubbleElement(b) {
    if (!b.el) return;
    const left = b.x - b.radius;
    const top = b.y - b.radius;
    b.el.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
  }

  /**
   * @param {import('./game-core.js').BubbleEntity} bubble
   */
  _removeBubble(bubble) {
    const idx = this.bubbles.indexOf(bubble);
    if (idx !== -1) {
      this.bubbles.splice(idx, 1);
    }
    if (bubble.el && bubble.el.parentNode) {
      bubble.el.remove();
    }
  }

  _clearAllBubbles() {
    for (const b of this.bubbles) {
      if (b.el && b.el.parentNode) {
        b.el.remove();
      }
    }
    this.bubbles = [];
  }

  _renderProgressPebbles() {
    if (typeof document !== 'undefined') {
      if (!this.tubeFillEl) {
        this.progressPillEl = document.getElementById('session-progress-pill');
        this.tubeContainer = document.getElementById('progress-tube');
        this.tubeFillEl = document.getElementById('progress-tube-fill');
        this.duckDockEl = document.getElementById('progress-duck-dock');
        this.splashAnchorEl = document.getElementById('tube-splash-anchor');
      }
      if (this.progressPillEl) {
        this.progressPillEl.classList.remove('is-grand-finale');
      }
      if (this.duckDockEl) {
        this.duckDockEl.classList.remove('is-victorious', 'is-hopping');
      }
      if (this.progressFill) {
        this.progressFill.innerHTML = '';
        for (let i = 0; i < this.totalUniqueWords; i++) {
          const dot = document.createElement('span');
          dot.className = 'progress-tube-tick progress-pebble';
          this.progressFill.appendChild(dot);
        }
      }
      if (this.tubeContainer) {
        this.tubeContainer.setAttribute('aria-valuemin', '0');
        this.tubeContainer.setAttribute('aria-valuemax', String(this.totalUniqueWords));
        this.tubeContainer.setAttribute('aria-valuenow', '0');
      }
      this._initDuckInteractions();
    }
    this._updateProgressPebbles();
  }

  /**
   * Enables tactile duck squish/squeak on tap for child playfulness.
   */
  _initDuckInteractions() {
    if (this._duckInteractionsWired || !this.duckDockEl) return;
    this._duckInteractionsWired = true;

    this.duckDockEl.addEventListener('click', () => {
      if (this.duckDockEl && this.duckDockEl.classList.contains('is-victorious')) return;
      if (this.duckDockEl) {
        this.duckDockEl.classList.remove('is-hopping');
        void this.duckDockEl.offsetWidth;
        this.duckDockEl.classList.add('is-hopping');
        setTimeout(() => {
          if (this.duckDockEl) this.duckDockEl.classList.remove('is-hopping');
        }, 600);
      }
      if (soundEngine && typeof soundEngine.playDuckSqueak === 'function') {
        soundEngine.playDuckSqueak();
      }
    });
  }

  _updateProgressPebbles() {
    const pct = this.totalUniqueWords > 0 ? (this.masteredCount / this.totalUniqueWords) * 100 : 0;
    const clampedPct = Math.min(100, Math.max(0, pct));

    if (this.progressFill) {
      const pebbles = this.progressFill.querySelectorAll('.progress-pebble');
      pebbles.forEach((p, idx) => {
        p.classList.toggle('is-complete', idx < this.masteredCount);
      });
    }

    if (this.tubeFillEl) {
      this.tubeFillEl.style.width = `${clampedPct}%`;
    }

    if (this.tubeContainer) {
      this.tubeContainer.setAttribute('aria-valuenow', String(this.masteredCount));
    }

    if (this.progressLabel) {
      this.progressLabel.textContent = `${this.masteredCount} / ${this.totalUniqueWords}`;
    }
  }

  /**
   * Triggers visual & sound feedback for word mastery.
   * Every win feels special (water surge, splash droplets, duck hop).
   * The final win feels awesome (grand golden finale, 360° duck flip, starbursts, triumphant fanfare).
   * @param {boolean} isFinal
   */
  _triggerWinCelebration(isFinal = false) {
    if (typeof document === 'undefined') return;

    const pct = this.totalUniqueWords > 0 ? (this.masteredCount / this.totalUniqueWords) * 100 : 0;
    const clampedPct = Math.min(100, Math.max(0, pct));

    if (isFinal) {
      // THE LAST ONE: Grand Golden Duck Victory
      if (this.progressPillEl) {
        this.progressPillEl.classList.add('is-grand-finale');
      }
      if (this.duckDockEl) {
        this.duckDockEl.classList.remove('is-hopping');
        this.duckDockEl.classList.add('is-victorious');
      }
      if (this.progressLabel) {
        this.progressLabel.classList.add('is-pulsing');
      }

      if (soundEngine && typeof soundEngine.playDuckVictory === 'function') {
        soundEngine.playDuckVictory();
      }

      this._spawnVictoryBurst();
    } else {
      // EVERY WIN: Water surge, splash droplets, joyful duck hop
      if (this.tubeContainer) {
        this.tubeContainer.classList.remove('is-surging');
        void this.tubeContainer.offsetWidth;
        this.tubeContainer.classList.add('is-surging');
        setTimeout(() => {
          if (this.tubeContainer) this.tubeContainer.classList.remove('is-surging');
        }, 650);
      }

      if (this.duckDockEl) {
        this.duckDockEl.classList.remove('is-hopping');
        void this.duckDockEl.offsetWidth;
        this.duckDockEl.classList.add('is-hopping');
        setTimeout(() => {
          if (this.duckDockEl) this.duckDockEl.classList.remove('is-hopping');
        }, 600);
      }

      if (this.progressLabel) {
        this.progressLabel.classList.remove('is-pulsing');
        void this.progressLabel.offsetWidth;
        this.progressLabel.classList.add('is-pulsing');
        setTimeout(() => {
          if (this.progressLabel) this.progressLabel.classList.remove('is-pulsing');
        }, 450);
      }

      if (soundEngine && typeof soundEngine.playWaterSplash === 'function') {
        soundEngine.playWaterSplash();
      }

      this._spawnWaterSplashDroplets(clampedPct);
    }
  }

  /**
   * Spawns splashing water droplets from the advancing foam crest.
   * @param {number} clampedPct
   */
  _spawnWaterSplashDroplets(clampedPct) {
    if (!this.splashAnchorEl || typeof document === 'undefined') return;

    for (let i = 0; i < 6; i++) {
      const drop = document.createElement('span');
      drop.className = 'water-splash-droplet';
      drop.style.left = `${clampedPct}%`;
      drop.style.top = '50%';
      const tx = (this.prng() - 0.5) * 22;
      const ty = -10 - this.prng() * 16;
      drop.style.setProperty('--tx', `${tx.toFixed(1)}px`);
      drop.style.setProperty('--ty', `${ty.toFixed(1)}px`);
      drop.style.animationDelay = `${(i * 0.03).toFixed(2)}s`;
      this.splashAnchorEl.appendChild(drop);
      setTimeout(() => drop.remove(), 700);
    }
  }

  /**
   * Spawns golden starburst & water droplet particles radiating outward for the grand finale.
   */
  _spawnVictoryBurst() {
    if (!this.splashAnchorEl || typeof document === 'undefined') return;

    for (let i = 0; i < 16; i++) {
      const p = document.createElement('span');
      p.className = 'water-splash-droplet';
      p.style.left = '95%';
      p.style.top = '50%';
      if (i % 2 === 0) {
        p.style.background = 'radial-gradient(circle at 35% 30%, #FFFFFF 0%, #FFE072 50%, #F5C842 100%)';
        p.style.boxShadow = '0 0 6px #FFE072';
      }
      const angle = (i / 16) * Math.PI * 2;
      const dist = 18 + this.prng() * 28;
      const tx = Math.cos(angle) * dist;
      const ty = Math.sin(angle) * dist - 8;
      p.style.setProperty('--tx', `${tx.toFixed(1)}px`);
      p.style.setProperty('--ty', `${ty.toFixed(1)}px`);
      p.style.animationDuration = '0.92s';
      this.splashAnchorEl.appendChild(p);
      setTimeout(() => p.remove(), 950);
    }
  }

  _nudgeMascotHappy() {
    if (!this.mascotWrap) return;
    this.mascotWrap.classList.remove('mascot-nod');
    void this.mascotWrap.offsetWidth;
    this.mascotWrap.classList.add('mascot-nod');
  }

  /**
   * @param {string} message
   */
  _celebrateMascot(message) {
    if (this.mascotWrap) {
      this.mascotWrap.classList.remove('mascot-celebrate');
      void this.mascotWrap.offsetWidth;
      this.mascotWrap.classList.add('mascot-celebrate');
    }
    this._showMascotMessage(message, 2300);
  }

  /**
   * @param {string} text
   * @param {number} [durationMs=2200]
   */
  _showMascotMessage(text, durationMs = 2200) {
    if (!this.mascotSpeech) return;
    if (this.mascotHideTimeout) {
      clearTimeout(this.mascotHideTimeout);
    }
    this.mascotSpeech.textContent = text;
    this.mascotSpeech.classList.add('is-visible');
    this.mascotHideTimeout = setTimeout(() => {
      if (this.mascotSpeech) {
        this.mascotSpeech.classList.remove('is-visible');
      }
    }, durationMs);
  }

  _getStageBounds() {
    if (!this.stage) return { width: 360, height: 420 };
    const r = this.stage.getBoundingClientRect();
    return {
      width: r.width || this.stage.clientWidth || 360,
      height: r.height || this.stage.clientHeight || 420
    };
  }

  /**
   * @param {string} str
   */
  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
