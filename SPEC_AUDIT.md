# Codebase Audit & Decoupling Blueprint (`SPEC_AUDIT.md`)

## Overview
**Cozy Tub Spelling** is a browser-based French & English vocabulary and sequential bubble-popping spelling game built with vanilla ES6 modules (`js/game.js`, `js/srs.js`, `js/app.js`, `js/audio.js`, `js/speech.js`, `js/auth.js`, `js/sync.js`, `js/firebase-config.js`).

This audit catalogs the complete runtime state tree, maps all side-effect and browser couplings, extracts the exact domain mechanics (including subtle edge cases and quirks), and defines the minimal refactoring plan to extract a pure, deterministic `createGameState(config)` factory and `stepGame(state, input, dt)` transition system for headless Node.js characterization testing.

---

## 1. State Tree Inventory

### 1.1 Core Gameplay Session & Word State (`HotTubGame` in [`js/game.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/game.js))
| Property | Type | Initial / Default | Description |
| :--- | :--- | :--- | :--- |
| `allVocabWords` | `Array<WordRecord>` | `[]` | Full vocabulary pool used to compute plausible distractor letters and detect accented vocabularies. |
| `queue` | `Array<SessionWordItem>` | `[]` | Ordered queue of remaining words in the current session (`{ ...wordRecord, isRetry: boolean }`). |
| `totalUniqueWords` | `number` | `0` | Initial length of `queue` at session start (target mastery count, typically 8–10). |
| `masteredCount` | `number` | `0` | Count of words spelled with `wordErrorCount === 0` during the session. |
| `firstAttemptRecorded` | `Set<string>` | `new Set()` | Set of normalized word strings whose first-attempt SRS outcome has already been recorded in the session. |
| `sessionResults` | `Array<SessionResult>` | `[]` | First-attempt outcomes per unique word: `{ word: string, firstAttemptErrors: number, masteredFirstTry: boolean }`. |
| `currentWordObj` | `SessionWordItem \| null` | `null` | Currently active word object shifted from `queue`. |
| `targetChars` | `Array<string>` | `[]` | Unicode code-point array (`Array.from(word.trim().toLowerCase())`) of the current target word. |
| `currentIndex` | `number` | `0` | Index of the next required character in `targetChars` (`0 <= currentIndex <= targetChars.length`). |
| `wordErrorCount` | `number` | `0` | Total errors accumulated on the active word attempt (wrong bubble taps + first Hint activation). |
| `letterErrorCount` | `number` | `0` | Consecutive wrong bubble taps on the current character index (`currentIndex`). Resets to `0` on correct tap. |
| `watermarkActive` | `boolean` | `false` | Whether the faint watermark scaffolding is currently revealed in empty slots for the active word. |
| `wordTransitioning` | `boolean` | `false` | True after the final letter of a word is popped while celebrating/waiting to advance to the next word. |
| `running` | `boolean` | `false` | True while a game session is active (`startSession` through `_finishSession` or `stop`). |
| `paused` | `boolean` | `false` | True when paused (e.g., Parent Math Gate or Parent Dashboard open). Halts bubble movement, spawning, and taps. |
| `bubbles` | `Array<BubbleEntity>` | `[]` | Active bubble entities currently in the arena. |
| `nextBubbleId` | `number` | `1` | Monotonically increasing integer ID assigned to each spawned bubble. |
| `spawnCounter` | `number` | `0` | Counts spawns for the active word (`spawnCounter % 3 === 0` forces `targetChars[currentIndex]`). |
| `spawnTimer` | `number` | `0` | Accumulated seconds since the last bubble spawn in `_maintainBubblePopulation`. |
| `lastFrameTime` | `number` | `0` | Last `performance.now()` timestamp (ms) used to compute frame `dt`. |
| `rafId` | `number \| null` | `null` | Browser `requestAnimationFrame` handle. |
| `nextWordTimeout` | `Timeout \| null` | `null` | Timer handle for the 2000ms post-word celebration pause. |
| `mascotHideTimeout` | `Timeout \| null` | `null` | Timer handle for hiding the mascot speech bubble. |
| `bubbleImgAvailable` | `boolean` | `true` | Whether `assets/bubble.webp` loaded successfully. |

