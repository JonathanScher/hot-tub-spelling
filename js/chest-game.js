/**
 * Cozy Tub Spelling — "Treasure Chest & Plushie Shelf" Level View Controller (`js/chest-game.js`)
 *
 * Integrates:
 * - Headless state machine & 2D shelf physics (`js/chest-game-core.js`)
 * - 30+ Kawaii Plushie Catalog & SVG Sprite Generator (`js/plushies.js`)
 * - Existing 3-Tier Word Audio Playback / TTS (`js/speech.js`)
 * - Existing Procedural Web Audio Synthesizer (`js/audio.js`)
 * - Existing Spaced Repetition & Trap Error Tracking (`js/srs.js`)
 */

import { soundEngine } from './audio.js';
import { speechEngine } from './speech.js';
import {
  recordTrapError,
  getProfileTrapHistory,
  getActiveProfileId
} from './srs.js';
import {
  renderPlushieSvg,
  getPlushieById,
  loadPlushieShelf,
  savePlushieShelf
} from './plushies.js';
import {
  createChestGameState,
  startChestSessionOnState,
  scrollDialOnState,
  setDialCharOnState,
  validateChestLockOnState,
  advanceToNextChestOnState,
  stepShelfPhysicsOnState,
  dragPlushieOnState,
  releasePlushieOnState,
  autoHopPlushieToShelfOnState,
  isMotorSlip
} from './chest-game-core.js';

export class ChestPlushieGame {
  /**
   * @param {object} [config={}]
   * @param {HTMLElement | null} [config.stage] - Main container for the chest & plushie shelf level
   * @param {HTMLElement | null} [config.progressFill] - HUD progress bar ticks container
   * @param {HTMLElement | null} [config.progressLabel] - HUD progress counter e.g. "2 / 8"
   * @param {(wordStr: string, firstAttemptErrors: number, attemptDetails?: any) => void} [config.onFirstAttemptComplete]
   * @param {(category: string, updatedHistory: any) => void} [config.onTrapError]
   * @param {(summary: any) => void} [config.onSessionComplete]
   * @param {number} [config.seed]
   * @param {import('./prng.js').SeededPRNG | (() => number)} [config.prng]
   */
  constructor(config = {}) {
    this.stage = config.stage || null;
    this.progressFill = config.progressFill || null;
    this.progressLabel = config.progressLabel || null;
    this.tubeContainer = typeof document !== 'undefined' ? document.getElementById('progress-tube') : null;
    this.tubeFillEl = typeof document !== 'undefined' ? document.getElementById('progress-tube-fill') : null;

    this.onFirstAttemptComplete = config.onFirstAttemptComplete || (() => {});
    this.onTrapError = config.onTrapError || null;
    this.onSessionComplete = config.onSessionComplete || (() => {});

    const bounds = this._getStageBounds();
    const initialShelf = loadPlushieShelf();

    this.state = createChestGameState({
      stageWidth: bounds.width,
      stageHeight: bounds.height,
      shelf: initialShelf,
      seed: config.seed,
      prng: config.prng,
      trapHistory: getProfileTrapHistory(),
      autoStart: false
    });

    /** @type {number | null} */
    this.rafId = null;
    this.lastFrameTime = 0;
  }

  get running() {
    return this.state.running;
  }

  get paused() {
    return this.state.paused;
  }

