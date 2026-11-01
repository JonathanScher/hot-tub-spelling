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
 */

import { soundEngine } from './audio.js';
import { speechEngine } from './speech.js';
import { getPlausibleDistractors } from './srs.js';

const MIN_BUBBLES = 5;
const MAX_BUBBLES = 7;
const SPAWN_INTERVAL_SEC = 0.78;

const CHEER_MESSAGES_PERFECT = [
  'Splash-tastic!',
  'Pure magic!',
  'So cozy & clever!',
  'Wonderful spelling!',
  'Bubble master!',
  'Spotless!'
];

const CHEER_MESSAGES_PRACTICE = [
  'Nice job! We’ll splash it once more soon!',
  'You built it! Let’s try again later!',
  'Great effort! Saved for one more round!'
];

export class HotTubGame {
  /**
   * @param {object} config
   * @param {HTMLElement} config.bubbleStage - Container where bubbles float upward
   * @param {HTMLElement} config.slotsContainer - Wooden signboard container for word letter slots
   * @param {HTMLElement} config.flyingLayer - Overlay layer for flying popped letters & particles
   * @param {HTMLElement} config.mascotWrap - Bath companion mascot element
   * @param {HTMLElement} config.mascotSpeech - Mascot speech bubble element
   * @param {HTMLElement} config.hintButton - Hint button element
   * @param {HTMLElement} config.progressFill - Progress bar / pebbles container
   * @param {HTMLElement} config.progressLabel - Text label e.g. "3 / 8"
   * @param {HTMLElement} config.retryBadge - Subtle badge shown when revisiting a word in-session
   * @param {Function} config.onFirstAttemptComplete - (wordStr, firstAttemptErrors) => void
   * @param {Function} config.onSessionComplete - (summary) => void
   */
  constructor(config) {
    this.stage = config.bubbleStage;
    this.slotsContainer = config.slotsContainer;
    this.flyingLayer = config.flyingLayer;
    this.mascotWrap = config.mascotWrap;
    this.mascotSpeech = config.mascotSpeech;
    this.hintButton = config.hintButton;
    this.progressFill = config.progressFill;
    this.progressLabel = config.progressLabel;
    this.retryBadge = config.retryBadge;

    this.onFirstAttemptComplete = config.onFirstAttemptComplete || (() => {});
    this.onSessionComplete = config.onSessionComplete || (() => {});

    this.allVocabWords = [];
    this.queue = [];
    this.totalUniqueWords = 0;
    this.masteredCount = 0;
    this.firstAttemptRecorded = new Set();
    this.sessionResults = [];

    this.currentWordObj = null;
    this.targetChars = [];
    this.currentIndex = 0;
    this.wordErrorCount = 0;
    this.letterErrorCount = 0;
    this.watermarkActive = false;
    this.wordTransitioning = false;
    this.running = false;
    this.paused = false;

    this.bubbles = [];
    this.nextBubbleId = 1;
    this.spawnCounter = 0;
    this.spawnTimer = 0;
    this.lastFrameTime = 0;
    this.rafId = null;
    this.nextWordTimeout = null;
    this.mascotHideTimeout = null;
    this.bubbleImgAvailable = true;

    this._onResize = () => this._clampBubblesToStage();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this._onResize);
    }

    this._checkBubbleSprite();
  }

  _clampBubblesToStage() {
    if (!this.stage || this.bubbles.length === 0) return;
    const rect = this._getStageBounds();
    if (rect.width < 40) return;
    for (const b of this.bubbles) {
      const minX = b.radius + b.wobbleAmp + 8;
      const maxX = Math.max(minX + 4, rect.width - b.radius - b.wobbleAmp - 8);
      if (b.baseX > maxX || b.baseX < minX) {
        b.baseX = minX + Math.random() * (maxX - minX);
        b.x = b.baseX;
        this._positionBubbleElement(b);
      }
    }
  }

  _checkBubbleSprite() {
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
   * @param {Array<object>} sessionWords
   * @param {Array<object>} allVocabularyWords
   */
  startSession(sessionWords, allVocabularyWords = sessionWords) {
    this.stop();

    this.allVocabWords = Array.isArray(allVocabularyWords) ? allVocabularyWords : sessionWords;
    this.queue = sessionWords.map((w) => ({ ...w, isRetry: false }));
    this.totalUniqueWords = this.queue.length;
    this.masteredCount = 0;
    this.firstAttemptRecorded.clear();
    this.sessionResults = [];

    this.running = true;
    this.paused = false;
    this._renderProgressPebbles();

    speechEngine.prefetchWords(this.queue);

    this._startNextWord();
    this.lastFrameTime = performance.now();
    this.rafId = requestAnimationFrame((ts) => this._loop(ts));
  }

  pause() {
    this.paused = true;
  }

  resume() {
    if (!this.running) return;
    this.paused = false;
    this.lastFrameTime = performance.now();
  }

  stop() {
    this.running = false;
    this.paused = false;
    if (this.rafId) {
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
    if (!this.running || this.wordTransitioning || !this.currentWordObj) return;

    if (!this.watermarkActive) {
      this.wordErrorCount += 1;
      soundEngine.playHintWhisper();
      this._activateWatermark();
      this._showMascotMessage('Follow the faint letters in order!', 2400);
    } else {
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
    this.currentWordObj = this.queue.shift();
    // Use Array.from to split cleanly by Unicode code point while keeping lowercase accents intact
    this.targetChars = Array.from(String(this.currentWordObj.word || '').trim().toLowerCase());
    this.currentIndex = 0;
    this.wordErrorCount = 0;
    this.letterErrorCount = 0;
    this.watermarkActive = false;
    this.wordTransitioning = false;
    this.spawnCounter = 0;
    this.spawnTimer = 0;

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

    // Automatically pronounce the English word out loud at the start of each word
    speechEngine.speakWord(this.currentWordObj);
  }

  _renderWordSlots() {
    if (!this.slotsContainer) return;
    this.slotsContainer.innerHTML = '';

    const count = this.targetChars.length;
    this.slotsContainer.style.setProperty('--word-len', String(count));
    this.slotsContainer.classList.toggle('is-long-word', count >= 8);
    this.slotsContainer.classList.toggle('is-very-long-word', count >= 10);

    this.targetChars.forEach((ch, idx) => {
      const slot = document.createElement('div');
      slot.className = 'letter-slot';
      if (idx === 0) slot.classList.add('is-current');
      slot.dataset.index = String(idx);
      slot.dataset.targetChar = ch;

      const watermarkSpan = document.createElement('span');
      watermarkSpan.className = 'slot-watermark';
      watermarkSpan.textContent = ch;
      watermarkSpan.setAttribute('aria-hidden', 'true');

      const filledSpan = document.createElement('span');
      filledSpan.className = 'slot-letter';
      filledSpan.textContent = '';

      const underline = document.createElement('span');
      underline.className = 'slot-underline';

      slot.appendChild(watermarkSpan);
      slot.appendChild(filledSpan);
      slot.appendChild(underline);
      this.slotsContainer.appendChild(slot);
    });
  }

  _updateSlotStates() {
    if (!this.slotsContainer) return;
    const slots = this.slotsContainer.querySelectorAll('.letter-slot');
    slots.forEach((slot, idx) => {
      const isFilled = idx < this.currentIndex;
      const isCurrent = idx === this.currentIndex && !this.wordTransitioning;
      slot.classList.toggle('is-filled', isFilled);
      slot.classList.toggle('is-current', isCurrent);
      slot.classList.toggle('show-watermark', this.watermarkActive && !isFilled);
    });
  }

  _activateWatermark() {
    this.watermarkActive = true;
    if (this.hintButton) {
      this.hintButton.classList.add('is-active');
      this.hintButton.setAttribute('aria-pressed', 'true');
    }
    this._updateSlotStates();
  }

  _pulseEmptyWatermarkSlots() {
    if (!this.slotsContainer) return;
    const emptySlots = this.slotsContainer.querySelectorAll('.letter-slot.show-watermark');
    emptySlots.forEach((el) => {
      el.classList.remove('watermark-pulse');
      void el.offsetWidth;
      el.classList.add('watermark-pulse');
    });
  }

  /**
   * Spawns 5 initial bubbles gently staggered across the lower tub so the player
   * immediately sees 5-7 rising bubbles without waiting on an empty screen.
   */
  _spawnInitialWave() {
    const rect = this._getStageBounds();
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
    this.spawnCounter += 1;
    const requiredChar = this.targetChars[this.currentIndex];
    if (!requiredChar) return 'a';

    // Rule 1: Every 3rd bubble MUST be the exact next required letter
    if (this.spawnCounter % 3 === 0) {
      return requiredChar;
    }

    // Rule 2: 30% of remaining bubbles are future letters from the current word
    const futureChars = this.targetChars.slice(this.currentIndex + 1);
    if (futureChars.length > 0 && Math.random() < 0.30) {
      return futureChars[Math.floor(Math.random() * futureChars.length)];
    }

    // Rule 3: 70% of remaining bubbles are plausible distractor letters
    const distractors = getPlausibleDistractors(
      requiredChar,
      this.currentWordObj ? this.currentWordObj.word : '',
      this.allVocabWords
    );
    if (distractors.length > 0) {
      return distractors[Math.floor(Math.random() * distractors.length)];
    }

    return requiredChar === 'e' ? 'a' : 'e';
  }

  _spawnBubble(overrideY = null) {
    if (!this.stage || this.wordTransitioning || this.currentIndex >= this.targetChars.length) {
      return;
    }

    const rect = this._getStageBounds();
    if (rect.width < 40 || rect.height < 40) return;

    const diameter = this._computeBubbleDiameter(rect);
    const radius = diameter / 2;
    const wobbleAmp = Math.min(22, Math.max(10, rect.width * 0.028));
    const safeMinX = radius + wobbleAmp + 10;
    const safeMaxX = Math.max(safeMinX + 10, rect.width - radius - wobbleAmp - 10);

    const startY = overrideY !== null ? overrideY : rect.height + radius * 0.55;
    const baseX = this._pickNonOverlappingX(safeMinX, safeMaxX, startY, diameter);
    const char = this._chooseNextBubbleChar();

    // Calm, relaxing upward speed (~7.8 to 9.8 seconds to cross full arena height)
    const traverseSeconds = 7.8 + Math.random() * 2.0;
    const speedY = (rect.height + diameter) / traverseSeconds;
    const wobbleFreq = 1.35 + Math.random() * 0.75;
    const phase = Math.random() * Math.PI * 2;

    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'soap-bubble';
    if (!this.bubbleImgAvailable) {
      el.classList.add('use-svg-fallback');
    }
    el.style.width = `${diameter}px`;
    el.style.height = `${diameter}px`;
    el.setAttribute('aria-label', `Letter ${char}`);

    const innerHtml = `
      <span class="bubble-art" aria-hidden="true"></span>
      <span class="bubble-char">${this._escapeHtml(char)}</span>
    `;
    el.innerHTML = innerHtml;

    const bubbleObj = {
      id: this.nextBubbleId++,
      char,
      el,
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
      state: 'floating' // 'floating' | 'popping' | 'fizzling'
    };

    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this._handleBubbleTap(bubbleObj);
    });

    this._positionBubbleElement(bubbleObj);
    this.stage.appendChild(el);
    this.bubbles.push(bubbleObj);
  }

  _pickNonOverlappingX(minX, maxX, spawnY, diameter) {
    const candidates = 7;
    let bestX = minX + Math.random() * (maxX - minX);
    let bestMinDist = -1;

    for (let i = 0; i < candidates; i++) {
      const candidateX = minX + ((i + Math.random() * 0.85) / candidates) * (maxX - minX);
      let nearest = Infinity;
      for (const b of this.bubbles) {
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

  _computeBubbleDiameter(stageRect) {
    const shortest = Math.min(stageRect.width, stageRect.height);
    return Math.round(Math.min(98, Math.max(66, shortest * 0.165)));
  }

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

  _onCorrectBubbleTap(bubble) {
    bubble.state = 'popping';
    const matchedSlotIndex = this.currentIndex;
    const matchedChar = bubble.char;

    soundEngine.playBubblePop(matchedSlotIndex);
    this._spawnPopDroplets(bubble.x, bubble.y, bubble.diameter);

    bubble.el.classList.add('is-popping');
    setTimeout(() => this._removeBubble(bubble), 220);

    // Advance state immediately so fast sequential taps feel crisp and responsive
    this.currentIndex += 1;
    this.letterErrorCount = 0;

    // Ensure next 3rd spawn cycle delivers the new required letter promptly if not already floating
    const nextRequired = this.targetChars[this.currentIndex];
    if (nextRequired && !this.bubbles.some((b) => b.state === 'floating' && b.char === nextRequired)) {
      this.spawnCounter = 2; // Next spawned bubble will be spawnCounter 3 (3 % 3 === 0 -> exact next required letter!)
    }

    this._animateFlyingLetterToSlot(bubble, matchedSlotIndex, matchedChar);
    this._nudgeMascotHappy();

    if (this.currentIndex >= this.targetChars.length) {
      this.wordTransitioning = true;
      this._updateSlotStates();
      setTimeout(() => this._completeCurrentWord(), 340);
    } else {
      this._updateSlotStates();
    }
  }

  _onWrongBubbleTap(bubble) {
    bubble.state = 'fizzling';
    soundEngine.playWrongFizzle();

    this.wordErrorCount += 1;
    this.letterErrorCount += 1;

    bubble.el.classList.add('is-wrong-fizzle');
    setTimeout(() => this._removeBubble(bubble), 460);

    // Gentle wobble feedback on current target slot
    if (this.slotsContainer) {
      const currentSlot = this.slotsContainer.querySelector(`.letter-slot[data-index="${this.currentIndex}"]`);
      if (currentSlot) {
        currentSlot.classList.remove('slot-gentle-shake');
        void currentSlot.offsetWidth;
        currentSlot.classList.add('slot-gentle-shake');
      }
    }

    // Trigger watermark scaffolding automatically after 2 mistakes on the current letter
    if (this.letterErrorCount >= 2 && !this.watermarkActive) {
      soundEngine.playHintWhisper();
      this._activateWatermark();
      this._showMascotMessage('Here is a gentle hint in the slots!', 2400);
    }
  }

  _animateFlyingLetterToSlot(bubble, slotIndex, char) {
    const slotEl = this.slotsContainer
      ? this.slotsContainer.querySelector(`.letter-slot[data-index="${slotIndex}"]`)
      : null;

    if (!slotEl || !this.flyingLayer) {
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

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        flyer.style.transform = `translate3d(${endX}px, ${endY}px, 0) translate(-50%, -50%) scale(0.95)`;
        flyer.style.opacity = '0.92';
      });
    });

    setTimeout(() => {
      flyer.remove();
      this._fillSlotText(slotIndex, char);
    }, 300);
  }

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

  _spawnPopDroplets(cx, cy, diameter) {
    if (!this.stage) return;
    const count = 7;
    const colors = ['#BCE0F2', '#F6B8AD', '#D8CEE8', '#FFF6E6', '#B8DEC8'];

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const dist = diameter * (0.45 + Math.random() * 0.35);
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
        b.el.classList.add('is-gentle-fade');
        setTimeout(() => this._removeBubble(b), 350);
      }
    }

    // 1. Long-term Leitner SRS progression is determined strictly by the FIRST attempt in the session
    if (isFirstAttempt) {
      this.firstAttemptRecorded.add(wordStr);
      this.sessionResults.push({
        word: wordStr,
        firstAttemptErrors: errorsThisRound,
        masteredFirstTry: errorsThisRound === 0
      });
      this.onFirstAttemptComplete(wordStr, errorsThisRound);
    }

    // 2. Zero-Error Mastery check & In-Session Retry re-queueing
    if (errorsThisRound === 0) {
      this.masteredCount += 1;
      this._updateProgressPebbles();
    } else {
      // Re-queue word at the end of the current session until spelled with zero errors
      this.queue.push({
        ...this.currentWordObj,
        isRetry: true
      });
    }

    // 3. Celebration feedback: warm chime arpeggio, mascot celebration, and pronounce word again
    soundEngine.playWordComplete();
    if (this.slotsContainer) {
      this.slotsContainer.classList.add('word-celebrating');
    }

    const cheerList = errorsThisRound === 0 ? CHEER_MESSAGES_PERFECT : CHEER_MESSAGES_PRACTICE;
    const msg = cheerList[Math.floor(Math.random() * cheerList.length)];
    this._celebrateMascot(msg);

    // Pronounce the full word again and pause for 2 seconds before moving to the next word
    const minPausePromise = new Promise((resolve) => {
      this.nextWordTimeout = setTimeout(resolve, 2000);
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
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this._clearAllBubbles();
    soundEngine.playSessionComplete();

    const firstTryPerfect = this.sessionResults.filter((r) => r.masteredFirstTry).length;
    this.onSessionComplete({
      totalWords: this.totalUniqueWords,
      firstTryPerfect,
      results: this.sessionResults
    });
  }

  _loop(timestamp) {
    if (!this.running) return;

    const rawDt = (timestamp - this.lastFrameTime) / 1000;
    this.lastFrameTime = timestamp;
    const dt = Math.min(0.05, Math.max(0, rawDt));

    if (!this.paused && !this.wordTransitioning) {
      this._updateBubbles(dt);
      this._maintainBubblePopulation(dt);
    }

    this.rafId = requestAnimationFrame((ts) => this._loop(ts));
  }

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
        b.el.classList.add('is-top-fading');
        this._positionBubbleElement(b);
      } else {
        this._positionBubbleElement(b);
      }
    }

    for (const expired of toRemove) {
      this._removeBubble(expired);
    }
  }

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

  _positionBubbleElement(b) {
    const left = b.x - b.radius;
    const top = b.y - b.radius;
    b.el.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
  }

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
    if (this.progressFill) {
      this.progressFill.innerHTML = '';
      for (let i = 0; i < this.totalUniqueWords; i++) {
        const dot = document.createElement('span');
        dot.className = 'progress-pebble';
        this.progressFill.appendChild(dot);
      }
    }
    this._updateProgressPebbles();
  }

  _updateProgressPebbles() {
    if (this.progressFill) {
      const pebbles = this.progressFill.querySelectorAll('.progress-pebble');
      pebbles.forEach((p, idx) => {
        p.classList.toggle('is-complete', idx < this.masteredCount);
      });
    }
    if (this.progressLabel) {
      this.progressLabel.textContent = `${this.masteredCount} / ${this.totalUniqueWords}`;
    }
  }

  _nudgeMascotHappy() {
    if (!this.mascotWrap) return;
    this.mascotWrap.classList.remove('mascot-nod');
    void this.mascotWrap.offsetWidth;
    this.mascotWrap.classList.add('mascot-nod');
  }

  _celebrateMascot(message) {
    if (this.mascotWrap) {
      this.mascotWrap.classList.remove('mascot-celebrate');
      void this.mascotWrap.offsetWidth;
      this.mascotWrap.classList.add('mascot-celebrate');
    }
    this._showMascotMessage(message, 2300);
  }

  _showMascotMessage(text, durationMs = 2200) {
    if (!this.mascotSpeech) return;
    if (this.mascotHideTimeout) {
      clearTimeout(this.mascotHideTimeout);
    }
    this.mascotSpeech.textContent = text;
    this.mascotSpeech.classList.add('is-visible');
    this.mascotHideTimeout = setTimeout(() => {
      this.mascotSpeech.classList.remove('is-visible');
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

  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