### 1.2 Bubble Entity State (`bubbleObj` in [`js/game.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/game.js#L406-L421))
| Property | Type | Description |
| :--- | :--- | :--- |
| `id` | `number` | Unique sequential bubble ID (`this.nextBubbleId++`). |
| `char` | `string` | Single lowercase character (may include French accents such as `â`, `é`, `è`, `ê`, `ç`). |
| `el` | `HTMLButtonElement` | Coupled DOM `<button class="soap-bubble">` element. |
| `baseX` | `number` | Horizontal center anchor (`px`) around which sinusoidal wobble oscillates. |
| `x` | `number` | Current horizontal center position (`px`): `baseX + Math.sin(age * wobbleFreq + phase) * wobbleAmp`. |
| `y` | `number` | Current vertical center position (`px`), decreasing by `speedY * dt` each frame. |
| `diameter` | `number` | Bubble diameter (`px`), clamped to `[66, 98]` via `Math.round(Math.min(98, Math.max(66, shortest * 0.165)))`. |
| `radius` | `number` | `diameter / 2`. |
| `speedY` | `number` | Upward velocity (`px/sec`): `(stageHeight + diameter) / traverseSeconds`, where `traverseSeconds` $\in [7.8, 9.8)$. |
| `wobbleAmp` | `number` | Horizontal oscillation amplitude (`px`): `Math.min(22, Math.max(10, stageWidth * 0.028))`. |
| `wobbleFreq` | `number` | Angular frequency (`rad/sec`): `1.35 + prng() * 0.75` $\in [1.35, 2.10)$. |
| `phase` | `number` | Initial phase offset (`rad`): `prng() * Math.PI * 2` $\in [0, 2\pi)$. |
| `age` | `number` | Accumulated lifetime in seconds (`age += dt` while `state === 'floating'`). |
| `state` | `'floating' \| 'popping' \| 'fizzling'` | Lifecycle phase of the bubble. Only `'floating'` bubbles move, count toward population, or accept taps. |

### 1.3 Spaced Repetition System (SRS) & Vocabulary State ([`js/srs.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/srs.js))
| Property | Type | Storage Location | Description |
| :--- | :--- | :--- | :--- |
| `word` | `string` | `localStorage['hottub_srs_words_v2']` | Normalized lowercase word string (whitespace stripped). |
| `week_label` | `string` | `localStorage['hottub_srs_words_v2']` | Week grouping label (e.g., `'Week 7'`, `'Week 8'`). |
| `active` | `boolean` | `localStorage['hottub_srs_words_v2']` | Whether the word is active in rotation (`true` by default). |
| `box` | `number` | `localStorage['hottub_srs_words_v2']` | Leitner Box level clamped to integer `[1, 5]`. |
| `next_review` | `string` | `localStorage['hottub_srs_words_v2']` | Local ISO date string `YYYY-MM-DD` when word is next due. |
| `streak` | `number` | `localStorage['hottub_srs_words_v2']` | Consecutive spotless first-attempt sessions (`>= 0`). |
| `total_attempts` | `number` | `localStorage['hottub_srs_words_v2']` | Total sessions where this word was attempted (`>= 0`). |
| `correct_attempts` | `number` | `localStorage['hottub_srs_words_v2']` | Total spotless first-attempt sessions (`0 <= correct_attempts <= total_attempts`). |
| `custom_audio_url` | `string` | `localStorage['hottub_srs_words_v2']` | Optional URL for Tier-1 custom pronunciation audio. |
| `currentWeekLabel` | `string` | `localStorage['hottub_current_week_label_v2']` | Active week label string (defaults to `'Week 8'` or highest `Week N`). |

