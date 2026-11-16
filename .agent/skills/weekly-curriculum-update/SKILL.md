---
name: weekly-curriculum-update
description: Add a new weekly vocabulary list (Week N), set Week N as the default active week, add bundled offline MP3 audio files, and sync to Cloud Firestore and LocalStorage without overwriting existing learner statistics. Use this skill every week when adding a new spelling week.
---

# Weekly Curriculum Update (`Week N`)

Follow this checklist whenever adding a new spelling week (`Week N`, e.g., `Week 10`) to **Cozy Tub Spelling** (`hot-tub-spelling`).

## 1. Prerequisites & Inputs
1. **Confirm the `Week N` word list** (normalized lowercase French words, preserving accents like `â`, `é`, `è`, `ê`, `ç`).
2. **Audio files (`assets/audio/words/<word>.mp3`)**:
   - Place each word's `.mp3` file in `assets/audio/words/<word>.mp3` (48 kHz mono 192 kbps MP3 recommended).
   - If a word contains accents (e.g., `câlin`), include both the accented filename (`câlin.mp3`) and unaccented fallback (`calin.mp3`) if needed, and map the normalized word in `DEFAULT_WORD_AUDIO_MAP`.
3. **Executable Specification Guardrail (`.antigravityrules` Rule 4)**:
   - Updating the starter word count (`totalWords`) and default week label (`Week N`) changes assertions in `/specs`.
   - Cite the affected spec lines and confirm permission with the user before editing `/specs`:
     - `specs/behaviors/srs.spec.ts` (lines 139–155, 491–494, 727, 747–770, 808–842)
     - `specs/behaviors/profiles.spec.ts` (lines 215–228)
     - `specs/behaviors/gamification-stars.spec.ts` (line 115)

---

## 2. Preserving Existing Learner Statistics (Zero-Reset Guarantee)
The codebase already includes non-destructive upgrade hooks in `js/srs.js` and `js/sync.js`. Verify they remain intact when adding `Week N`:
1. **Local Storage (`loadWords` in `js/srs.js`)**:
   - Existing words in `localStorage['hottub_srs_words_v2']` are loaded first, keeping their `box`, `next_review`, `streak`, `total_attempts`, and `correct_attempts` untouched.
   - Any word from `getDefaultStarterWords(today)` not yet in `seen` is appended with initial Box 1 stats (`box: 1`, `streak: 0`, `total_attempts: 0`, `correct_attempts: 0`).
   - When `addedStarter` is `true`, `saveWords(cleaned, store, 'daughter')` saves the merged list and updates `CURRENT_WEEK_KEY` to `getCurrentWeekLabel(cleaned, store)` (`Week N`).
2. **Cloud Merge (`mergeWordsFromCloud` in `js/srs.js`)**:
   - Preserves all remote/local SRS stats and profile maps (`profiles.test`), appends any missing `getDefaultStarterWords(todayIso)` records, and advances `current_week_label` to the highest numeric `Week N` if `highestWeekNum > remoteNum`.
3. **Firestore Background Backfill (`_backfillMissingDefaultWords` in `js/sync.js`)**:
   - Only runs for words in `getDefaultStarterWords()` that are **absent** from `remoteWordSet` (`!remoteWordSet.has(cleanW)`).
   - Uses `batch.set(wordRef, ..., { merge: true })` ONLY on the newly added `Week N` words and updates `metadata/app_state.current_week_label` to `'Week N'` with `{ merge: true }` without touching `profiles` or `trapHistory` on existing words.

---

## 3. Step-by-Step File Modifications

### Step 3.1: `assets/audio/words/`
- Add `assets/audio/words/<word>.mp3` for each new word in `Week N`.

### Step 3.2: `js/srs.js`
1. **`DEFAULT_WORD_AUDIO_MAP`**:
   - Add `'word': 'assets/audio/words/word.mp3'` entries for every word in `Week N`.
2. **`getDefaultStarterWords(todayIso)`**:
   - Add `const weekNWords = [ ... ];` and push records with `week_label: 'Week N'`, `active: true`, `box: 1`, `next_review: today`, `streak: 0`, `total_attempts: 0`, `correct_attempts: 0`, `custom_audio_url: getDefaultAudioUrl(word)`.
3. **Default Fallback Week Label**:
   - Update fallback week strings from `'Week N-1'` to `'Week N'` in:
     - `normalizeWordRecord(raw, fallbackWeek = 'Week N', todayIso)`
     - `loadWords`: initial seed `store.setItem(CURRENT_WEEK_KEY, 'Week N')` and `normalizeWordRecord(item, 'Week N', today)`
     - `getCurrentWeekLabel`: final fallback `return 'Week N';`
     - `mergeWordsFromCloud`: `normalizeWordRecord(row, 'Week N', todayIso)`

### Step 3.3: `js/sync.js`
1. Update fallback week strings from `'Week N-1'` to `'Week N'` in:
   - `_seedInitialWords`: `w.week_label || 'Week N'` and `current_week_label: currentWeekLabel || 'Week N'`
   - `_backfillMissingDefaultWords`: `item.week_label || 'Week N'` and `current_week_label: 'Week N'`

### Step 3.4: `index.html` & Documentation (`README.md`, `SPEC_AUDIT.md`)
1. **`index.html`**:
   - Update `#start-sync-note` total word count (`<total> words ready • Firebase Cloud Sync`).
   - Update `#parent-active-week-badge` default text (`Active: Week N`).
   - Update `#input-week-label` placeholder (`Week N+1`) and `#input-weekly-words` placeholder (the `Week N` words).
2. **`README.md`**:
   - Update total starter word count and add `- **Week N:** ...` under `## Initial Vocabulary List`.
3. **`SPEC_AUDIT.md`**:
   - Update references to the default fallback week (`'Week N'`).

### Step 3.5: Executable Specifications (`/specs`) & Verification
1. After receiving user permission per `.antigravityrules` Rule 4, update the starter count and default week expectations in:
   - `specs/behaviors/srs.spec.ts` (including adding/updating the behavioral test verifying that upgrading to `Week N` preserves existing `daughter` statistics on prior weeks' words).
   - `specs/behaviors/profiles.spec.ts`
   - `specs/behaviors/gamification-stars.spec.ts`
2. Run verification:
   ```bash
   npx tsc --noEmit && npx vitest run
   ```
3. Commit and push (including `assets/audio/words/*.mp3`) to deploy to GitHub Pages.