  _getStageBounds() {
    if (this.stage && typeof this.stage.getBoundingClientRect === 'function') {
      const rect = this.stage.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        return { width: rect.width, height: rect.height };
      }
    }
    return { width: 640, height: 480 };
  }

  /**
   * Starts a new Treasure Chest & Plushie Shelf session.
   * @param {Array<any>} sessionWords
   * @param {Array<any>} [allVocabularyWords]
   */
  startSession(sessionWords, allVocabularyWords = sessionWords) {
    this.stop();

    const bounds = this._getStageBounds();
    this.state.stageWidth = bounds.width;
    this.state.stageHeight = bounds.height;
    this.state.trapHistory = getProfileTrapHistory();
    this.state.shelf = loadPlushieShelf();

    if (this.stage) {
      this.stage.hidden = false;
    }

    startChestSessionOnState(this.state, sessionWords, allVocabularyWords);
    speechEngine.prefetchWords(this.state.queue);

    this._renderHUDProgress();
    this._renderScene();

    if (this.state.currentWordObj) {
      speechEngine.speakWord(this.state.currentWordObj);
    }

    this.lastFrameTime = typeof performance !== 'undefined' ? performance.now() : 0;
    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame((ts) => this._loop(ts));
    }
  }

  pause() {
    this.state.paused = true;
  }

  resume() {
    if (!this.state.running) return;
    this.state.paused = false;
    this.lastFrameTime = typeof performance !== 'undefined' ? performance.now() : 0;
  }

  stop() {
    this.state.running = false;
    this.state.paused = false;
    if (this.rafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  abandonSession() {
    this.stop();
    if (this.stage) {
      this.stage.innerHTML = '';
      this.stage.hidden = true;
    }
    if (speechEngine && typeof speechEngine.stopSpeaking === 'function') {
      speechEngine.stopSpeaking();
    }
  }

  /**
   * Replays the current word audio at normal speed via the existing speechEngine.
   */
  replayCurrentWord() {
    if (!this.state.currentWordObj) return;
    speechEngine.speakWord(this.state.currentWordObj);
  }

  /**
   * Scrolls a dial by `deltaSteps` (+1 or -1) and plays the mechanical tick sound when snapped.
   * @param {number} dialIndex
   * @param {number} [deltaSteps=1]
   */
  scrollDial(dialIndex, deltaSteps = 1) {
    const res = scrollDialOnState(this.state, dialIndex, deltaSteps);
    if (res.changed) {
      soundEngine.playDialTick(res.selectedIndex || 0);
      this._updateDialElement(dialIndex);
    } else if (res.locked) {
      soundEngine.playUiTap();
    }
    return res;
  }

  /**
   * Sets a dial directly to a character or option index.
   * @param {number} dialIndex
   * @param {string | number} charOrOptionIndex
   */
  setDialChar(dialIndex, charOrOptionIndex) {
    const res = setDialCharOnState(this.state, dialIndex, charOrOptionIndex);
    if (res.changed) {
      this._updateDialElement(dialIndex);
    }
    return res;
  }

  /**
   * Validates the current chest lock dials (Pin-Locking & Full Unlock).
   */
  validateLock() {
    const wasFirstSessionAttempt =
      this.state.currentWordObj && !this.state.firstAttemptRecorded.has(this.state.currentWordObj.word);
    const wordStr = this.state.currentWordObj ? this.state.currentWordObj.word : '';

    const res = validateChestLockOnState(this.state);
    if (!res.handled) return res;

    // Record trap categories if any wrong letters matched known French traps
    if (Array.isArray(res.trapCategories)) {
      for (const cat of res.trapCategories) {
        const updatedHistory = recordTrapError(cat);
        if (typeof this.onTrapError === 'function') {
          this.onTrapError(cat, updatedHistory);
        }
      }
    }

    // Play tactile pin-lock clunk for newly locked dials
    if (res.newlyLockedIndices.length > 0) {
      res.newlyLockedIndices.forEach((dialIdx, i) => {
        if (i === 0) {
          soundEngine.playPinLockClunk(dialIdx);
        } else {
          setTimeout(() => soundEngine.playPinLockClunk(dialIdx), i * 65);
        }
      });
    }

    // Play dull rattle and shake incorrect dials
    if (res.incorrectIndices.length > 0) {
      soundEngine.playDialRattle();
    }

    this._syncAllDialsAfterValidation(res);

    if (res.unlocked && res.reward) {
      const isGolden = res.reward.variant === 'golden';
      soundEngine.playChestUnlock(isGolden);
      savePlushieShelf(this.state.shelf, getActiveProfileId());

      if (wasFirstSessionAttempt && wordStr) {
        const firstAttemptErrors = res.attempt === 1 ? 0 : this.state.wordErrorCount;
        this.onFirstAttemptComplete(wordStr, firstAttemptErrors, {
          errors: firstAttemptErrors,
          firstAttemptErrors,
          isMotorSlip: isMotorSlip({ errors: firstAttemptErrors, word: wordStr }),
          word: wordStr
        });
      }

      this._renderHUDProgress();
      this._renderUnlockedState(res);
    }

    return res;
  }

  /**
   * Auto-hops the active popped plushie onto the wooden shelf and renders it there.
   */
  autoHopToShelf() {
    if (this.state.activePlushie && !this.state.activePlushie.placedOnShelf) {
      autoHopPlushieToShelfOnState(this.state);
      savePlushieShelf(this.state.shelf, getActiveProfileId());
      soundEngine.playPlushieSqueak(1.08);
    }
    this._renderShelfPlushies();
    this._updateActivePoppedPlushieDOM();
  }

  /**
   * Advances to the next chest in the session (auto-hopping any unplaced plushie onto the shelf).
   */
  nextChest() {
    this.autoHopToShelf();
    const res = advanceToNextChestOnState(this.state);
    savePlushieShelf(this.state.shelf, getActiveProfileId());

    if (res.finished && res.summary) {
      soundEngine.playSessionComplete();
      this.onSessionComplete(res.summary);
      return res;
    }

    this._renderHUDProgress();
    this._renderScene();
    if (this.state.currentWordObj) {
      speechEngine.speakWord(this.state.currentWordObj);
    }
    return res;
  }

  _loop(ts) {
    if (!this.state.running) return;
    const dt = this.lastFrameTime > 0 ? Math.min(0.05, Math.max(0.001, (ts - this.lastFrameTime) / 1000)) : 0.016;
    this.lastFrameTime = ts;

    if (!this.state.paused && this.state.activePlushie && !this.state.activePlushie.placedOnShelf) {
      const wasPlaced = this.state.activePlushie.placedOnShelf;
      stepShelfPhysicsOnState(this.state, dt);
      this._updateActivePoppedPlushieDOM();
      if (!wasPlaced && this.state.activePlushie.placedOnShelf) {
        savePlushieShelf(this.state.shelf, getActiveProfileId());
        soundEngine.playPlushieSqueak(1.05);
        this._renderShelfPlushies();
      }
    }

    if (typeof requestAnimationFrame === 'function' && this.state.running) {
      this.rafId = requestAnimationFrame((nextTs) => this._loop(nextTs));
    }
  }

  _renderHUDProgress() {
    const total = Math.max(1, this.state.totalUniqueWords);
    const done = Math.min(total, this.state.masteredCount);
    const pct = Math.round((done / total) * 100);

    if (this.progressLabel) {
      this.progressLabel.textContent = `${done} / ${total}`;
    }
    if (this.tubeFillEl) {
      this.tubeFillEl.style.width = `${pct}%`;
    }
    if (this.tubeContainer) {
      this.tubeContainer.setAttribute('aria-valuemax', String(total));
      this.tubeContainer.setAttribute('aria-valuenow', String(done));
    }
  }

  _renderScene() {
    if (!this.stage || typeof document === 'undefined') return;

    this.stage.innerHTML = `
      <div class="chest-level-scene">
        <!-- Background Multi-Tier Wooden Plushie Shelves -->
        <div class="plushie-shelf-area" id="plushie-shelf-area" aria-label="Interactive Plushie Collection Shelf">
          <div class="wooden-shelf-tier tier-0" data-tier="0"></div>
          <div class="wooden-shelf-tier tier-1" data-tier="1"></div>
          <div class="wooden-shelf-tier tier-2" data-tier="2"></div>
          <div class="shelf-plushies-container" id="shelf-plushies-container"></div>
        </div>

        <!-- Active Popped-Out Plushie Layer (2D Drag/Flick Physics) -->
        <div class="active-plushie-layer" id="active-plushie-layer"></div>

        <!-- Foreground Treasure Chest & Scrolling Letter Lock -->
        <div class="chest-foreground-zone" id="chest-foreground-zone">
          <div class="chest-particle-burst" id="chest-particle-burst" aria-hidden="true"></div>

          <!-- Illustrated Wooden & Brass Treasure Chest -->
          <div class="treasure-chest-figure" id="treasure-chest-figure" data-open="false">
            ${this._renderChestIllustrationSvg(false)}
          </div>

          <!-- Horizontal Lock Controls Row: [Speaker Replay Left] + [Scrolling Letter Dials] + [Validate Right/Below] -->
          <div class="chest-lock-bar" id="chest-lock-bar">
            <button
              type="button"
              id="btn-chest-replay"
              class="chest-replay-btn action-btn listen-btn"
              aria-label="Listen to the word"
              title="Listen to the word"
            >
              <svg class="btn-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" fill-opacity="0.22" />
                <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                <path d="M18.8 5.8a9 9 0 0 1 0 12.4" />
              </svg>
              <span>Écouter</span>
            </button>

            <div class="chest-dials-row" id="chest-dials-row" role="group" aria-label="Treasure chest letter lock dials"></div>

            <button
              type="button"
              id="btn-chest-validate"
              class="chest-validate-btn primary-pastel-btn"
              aria-label="Validate lock combination"
            >
              <span class="validate-key-icon" aria-hidden="true">🔑</span>
              <span>Déverrouiller</span>
            </button>

            <button
              type="button"
              id="btn-chest-next"
              class="chest-next-btn big-play-btn"
              aria-label="Next Treasure Chest"
              hidden
            >
              <span>Coffre Suivant ➔</span>
            </button>
          </div>
        </div>
      </div>
    `;

    const replayBtn = this.stage.querySelector('#btn-chest-replay');
    if (replayBtn) {
      replayBtn.addEventListener('click', () => {
        soundEngine.playUiTap();
        this.replayCurrentWord();
      });
    }

    const validateBtn = this.stage.querySelector('#btn-chest-validate');
    if (validateBtn) {
      validateBtn.addEventListener('click', () => {
        this.validateLock();
      });
    }

    const nextBtn = this.stage.querySelector('#btn-chest-next');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        soundEngine.playUiTap();
        this.nextChest();
      });
    }

    this._renderDials();
    this._renderShelfPlushies();
  }

  _renderChestIllustrationSvg(isOpen = false) {
    if (isOpen) {
      return `
        <svg class="chest-svg is-open" viewBox="0 0 260 170" xmlns="http://www.w3.org/2000/svg" aria-label="Open treasure chest">
          <!-- Open Lid Tilted Back -->
          <path d="M36 68 C36 26, 224 26, 224 68 Z" fill="#8C583A" stroke="#4A2E1B" stroke-width="4" stroke-linejoin="round" />
          <path d="M48 68 C48 34, 212 34, 212 68" fill="none" stroke="#FAD246" stroke-width="6" />
          <!-- Warm Golden Glow Inside Chest -->
          <ellipse cx="130" cy="78" rx="82" ry="22" fill="#FFF0A5" stroke="#FAD246" stroke-width="3" />
          <!-- Chest Base Box -->
          <rect x="34" y="72" width="192" height="82" rx="10" fill="#8C583A" stroke="#4A2E1B" stroke-width="4" />
          <line x1="36" y1="98" x2="224" y2="98" stroke="#4A2E1B" stroke-width="3" />
          <line x1="36" y1="124" x2="224" y2="124" stroke="#4A2E1B" stroke-width="3" />
          <!-- Brass Corner Straps -->
          <rect x="34" y="72" width="18" height="82" rx="4" fill="#FAD246" stroke="#4A2E1B" stroke-width="3.5" />
          <rect x="208" y="72" width="18" height="82" rx="4" fill="#FAD246" stroke="#4A2E1B" stroke-width="3.5" />
          <!-- Brass Keyhole Escutcheon -->
          <rect x="112" y="66" width="36" height="34" rx="8" fill="#FAD246" stroke="#4A2E1B" stroke-width="3.5" />
          <circle cx="130" cy="80" r="4.5" fill="#4A2E1B" />
          <path d="M127 82 L133 82 L135 92 L125 92 Z" fill="#4A2E1B" />
        </svg>
      `;
    }
    return `
      <svg class="chest-svg is-closed" viewBox="0 0 260 170" xmlns="http://www.w3.org/2000/svg" aria-label="Locked treasure chest">
        <!-- Closed Rounded Wooden Lid -->
        <path d="M32 78 C32 30, 228 30, 228 78 Z" fill="#9E6544" stroke="#4A2E1B" stroke-width="4" stroke-linejoin="round" />
        <path d="M52 78 C52 38, 82 38, 82 78" fill="none" stroke="#FAD246" stroke-width="8" />
        <path d="M178 78 C178 38, 208 38, 208 78" fill="none" stroke="#FAD246" stroke-width="8" />
        <!-- Chest Base Box -->
        <rect x="34" y="78" width="192" height="78" rx="10" fill="#8C583A" stroke="#4A2E1B" stroke-width="4" />
        <line x1="36" y1="104" x2="224" y2="104" stroke="#4A2E1B" stroke-width="3" />
        <line x1="36" y1="130" x2="224" y2="130" stroke="#4A2E1B" stroke-width="3" />
        <!-- Brass Straps -->
        <rect x="34" y="78" width="18" height="78" rx="4" fill="#FAD246" stroke="#4A2E1B" stroke-width="3.5" />
        <rect x="208" y="78" width="18" height="78" rx="4" fill="#FAD246" stroke="#4A2E1B" stroke-width="3.5" />
        <!-- Brass Lock Plate -->
        <rect x="110" y="64" width="40" height="40" rx="9" fill="#FAD246" stroke="#4A2E1B" stroke-width="3.5" />
        <circle cx="130" cy="80" r="5" fill="#4A2E1B" />
        <path d="M126 83 L134 83 L136 95 L124 95 Z" fill="#4A2E1B" />
      </svg>
    `;
  }

  _renderDials() {
    if (!this.stage) return;
    const row = this.stage.querySelector('#chest-dials-row');
    if (!row) return;
    row.innerHTML = '';

    this.state.dials.forEach((dial, idx) => {
      const dialEl = document.createElement('div');
      dialEl.className = `chest-dial${dial.isLocked ? ' is-locked' : ''}`;
      dialEl.dataset.dialIndex = String(idx);
      dialEl.setAttribute('role', 'spinbutton');
      dialEl.setAttribute('aria-label', `Letter dial ${idx + 1}`);
      dialEl.setAttribute('aria-valuetext', dial.currentChar);

      const len = dial.options.length;
      const prevChar = dial.options[(dial.selectedIndex - 1 + len) % len];
      const nextChar = dial.options[(dial.selectedIndex + 1) % len];

      dialEl.innerHTML = `
        <button type="button" class="dial-step-btn dial-up-btn" aria-label="Scroll dial ${idx + 1} up" ${dial.isLocked ? 'disabled' : ''}>▲</button>
        <div class="dial-wheel-window">
          <span class="dial-neighbor-char dial-prev-char" aria-hidden="true">${prevChar}</span>
          <span class="dial-active-char">${dial.currentChar}</span>
          <span class="dial-neighbor-char dial-next-char" aria-hidden="true">${nextChar}</span>
        </div>
        <button type="button" class="dial-step-btn dial-down-btn" aria-label="Scroll dial ${idx + 1} down" ${dial.isLocked ? 'disabled' : ''}>▼</button>
      `;

      const upBtn = dialEl.querySelector('.dial-up-btn');
      const downBtn = dialEl.querySelector('.dial-down-btn');
      const wheelWin = dialEl.querySelector('.dial-wheel-window');

      if (upBtn) {
        upBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.scrollDial(idx, -1);
        });
      }
      if (downBtn) {
        downBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.scrollDial(idx, 1);
        });
      }

      if (wheelWin) {
        wheelWin.addEventListener(
          'wheel',
          (ev) => {
            ev.preventDefault();
            const delta = /** @type {WheelEvent} */ (ev).deltaY > 0 ? 1 : -1;
            this.scrollDial(idx, delta);
          },
          { passive: false }
        );

        let dragStartY = null;
        wheelWin.addEventListener('pointerdown', (ev) => {
          dragStartY = /** @type {PointerEvent} */ (ev).clientY;
        });
        wheelWin.addEventListener('pointerup', (ev) => {
          if (dragStartY === null) return;
          const dy = /** @type {PointerEvent} */ (ev).clientY - dragStartY;
          dragStartY = null;
          if (Math.abs(dy) >= 10) {
            this.scrollDial(idx, dy < 0 ? 1 : -1);
          } else {
            this.scrollDial(idx, 1);
          }
        });
      }

      row.appendChild(dialEl);
    });
  }

  _updateDialElement(dialIndex) {
    if (!this.stage) return;
    const dial = this.state.dials[dialIndex];
    const dialEl = this.stage.querySelector(`.chest-dial[data-dial-index="${dialIndex}"]`);
    if (!dial || !dialEl) return;

    const len = dial.options.length;
    const prevChar = dial.options[(dial.selectedIndex - 1 + len) % len];
    const nextChar = dial.options[(dial.selectedIndex + 1) % len];

    dialEl.classList.toggle('is-locked', dial.isLocked);
    dialEl.setAttribute('aria-valuetext', dial.currentChar);

    const prevSpan = dialEl.querySelector('.dial-prev-char');
    const activeSpan = dialEl.querySelector('.dial-active-char');
    const nextSpan = dialEl.querySelector('.dial-next-char');

    if (prevSpan) prevSpan.textContent = prevChar;
    if (activeSpan) activeSpan.textContent = dial.currentChar;
    if (nextSpan) nextSpan.textContent = nextChar;

    const stepBtns = dialEl.querySelectorAll('.dial-step-btn');
    stepBtns.forEach((btn) => {
      /** @type {HTMLButtonElement} */ (btn).disabled = dial.isLocked;
    });
  }

  _syncAllDialsAfterValidation(res) {
    if (!this.stage) return;
    this.state.dials.forEach((_, idx) => {
      this._updateDialElement(idx);
      const dialEl = /** @type {HTMLElement | null} */ (
        this.stage?.querySelector(`.chest-dial[data-dial-index="${idx}"]`)
      );
      if (!dialEl) return;

      if (res.incorrectIndices.includes(idx)) {
        dialEl.classList.remove('is-rattling');
        void dialEl.offsetWidth;
        dialEl.classList.add('is-rattling');
      } else {
        dialEl.classList.remove('is-rattling');
      }
    });
  }

  _renderUnlockedState(res) {
    if (!this.stage) return;

    const chestFig = this.stage.querySelector('#treasure-chest-figure');
    if (chestFig) {
      chestFig.setAttribute('data-open', 'true');
      chestFig.innerHTML = this._renderChestIllustrationSvg(true);
    }

    const burstLayer = this.stage.querySelector('#chest-particle-burst');
    if (burstLayer) {
      burstLayer.className = `chest-particle-burst is-active is-${res.effect}`;
      const count = res.effect === 'golden-burst' ? 14 : 8;
      burstLayer.innerHTML = Array.from({ length: count })
        .map((_, i) => `<span class="chest-sparkle-particle p-${i}">${i % 2 === 0 ? '✨' : '⭐'}</span>`)
        .join('');
    }

    const validateBtn = /** @type {HTMLButtonElement | null} */ (this.stage.querySelector('#btn-chest-validate'));
    const nextBtn = /** @type {HTMLButtonElement | null} */ (this.stage.querySelector('#btn-chest-next'));
    if (validateBtn) validateBtn.hidden = true;
    if (nextBtn) nextBtn.hidden = false;

    this._mountActivePoppedPlushie();
    this._renderShelfPlushies();
  }

  _mountActivePoppedPlushie() {
    if (!this.stage) return;
    const layer = this.stage.querySelector('#active-plushie-layer');
    if (!layer) return;
    layer.innerHTML = '';

    const body = this.state.activePlushie;
    if (!body) return;

    const item = getPlushieById(body.plushieId);
    const el = document.createElement('div');
    el.className = `active-popped-plushie is-${body.variant}`;
    el.dataset.plushieId = body.plushieId;
    el.dataset.variant = body.variant;
    el.innerHTML = `
      <div class="popped-plushie-card">
        ${renderPlushieSvg(body.plushieId, body.variant)}
        <span class="popped-plushie-badge">${body.variant === 'golden' ? '👑 Peluche Dorée !' : item.name}</span>
      </div>
    `;

    let lastPtrX = 0;
    let lastPtrY = 0;
    let vx = 0;
    let vy = 0;

    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      lastPtrX = ev.clientX;
      lastPtrY = ev.clientY;
      dragPlushieOnState(this.state, body.x, body.y);
      soundEngine.playPlushieSqueak(1.0);
    });

    if (typeof window !== 'undefined') {
      const onMove = (ev) => {
        if (!this.state.activePlushie || !this.state.activePlushie.isDragging) return;
        const dx = ev.clientX - lastPtrX;
        const dy = ev.clientY - lastPtrY;
        vx = dx * 18;
        vy = dy * 18;
        lastPtrX = ev.clientX;
        lastPtrY = ev.clientY;
        dragPlushieOnState(this.state, this.state.activePlushie.x + dx, this.state.activePlushie.y + dy);
        this._updateActivePoppedPlushieDOM();
      };
      const onUp = () => {
        if (!this.state.activePlushie || !this.state.activePlushie.isDragging) return;
        releasePlushieOnState(this.state, vx, vy);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }

    layer.appendChild(el);
    this._updateActivePoppedPlushieDOM();
  }

  _updateActivePoppedPlushieDOM() {
    if (!this.stage) return;
    const el = /** @type {HTMLElement | null} */ (this.stage.querySelector('.active-popped-plushie'));
    const body = this.state.activePlushie;
    if (!el || !body) return;

    if (body.placedOnShelf) {
      el.hidden = true;
    } else {
      el.hidden = false;
      el.style.transform = `translate3d(${Math.round(body.x)}px, ${Math.round(body.y)}px, 0) translate(-50%, -50%)`;
    }
  }

  _renderShelfPlushies() {
    if (!this.stage) return;
    const container = this.stage.querySelector('#shelf-plushies-container');
    if (!container) return;
    container.innerHTML = '';

    this.state.shelf.forEach((entry, idx) => {
      const item = getPlushieById(entry.plushieId);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `shelf-plushie-item is-${entry.variant}`;
      btn.dataset.plushieId = entry.plushieId;
      btn.dataset.variant = entry.variant;
      btn.title = `${item.name} (${entry.variant === 'golden' ? 'Doré ✨' : 'Standard'})`;
      btn.setAttribute('aria-label', `${item.name} (${entry.variant})`);

      if (typeof entry.x === 'number' && typeof entry.y === 'number') {
        btn.style.left = `${Math.round(entry.x)}px`;
        btn.style.top = `${Math.round(entry.y)}px`;
      }

      btn.innerHTML = renderPlushieSvg(entry.plushieId, entry.variant);

      btn.addEventListener('click', () => {
        const pitch = 0.9 + (idx % 5) * 0.06;
        soundEngine.playPlushieSqueak(pitch);
        btn.classList.remove('is-squishing');
        void btn.offsetWidth;
        btn.classList.add('is-squishing');
      });

      container.appendChild(btn);
    });
  }
}