### 1.4 Auxiliary Module & UI Controller State
- **UI Controller ([`js/app.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/app.js)):** `toastTimer`, `holdStartTs`, `holdRaf`, `holdTriggered`, `expectedMathSum` (parent lock math challenge `a + b` where $a \in [6, 13]$, $b \in [5, 13]$).
- **Audio Synthesizer ([`js/audio.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/audio.js)):** `soundEngine.ctx` (`AudioContext`), `masterGain`, `noiseBuffer`, `unlocked`.
- **Speech Engine ([`js/speech.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/speech.js)):** `mp3Cache` (`Map`), `inflightLookups` (`Map`), `player` (`HTMLAudioElement`), `activeToken` (monotonic counter), `voices` (`Array`), `speakingListeners` (`Set`).
- **Auth & Sync ([`js/auth.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/auth.js), [`js/sync.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/sync.js)):** `authManager.session` (`localStorage['hottub_firebase_auth_session_v1']`), extra emails (`localStorage['hottub_extra_allowed_emails_v1']`), `syncManager.syncing`, dirty SRS map (`localStorage['hottub_dirty_srs_queue_v2']`), pending weekly batches (`localStorage['hottub_pending_weekly_batches_v2']`).

---

## 2. Side-Effect & Coupling Map

### 2.1 [`js/game.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/game.js)
| Lines | Coupling Type | Details |
| :--- | :--- | :--- |
| L15–16 | Audio / Speech | Direct module imports of singleton `soundEngine` (`./audio.js`) and `speechEngine` (`./speech.js`), which instantiate browser globals (`localStorage`, `Audio`, `window.speechSynthesis`) at import time. |
| L95–97 | DOM / Window | `window.addEventListener('resize', this._onResize)` in constructor. |
| L102–115 | DOM / `Math.random()` | `_clampBubblesToStage()` reads `this._getStageBounds()`, uses `Math.random()` (L110) to re-pick `baseX`, and mutates `b.el.style.transform`. |
| L117–126 | Browser `Image` | `_checkBubbleSprite()` calls `new Image()` unconditionally in constructor (throws `ReferenceError: Image is not defined` in pure Node.js). |
| L147 | Speech / Network | `speechEngine.prefetchWords(this.queue)` inside `startSession()`. |
| L150–151 | Browser Timers | `performance.now()` and `requestAnimationFrame((ts) => this._loop(ts))` in `startSession()`. |
| L161 | Browser Timers | `performance.now()` in `resume()`. |
| L167–182 | Browser Timers & DOM | `cancelAnimationFrame(this.rafId)`, `clearTimeout(this.nextWordTimeout)`, `clearTimeout(this.mascotHideTimeout)`, and `this.flyingLayer.innerHTML = ''` in `stop()`. |
| L190 | Speech | `speechEngine.speakWord(this.currentWordObj)` in `replayCurrentWord()`. |
| L202–208 | Audio & DOM | `soundEngine.playHintWhisper()`, `soundEngine.playUiTap()`, DOM class/attribute mutations in `useHintButton()`. |
| L232–250 | DOM & Speech | `_startNextWord()` mutates `hintButton`, `retryBadge`, calls `_renderWordSlots()`, and calls `speechEngine.speakWord(this.currentWordObj)`. |
| L253–317 | DOM Manipulation | `_renderWordSlots()`, `_updateSlotStates()`, `_activateWatermark()`, `_pulseEmptyWatermarkSlots()` create and mutate DOM elements (`document.createElement`, `querySelectorAll`, `offsetWidth` reflow). |
| L349–361 | `Math.random()` | `_chooseNextBubbleChar()` uses `Math.random()` for the 30% future-char roll (L349), random future char index (L350), and random distractor index (L360). |
| L385–388 | `Math.random()` | `_spawnBubble()` uses `Math.random()` for `traverseSeconds` (L385), `wobbleFreq` (L387), and `phase` (L388). |
| L390–430 | DOM Manipulation | `_spawnBubble()` calls `document.createElement('button')`, attaches `pointerdown` listener, and appends to `this.stage`. |
| L436, L440 | `Math.random()` | `_pickNonOverlappingX()` uses `Math.random()` for initial `bestX` (L436) and stratified candidate offset (L440). |
| L491–495 | Audio, DOM, Timers | `_onCorrectBubbleTap()` calls `soundEngine.playBubblePop()`, `_spawnPopDroplets()`, mutates `bubble.el.classList`, and schedules `setTimeout(() => this._removeBubble(bubble), 220)`. |
| L507–516 | DOM & Timers | `_onCorrectBubbleTap()` calls `_animateFlyingLetterToSlot()`, `_nudgeMascotHappy()`, and when word completes, schedules `setTimeout(() => this._completeCurrentWord(), 340)`. |
| L521, L526–544 | Audio, DOM, Timers | `_onWrongBubbleTap()` calls `soundEngine.playWrongFizzle()`, mutates `bubble.el.classList`, schedules `setTimeout(() => this._removeBubble(bubble), 460)`, triggers slot shake DOM reflow, and calls `soundEngine.playHintWhisper()`. |
| L547–621 | DOM, Timers, `Math.random()` | `_animateFlyingLetterToSlot()`, `_fillSlotText()`, and `_spawnPopDroplets()` (which uses `Math.random()` on L605–606 for particle angles/distances, `requestAnimationFrame`, and `setTimeout`). |
| L631–688 | Async Timers, Audio, Speech, DOM, `Math.random()` | `_completeCurrentWord()` is `async`, schedules `setTimeout` (350ms, 2000ms, 2600ms), calls `soundEngine.playWordComplete()`, uses `Math.random()` (L669) to pick cheer message, awaits `Promise.all` for speech + 2s delay, then calls `_startNextWord()`. |
| L693–698 | Timers & Audio | `_finishSession()` calls `cancelAnimationFrame` and `soundEngine.playSessionComplete()`. |
| L708–721 | Browser RAF Loop | `_loop(timestamp)` computes `dt` from `timestamp - this.lastFrameTime` and schedules `requestAnimationFrame`. |
| L737–741 | DOM Manipulation | `_updateBubbles(dt)` adds `'is-top-fading'` class and updates `b.el.style.transform`. |
| L762–846 | DOM & Timers | `_positionBubbleElement`, `_removeBubble`, `_clearAllBubbles`, `_renderProgressPebbles`, `_updateProgressPebbles`, `_nudgeMascotHappy`, `_celebrateMascot`, `_showMascotMessage` (`setTimeout`), `_getStageBounds` (`getBoundingClientRect`). |

### 2.2 [`js/srs.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/srs.js)
| Lines | Coupling Type | Details |
| :--- | :--- | :--- |
| L74, L88–91, L101, L170, L378, L456, L498 | System Clock (`new Date()`) | `getLocalISODate(date = new Date())`, `addDaysISO`, `getDefaultStarterWords`, `normalizeWordRecord`, `buildSessionWords`, `recordFirstAttemptSRS`, and `addWeeklyWordList` default to `new Date()` when no reference date is injected. |
| L209–260, L266, L292 | `localStorage` | `loadWords()`, `saveWords()`, `getCurrentWeekLabel()`, `setCurrentWeekLabel()` read and write `localStorage` directly. |
| L308, L361, L452, L487, L499, L542, L558, L560 | `localStorage` | `mergeWordsFromCloud`, `recordFirstAttemptSRS`, `addWeeklyWordList`, `removeWordFromStore` read/write `localStorage` via `loadWords()`/`saveWords()`. |
| L642–648 | `Math.random()` | `shuffleGently(items)` uses Fisher-Yates shuffle with `Math.random()` (L645), making `buildSessionWords()` non-deterministic without an injected PRNG. |

### 2.3 [`js/audio.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/audio.js), [`js/speech.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/speech.js), [`js/auth.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/auth.js), [`js/sync.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/sync.js), [`js/firebase-config.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/firebase-config.js)
- **`js/audio.js` L29, L353:** `new SoundSynthesizer()` runs at module evaluation time and calls `localStorage.getItem(...)` unguarded (throws in Node.js without `localStorage`). Also uses `Math.random()` in `_createSoftNoiseBuffer()` (L94).
- **`js/firebase-config.js` L6–29:** Uses browser-only HTTPS CDN imports (`https://www.gstatic.com/firebasejs/11.0.2/...`) which Node.js ESM cannot import directly.

---

## 3. Extracted Domain Rules & Mechanics

### 3.1 Word & Record Normalization ([`js/srs.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/srs.js))
1. **Word String Normalization (`normalizeWord`):**
   - Converts input to `String(raw || '').trim().toLowerCase().replace(/\s+/g, '')`.
   - Accented Unicode characters (e.g., `câlin`, `é`, `è`, `ê`, `ç`) are preserved intact; all internal whitespace is stripped.
2. **Word Record Normalization (`normalizeWordRecord(raw, fallbackWeek = 'Week 8')`):**
   - `word`: `normalizeWord(raw && raw.word ? raw.word : raw)`.
   - `box`: `Math.min(5, Math.max(1, parseInt(raw && raw.box, 10) || 1))` (clamped to `[1, 5]`; invalid/0/negative defaults to `1`).
   - `total_attempts`: `Math.max(0, parseInt(raw && raw.total_attempts, 10) || 0)`.
   - `streak`: `Math.max(0, parseInt(raw && raw.streak, 10) || 0)`.
   - `correct_attempts`:
     - If `typeof raw.correct_attempts === 'number'` and `!Number.isNaN(raw.correct_attempts)`: `Math.min(totalAttempts, Math.max(0, Math.round(raw.correct_attempts)))`.
     - Else if `totalAttempts > 0`: `Math.min(totalAttempts, Math.max(streak, boxNum > 1 ? boxNum - 1 : 0))`.
     - Else: `0`.
   - `active`: `false` only if `raw.active === false` or `String(raw.active).toLowerCase() === 'false'`; otherwise `true`.
   - `next_review`: First 10 chars of `String(raw.next_review).trim()` if matching `/^\d{4}-\d{2}-\d{2}$/`; otherwise defaults to `today` (`getLocalISODate()`).
   - `week_label`: `String((raw && raw.week_label) || fallbackWeek).trim() || fallbackWeek`.
   - `custom_audio_url`: `String((raw && (raw.custom_audio_url || raw.audio_url)) || '').trim()`.

### 3.2 Leitner SRS Progression & Session Building ([`js/srs.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/srs.js))
1. **Box Intervals (`BOX_INTERVALS`):**
   - Box 1: `+1` day, Box 2: `+2` days, Box 3: `+4` days, Box 4: `+7` days, Box 5: `+14` days.
2. **First-Attempt SRS Progression (`recordFirstAttemptSRS`):**
   - Triggered **only** on the first completion of a unique word within a session (`!firstAttemptRecorded.has(wordStr)`).
   - `total_attempts` increments by `1`.
   - If `firstAttemptErrors === 0`:
     - `box = Math.min(5, (current.box || 1) + 1)`
     - `next_review = addDaysISO(today, BOX_INTERVALS[nextBox])`
     - `streak = (current.streak || 0) + 1`
     - `correct_attempts = (current.correct_attempts || 0) + 1`
   - If `firstAttemptErrors > 0`:
     - `box = 1`
     - `next_review = addDaysISO(today, 1)`
     - `streak = 0`
     - `correct_attempts` remains unchanged.
3. **Current Week Resolution (`getCurrentWeekLabel`):**
   - Uses stored `CURRENT_WEEK_KEY` if at least one active word has that `week_label`.
   - Otherwise scans active words for `/^week\s*(\d+)$/i` and selects the label with the highest numeric week (`num >= bestNum`, so ties favor later entries), falling back to the last active word's `week_label`, or `'Week 8'` if no active words exist.
4. **Session Queue Construction (`buildSessionWords(allWords, minWords = 8, maxWords = 10)`):**
   - Filters `active` words (`w.active !== false && w.word && w.word.length > 0`). If empty, returns `getDefaultStarterWords().slice(0, maxWords)` (**CHARACTERIZATION NOTE:** when falling back to starter words on empty active list, it returns unshuffled starter words directly without calling `shuffleGently`).
   - Splits `active` into `currentWeekWords` (`w.week_label === currentWeek`) and `pastWeekWords` (`w.week_label !== currentWeek`).
   - A word is due (`isDue`) if `!w.next_review || w.next_review <= today`.
   - `sortByUrgency(a, b)`: ascending `box`, then ascending `next_review` (`localeCompare`), then ascending `total_attempts`.
   - **Past-Week Slot Reservation:** When `duePast.length > 0` and `dueCurrent.length >= maxWords - 1`, reserves `reservedPastSlots = Math.min(2, duePast.length)` so up to 2 overdue past-week words are guaranteed to mix in.
   - Fills up to `maxWords - reservedPastSlots` from `dueCurrent`, then from `duePast`, then any remaining overflow from `dueCurrent` up to `maxWords`.
   - **Top-Up Rule:** If `selected.length < Math.min(minWords, active.length)`, tops up from non-picked `currentWeekWords` (sorted by urgency) followed by non-picked `pastWeekWords` (sorted by urgency) until reaching `targetMin`.
   - Shuffles `selected` with Fisher-Yates (`shuffleGently`).

### 3.3 Plausible Distractor Generation (`getPlausibleDistractors` in [`js/srs.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/srs.js#L584-L640))
1. Collects all lowercase characters across `allWords` and `currentWord`. Sets `vocabHasAccents = true` if any character has `charCodeAt(0) > 127`.
2. Strips combining diacritics from `req` via `req.normalize('NFD').replace(/[\u0300-\u036f]/g, '')` to look up `PLAUSIBLE_LETTER_NEIGHBORS[baseKey]` (or fallback `['a', 'e', 'i', 'o', 's', 't', 'n', 'r']`). Each neighbor `!== req` is pushed **twice** (weight 2).
3. If `vocabHasAccents` is true:
   - Each variant in `ACCENT_FAMILIES[baseKey]` (`!== req`) is pushed **3 times** (weight 3).
   - Each accented character (`charCodeAt(0) > 127` and `!== req`) found in `vocabChars` is pushed **twice** (weight 2).
4. Each letter of `BASE_LOWERCASE_ALPHABET` (`a-z`, `!== req`) is pushed **once** (weight 1).
5. Final safety filter `.filter((ch) => ch !== req)` guarantees `requiredChar` is never in the returned distractor pool.

### 3.4 Smart Bubble Spawning & Physics ([`js/game.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/game.js))
1. **Initial Wave (`_spawnInitialWave`):**
   - At the start of each word, spawns `MIN_BUBBLES` (5) bubbles immediately at staggered vertical positions:
     $$\text{startY}_i = \text{height} - 20 - (4 - i) \times \min(72, \text{height} \times 0.12), \quad i \in \{0, 1, 2, 3, 4\}$$
2. **Smart Character Selection (`_chooseNextBubbleChar`):**
   - Increments `spawnCounter += 1`.
   - If `!requiredChar` (e.g., `currentIndex >= targetChars.length`), returns `'a'`.
   - **Rule 1 (Every 3rd Bubble):** If `spawnCounter % 3 === 0`, returns `requiredChar` (`targetChars[currentIndex]`).
   - **Rule 2 (30% Future Letter):** Otherwise, slices `futureChars = targetChars.slice(currentIndex + 1)`. If `futureChars.length > 0` and `prng() < 0.30`, returns `futureChars[Math.floor(prng() * futureChars.length)]`.
     - **CHARACTERIZATION NOTE:** If `futureChars` is non-empty, `prng()` is consumed for the `< 0.30` check even when the check fails ($\ge 0.30$), followed by another `prng()` call to index into `distractors`. If `futureChars` is empty (on the last letter of a word), the `< 0.30` `prng()` roll is **not** called. Furthermore, if the target word has repeated letters later in the word (e.g., `'sans'` at index `0` where `'s'` also appears at index `3`), a future letter roll can legally pick `'s'` (`requiredChar`).
   - **Rule 3 (70% Plausible Distractor):** Otherwise, calls `getPlausibleDistractors(...)` and picks `distractors[Math.floor(prng() * distractors.length)]` (fallback: `requiredChar === 'e' ? 'a' : 'e'`).
3. **Bubble Geometry & Spawn Positioning (`_spawnBubble` & `_pickNonOverlappingX`):**
   - Guards: Does not spawn if `!stage`, `wordTransitioning`, `currentIndex >= targetChars.length`, `rect.width < 40`, or `rect.height < 40`.
   - `diameter = Math.round(Math.min(98, Math.max(66, Math.min(width, height) * 0.165)))`, `radius = diameter / 2`.
   - `wobbleAmp = Math.min(22, Math.max(10, width * 0.028))`.
   - `safeMinX = radius + wobbleAmp + 10`, `safeMaxX = Math.max(safeMinX + 10, width - radius - wobbleAmp - 10)`.
   - Default `startY = height + radius * 0.55` (unless `overrideY !== null`).
   - `_pickNonOverlappingX(minX, maxX, spawnY, diameter)` evaluates 7 stratified candidates (`i = 0..6`):
     - Initial `bestX = minX + prng() * (maxX - minX)` (consumes 1 PRNG roll).
     - Each candidate `i` computes `candidateX = minX + ((i + prng() * 0.85) / 7) * (maxX - minX)` (consumes 7 PRNG rolls) and finds the nearest `'floating'` bubble with `|b.y - spawnY| < diameter * 1.65` using Euclidean distance `Math.hypot(b.baseX - candidateX, b.y - spawnY)`.
     - Picks the candidate maximizing `nearest` distance, clamped to `[minX, maxX]`.
4. **Upward Kinematics & Despawn (`_updateBubbles(dt)`):**
   - Frame `dt` in `_loop` is clamped to `[0, 0.05]` seconds: `dt = Math.min(0.05, Math.max(0, rawDt))`.
   - Only updates when `!paused && !wordTransitioning`.
   - For each bubble with `state === 'floating'`:
     - `b.age += dt`
     - `b.y -= b.speedY * dt`
     - `b.x = b.baseX + Math.sin(b.age * b.wobbleFreq + b.phase) * b.wobbleAmp`
     - Despawns (removed from `bubbles`) when `b.y < -b.radius * 0.35`.
     - Fades at top when `-b.radius * 0.35 <= b.y < b.radius * 0.45`.
5. **Population Maintenance (`_maintainBubblePopulation(dt)`):**
   - Counts `activeCount = bubbles.filter(b => b.state === 'floating').length`.
   - Increments `spawnTimer += dt`.
   - If `activeCount < 5` (`MIN_BUBBLES`) and `spawnTimer >= 0.32`: resets `spawnTimer = 0` and spawns 1 bubble.
   - Else if `activeCount < 7` (`MAX_BUBBLES`) and `spawnTimer >= 0.78` (`SPAWN_INTERVAL_SEC`): resets `spawnTimer = 0` and spawns 1 bubble.
   - **CHARACTERIZATION NOTE:** When `activeCount >= 7`, `spawnTimer` continues accumulating `dt` without resetting, so as soon as a bubble pops or expires at the top (dropping `activeCount` to 6), the next tick with `spawnTimer >= 0.78` immediately spawns a replacement bubble and resets `spawnTimer = 0`.

### 3.5 Sequential Spelling, Error Counting, & Watermark Scaffolding ([`js/game.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/game.js))
1. **Tap Validation (`_handleBubbleTap`):**
   - Ignored if `!running`, `paused`, `wordTransitioning`, `bubble.state !== 'floating'`, or `currentIndex >= targetChars.length`.
   - Strict code-point equality: `bubble.char === targetChars[currentIndex]`.
2. **Correct Bubble Tap (`_onCorrectBubbleTap`):**
   - Transitions `bubble.state = 'popping'`.
   - Increments `currentIndex += 1` and resets `letterErrorCount = 0`.
   - **Prompt Required-Letter Assist:** Checks `nextRequired = targetChars[currentIndex]`. If `nextRequired` exists and no currently `'floating'` bubble has `b.char === nextRequired`, sets `spawnCounter = 2` so the very next spawned bubble (`spawnCounter === 3`, `3 % 3 === 0`) is guaranteed to be `nextRequired`.
   - If `currentIndex >= targetChars.length`: sets `wordTransitioning = true` and schedules word completion.
3. **Wrong Bubble Tap (`_onWrongBubbleTap`):**
   - Transitions `bubble.state = 'fizzling'`.
   - Increments `wordErrorCount += 1` and `letterErrorCount += 1`.
   - **Auto-Watermark Trigger:** If `letterErrorCount >= 2 && !watermarkActive`, activates watermark (`watermarkActive = true`). Note: auto-watermark does **not** add an extra `wordErrorCount` penalty beyond the 2 wrong taps.
4. **Hint Button (`useHintButton`):**
   - Ignored if `!running`, `wordTransitioning`, or `!currentWordObj`.
   - If `!watermarkActive`: increments `wordErrorCount += 1` and sets `watermarkActive = true`.
   - If `watermarkActive` is already `true`: does **not** increment `wordErrorCount` (only pulses the UI watermark slots).

### 3.6 Word Completion, Re-Queueing, & Session Completion ([`js/game.js`](file:///c:/Users/scher/Documents/antigravity/adventurous-lavoisier/js/game.js#L623-L706))
1. **First-Attempt Recording:**
   - If `!firstAttemptRecorded.has(wordStr)`: adds `wordStr` to `firstAttemptRecorded`, appends `{ word: wordStr, firstAttemptErrors: wordErrorCount, masteredFirstTry: wordErrorCount === 0 }` to `sessionResults`, and invokes `onFirstAttemptComplete(wordStr, wordErrorCount)`.
2. **Zero-Error Mastery & Re-Queueing:**
   - If `wordErrorCount === 0`: increments `masteredCount += 1`.
   - If `wordErrorCount > 0`: pushes `{ ...currentWordObj, isRetry: true }` to the **end** of `queue`.
3. **Session Termination:**
   - When `_startNextWord()` is called and `queue.length === 0`: sets `running = false`, clears bubbles, and calls `onSessionComplete({ totalWords: totalUniqueWords, firstTryPerfect, results: sessionResults })`.

---

## 4. Refactoring Plan (Phase 2 Blueprint)

To achieve **Zero DOM/Canvas Coupling in Core Logic** and **100% Deterministic Execution** while keeping the static browser game (`index.html` + `js/*.js`) 100% playable without a bundler:

### 4.1 Seeded PRNG Module (`js/prng.js`)
- Create a pure ES module `js/prng.js` exporting `createPRNG(seed = 1)` implementing **Mulberry32**, returning a deterministic `() => number` generator in $[0, 1)$.

### 4.2 Pure Domain & State Stepper Extraction (`js/game-core.js` & `js/srs.js`)
1. **Pure Headless State Factory (`createGameState(config)`):**
   - Extract all pure state initialization and transition logic into `js/game-core.js` (imported by `js/game.js` and by the Vitest suites).
   - `createGameState(config)` accepts:
     - `sessionWords`, `allVocabWords`
     - `stageWidth` (default `360`), `stageHeight` (default `420`)
     - `seed` (number) or `prng` (`() => number` function, defaulting to `createPRNG(seed)`)
   - Returns a plain, serializable, DOM-free state tree containing all session, word, queue, bubble, and PRNG state properties.
2. **Deterministic Stepper (`stepGame(state, action, dt)`):**
   - Pure state transition function (or mutating/cloning reducer) supporting explicit actions and `dt`:
     - `{ type: 'START_SESSION', sessionWords, allVocabWords }`
     - `{ type: 'TICK', dt }` (or passing `dt` with `action = null / { type: 'TICK' }`): clamps `dt` to `[0, 0.05]`, updates floating bubble kinematics (`age`, `y`, `x`), removes top-expired bubbles (`y < -radius * 0.35`), and runs `_maintainBubblePopulation(dt)` using the state's seeded PRNG.
     - `{ type: 'TAP_BUBBLE', bubbleId }`: executes `_handleBubbleTap` logic (`popping` vs `fizzling`, `currentIndex`, `wordErrorCount`, `letterErrorCount`, `watermarkActive`, `spawnCounter = 2` assist, `wordTransitioning`).
     - `{ type: 'USE_HINT' }`: executes `useHintButton` state logic.
     - `{ type: 'COMPLETE_WORD' }`: executes `_completeCurrentWord` state transitions (first-attempt recording, `masteredCount` vs `queue.push({ ...currentWordObj, isRetry: true })`, advancing to `_startNextWord` or finishing the session).
     - `{ type: 'PAUSE' }`, `{ type: 'RESUME' }`, `{ type: 'STOP' }`, `{ type: 'RESIZE', width, height }`.
3. **Deterministic Injection in `js/srs.js`:**
   - Allow optional `today` (`string`) and `prng` (`() => number`) parameters in `getDefaultStarterWords`, `normalizeWordRecord`, `buildSessionWords`, `recordFirstAttemptSRS`, `addWeeklyWordList`, and `shuffleGently`, plus an optional injectable storage adapter (defaulting to `globalThis.localStorage` when available or an in-memory fallback in Node.js).
4. **Adapter Layer in `HotTubGame` (`js/game.js`) & Safe Browser Guards (`js/audio.js`):**
   - Guard `typeof localStorage !== 'undefined'` and `typeof Image !== 'undefined'` so importing `js/game.js` or `js/audio.js` in Node.js never throws.
   - Refactor `HotTubGame` in `js/game.js` to delegate all state transitions, bubble math, and spawning rules to the deterministic core functions while retaining all existing DOM rendering, flying letter animations, audio synthesizer calls, and speech cascade hooks for identical browser behavior.
