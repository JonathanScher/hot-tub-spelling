// @vitest-environment happy-dom
/**
 * Executable Behavioral Specification: "Treasure Chest & Plushie Shelf" Level
 *
 * Covers:
 * 1. Single-character dial initialization (1 dial per character, populated with correct letter + distractors from getPlausibleDistractors)
 * 2. Pin-locking state machine (partial validation locks matching indices, rattles incorrect indices, locked dials reject scroll/change)
 * 3. Tiered reward logic (attempt === 1 -> golden plushie; attempt > 1 -> standard plushie + word remains in rotation for golden upgrade)
 * 4. 30+ Plushie catalog, SVG generator, & shelf upgrade state (standard -> golden without duplicates)
 * 5. Interactive 2D shelf physics, audio synthesizer foley, and TTS replay binding
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PLUSHIE_CATALOG,
  renderPlushieSvg,
  selectPlushieForReward,
  upsertPlushieOnShelf,
  loadPlushieShelf,
  savePlushieShelf
} from '../../js/plushies.js';
import {
  createChestGameState,
  scrollDialOnState,
  setDialCharOnState,
  validateChestLockOnState,
  advanceToNextChestOnState,
  stepShelfPhysicsOnState,
  dragPlushieOnState,
  releasePlushieOnState,
  autoHopPlushieToShelfOnState
} from '../../js/chest-game-core.js';
import { ChestPlushieGame } from '../../js/chest-game.js';
import { getPlausibleDistractors, clearMemoryStorage } from '../../js/srs.js';
import { speechEngine } from '../../js/speech.js';
import { soundEngine } from '../../js/audio.js';

describe('Treasure Chest & Plushie Shelf Level (Executable Specification)', () => {
  beforeEach(() => {
    clearMemoryStorage();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Single-Character Dial Initialization & Existing Distractor Integration', () => {
    it('initializes strictly 1 dial per character in the target word (never grouping graphemes) and preserves French accents', () => {
      // GIVEN a French target word "printemps" (9 letters) and accented word "câlin" (5 letters)
      const statePrintemps = createChestGameState({
        sessionWords: [{ word: 'printemps', week_label: 'Week 8' }],
        seed: 42
      });

      // THEN there is strictly 1 dial per character
      expect(statePrintemps.dials.length).toBe(9);
      expect(statePrintemps.targetChars).toEqual(['p', 'r', 'i', 'n', 't', 'e', 'm', 'p', 's']);

      statePrintemps.dials.forEach((dial, idx) => {
        expect(dial.index).toBe(idx);
        expect(dial.targetChar).toBe('printemps'[idx]);
        expect(dial.targetChar.length).toBe(1);
        expect(dial.isLocked).toBe(false);
        expect(dial.options).toContain(dial.targetChar);
        // Every option on the dial is a single character
        for (const opt of dial.options) {
          expect(Array.from(opt).length).toBe(1);
        }
      });

      // GIVEN an accented Canadian French word "câlin"
      const stateCalin = createChestGameState({
        sessionWords: [{ word: 'câlin', week_label: 'Week 8' }],
        seed: 99
      });
      expect(stateCalin.dials.length).toBe(5);
      expect(stateCalin.dials[1].targetChar).toBe('â');
      expect(stateCalin.dials[1].options).toContain('â');
    });

    it('populates each dial with the target character plus plausible distractors from getPlausibleDistractors', () => {
      // GIVEN a vocabulary list and target word "sauter" (contains digram 'au', which must remain 1 letter per dial)
      const vocab = [{ word: 'sauter' }, { word: 'savoir' }, { word: 'câlin' }];
      const state = createChestGameState({
        sessionWords: [{ word: 'sauter', week_label: 'Week 7' }],
        allVocabWords: vocab,
        seed: 7
      });

      expect(state.dials.length).toBe(6);

      // THEN each dial contains the correct target letter and distractors sourced from getPlausibleDistractors
      state.dials.forEach((dial, idx) => {
        const validDistractorPool = new Set(
          getPlausibleDistractors(dial.targetChar, 'sauter', vocab, idx, state.trapHistory)
        );
        expect(dial.options).toContain(dial.targetChar);
        expect(dial.options.length).toBeGreaterThanOrEqual(4);

        const distractorsOnDial = dial.options.filter((ch) => ch !== dial.targetChar);
        expect(distractorsOnDial.length).toBe(dial.options.length - 1);
        for (const d of distractorsOnDial) {
          expect(validDistractorPool.has(d)).toBe(true);
        }
      });
    });
  });

  describe('2. Pin-Locking State Machine & Locked Dial Immutability', () => {
    it('locks matching indices (isLocked = true) and leaves non-matching indices unlocked (isLocked = false) on partial validation', () => {
      // GIVEN a chest lock initialized for the 4-letter word "loin"
      const state = createChestGameState({
        sessionWords: [{ word: 'loin', week_label: 'Week 8' }],
        seed: 12
      });

      // Align dials 0 ('l') and 2 ('i') to the correct letters, and set dials 1 and 3 to wrong distractors
      setDialCharOnState(state, 0, 'l');
      const wrong1 = state.dials[1].options.find((c) => c !== 'o')!;
      setDialCharOnState(state, 1, wrong1);
      setDialCharOnState(state, 2, 'i');
      const wrong3 = state.dials[3].options.find((c) => c !== 'n')!;
      setDialCharOnState(state, 3, wrong3);

      // WHEN validating the guess
      const res = validateChestLockOnState(state);

      // THEN matching indices (0, 2) lock into place and non-matching indices (1, 3) remain unlocked
      expect(res.unlocked).toBe(false);
      expect(res.attempt).toBe(1);
      expect(res.newlyLockedIndices).toEqual([0, 2]);
      expect(res.incorrectIndices).toEqual([1, 3]);

      expect(state.dials[0].isLocked).toBe(true);
      expect(state.dials[1].isLocked).toBe(false);
      expect(state.dials[2].isLocked).toBe(true);
      expect(state.dials[3].isLocked).toBe(false);
      expect(state.dials[1].rattleCount).toBe(1);
      expect(state.dials[3].rattleCount).toBe(1);
    });

    it('rejects subsequent scroll and change events on locked dials while allowing unlocked dials to scroll', () => {
      // GIVEN a chest lock where dial 0 is locked on 's' and dial 1 is unlocked
      const state = createChestGameState({
        sessionWords: [{ word: 'sans', week_label: 'Week 7' }],
        seed: 21
      });

      setDialCharOnState(state, 0, 's');
      const wrong1 = state.dials[1].options.find((c) => c !== 'a')!;
      setDialCharOnState(state, 1, wrong1);
      validateChestLockOnState(state);

      expect(state.dials[0].isLocked).toBe(true);
      expect(state.dials[0].currentChar).toBe('s');
      const lockedSelectedIdx = state.dials[0].selectedIndex;

      // WHEN attempting to scroll or change the locked dial 0
      const scrollRes = scrollDialOnState(state, 0, 1);
      const setRes = setDialCharOnState(state, 0, state.dials[0].options.find((c) => c !== 's')!);

      // THEN the locked dial rejects both events and remains on 's'
      expect(scrollRes.changed).toBe(false);
      expect(scrollRes.locked).toBe(true);
      expect(setRes.changed).toBe(false);
      expect(setRes.locked).toBe(true);
      expect(state.dials[0].currentChar).toBe('s');
      expect(state.dials[0].selectedIndex).toBe(lockedSelectedIdx);

      // WHEN scrolling the unlocked dial 1
      const unlockedScroll = scrollDialOnState(state, 1, 1);
      expect(unlockedScroll.changed).toBe(true);
      expect(unlockedScroll.locked).toBe(false);
    });
  });

  describe('3. Tiered Reward Logic & Word Rotation for Golden Upgrade', () => {
    it('awards a golden plushie ({ plushieId, variant: "golden" }) when solved on attempt === 1 without re-queueing the word', () => {
      // GIVEN a chest lock for "soleil"
      const state = createChestGameState({
        sessionWords: [
          { word: 'soleil', week_label: 'Week 7' },
          { word: 'câlin', week_label: 'Week 8' }
        ],
        seed: 101
      });

      // Align all dials to spell "soleil" on the very first attempt
      'soleil'.split('').forEach((ch, idx) => {
        setDialCharOnState(state, idx, ch);
      });

      // WHEN validating on attempt 1
      const res = validateChestLockOnState(state);

      // THEN chest unlocks with a golden plushie and celebratory golden burst
      expect(res.unlocked).toBe(true);
      expect(res.attempt).toBe(1);
      expect(res.reward).toBeDefined();
      expect(res.reward?.variant).toBe('golden');
      expect(typeof res.reward?.plushieId).toBe('string');
      expect(res.effect).toBe('golden-burst');
      expect(res.requeuedForGolden).toBe(false);

      // AND "soleil" is NOT re-queued into state.queue
      expect(state.queue.some((w) => w.word === 'soleil')).toBe(false);
      expect(state.masteredCount).toBe(1);
    });

    it('awards a standard plushie ({ plushieId, variant: "standard" }) when solved on attempt > 1 and flags the word to remain in rotation for a future golden upgrade', () => {
      // GIVEN a chest lock for "singe"
      const state = createChestGameState({
        sessionWords: [{ word: 'singe', week_label: 'Week 8' }],
        seed: 202
      });

      // Attempt 1: partial guess ('s', 'i' correct; others wrong)
      setDialCharOnState(state, 0, 's');
      setDialCharOnState(state, 1, 'i');
      setDialCharOnState(state, 2, state.dials[2].options.find((c) => c !== 'n')!);
      setDialCharOnState(state, 3, state.dials[3].options.find((c) => c !== 'g')!);
      setDialCharOnState(state, 4, state.dials[4].options.find((c) => c !== 'e')!);

      const res1 = validateChestLockOnState(state);
      expect(res1.unlocked).toBe(false);
      expect(res1.attempt).toBe(1);

      // Attempt 2: align the remaining unlocked dials ('n', 'g', 'e')
      setDialCharOnState(state, 2, 'n');
      setDialCharOnState(state, 3, 'g');
      setDialCharOnState(state, 4, 'e');

      // WHEN validating on attempt 2 (attempt > 1)
      const res2 = validateChestLockOnState(state);

      // THEN chest unlocks with a standard plushie
      expect(res2.unlocked).toBe(true);
      expect(res2.attempt).toBe(2);
      expect(res2.reward).toBeDefined();
      expect(res2.reward?.variant).toBe('standard');
      expect(res2.effect).toBe('standard');
      expect(res2.requeuedForGolden).toBe(true);

      // AND the word remains in rotation in state.queue flagged for a future golden upgrade
      expect(state.queue.length).toBe(1);
      expect(state.queue[0].word).toBe('singe');
      expect(state.queue[0].isRetry).toBe(true);
      expect(state.queue[0].needsGoldenUpgrade).toBe(true);
      expect(state.queue[0].targetPlushieId).toBe(res2.reward?.plushieId);
    });
  });

  describe('4. 30+ Plushie Catalog, Programmatic SVG Generator & Shelf Upgrade State', () => {
    it('provides at least 30 distinct plushies with valid standard and golden SVG visual states (including the white cat mascot)', () => {
      // GIVEN the PLUSHIE_CATALOG
      expect(PLUSHIE_CATALOG.length).toBeGreaterThanOrEqual(30);

      const uniqueIds = new Set(PLUSHIE_CATALOG.map((p) => p.id));
      expect(uniqueIds.size).toBe(PLUSHIE_CATALOG.length);

      // Includes a white cat plushie referencing the main white cat across levels
      const hasWhiteCat = PLUSHIE_CATALOG.some(
        (p) => p.id.includes('white-cat') || p.name.toLowerCase().includes('white cat') || p.id.includes('flocon')
      );
      expect(hasWhiteCat).toBe(true);

      // WHEN rendering standard and golden SVG states for every plushie
      for (const plushie of PLUSHIE_CATALOG) {
        const standardSvg = renderPlushieSvg(plushie.id, 'standard');
        const goldenSvg = renderPlushieSvg(plushie.id, 'golden');

        expect(standardSvg).toContain('<svg');
        expect(goldenSvg).toContain('<svg');
        expect(goldenSvg).not.toBe(standardSvg);
        // Golden state includes golden aura/sparkle/crown markers
        expect(goldenSvg).toMatch(/golden|sparkle|crown/i);
      }
    });

    it('upgrades an existing plushie from standard to golden on the shelf without creating duplicates', () => {
      // GIVEN a shelf with an existing standard plushie
      const targetId = PLUSHIE_CATALOG[0].id;
      const initialShelf = [
        { plushieId: targetId, variant: 'standard' as const, word: 'singe' },
        { plushieId: PLUSHIE_CATALOG[1].id, variant: 'standard' as const, word: 'loin' }
      ];

      // WHEN upgrading targetId with a golden reward
      const result = upsertPlushieOnShelf(initialShelf, {
        plushieId: targetId,
        variant: 'golden'
      });

      // THEN the shelf still has exactly 2 items (no duplicate created) and targetId is now golden
      expect(result.shelf.length).toBe(2);
      expect(result.upgraded).toBe(true);
      expect(result.added).toBe(false);

      const matchingEntries = result.shelf.filter((item) => item.plushieId === targetId);
      expect(matchingEntries.length).toBe(1);
      expect(matchingEntries[0].variant).toBe('golden');

      // WHEN a word later solved on attempt > 1 awards a standard variant of an already-golden plushie
      const afterStandard = upsertPlushieOnShelf(result.shelf, {
        plushieId: targetId,
        variant: 'standard'
      });

      // THEN it never downgrades golden back to standard and never duplicates
      expect(afterStandard.shelf.length).toBe(2);
      expect(afterStandard.shelf.find((p) => p.plushieId === targetId)?.variant).toBe('golden');
    });

    it('completes the full in-session upgrade cycle when a re-queued word is solved on attempt === 1', () => {
      // GIVEN a 1-word session where the player takes 2 attempts on round 1, then 1 attempt on the re-queued round
      const state = createChestGameState({
        sessionWords: [{ word: 'loin', week_label: 'Week 8' }],
        seed: 303
      });

      // Round 1, Attempt 1: wrong guess
      setDialCharOnState(state, 0, state.dials[0].options.find((c) => c !== 'l')!);
      validateChestLockOnState(state);

      // Round 1, Attempt 2: correct guess -> awards standard plushie & re-queues "loin"
      'loin'.split('').forEach((ch, idx) => setDialCharOnState(state, idx, ch));
      const round1Unlock = validateChestLockOnState(state);
      const awardedPlushieId = round1Unlock.reward!.plushieId;

      expect(round1Unlock.reward?.variant).toBe('standard');
      expect(state.shelf.length).toBe(1);
      expect(state.shelf[0]).toMatchObject({ plushieId: awardedPlushieId, variant: 'standard' });

      // Advance to next chest (loads the re-queued "loin")
      advanceToNextChestOnState(state);
      expect(state.currentWordObj?.word).toBe('loin');
      expect(state.attempts).toBe(0);

      // Round 2, Attempt 1: solve on first try!
      'loin'.split('').forEach((ch, idx) => setDialCharOnState(state, idx, ch));
      const round2Unlock = validateChestLockOnState(state);

      // THEN the existing standard plushie on the shelf upgrades to golden without creating a duplicate
      expect(round2Unlock.reward).toEqual({ plushieId: awardedPlushieId, variant: 'golden' });
      expect(state.shelf.length).toBe(1);
      expect(state.shelf[0]).toMatchObject({ plushieId: awardedPlushieId, variant: 'golden' });
    });
  });

  describe('5. Interactive 2D Shelf Physics, Audio Foley & DOM Controller', () => {
    it('simulates 2D gravity, shelf collision, and auto-hop onto the wooden shelves on Next Chest', () => {
      // GIVEN an unlocked chest with an active popped-out plushie
      const state = createChestGameState({
        sessionWords: [
          { word: 'sans', week_label: 'Week 7' },
          { word: 'loin', week_label: 'Week 8' }
        ],
        seed: 55
      });

      'sans'.split('').forEach((ch, idx) => setDialCharOnState(state, idx, ch));
      validateChestLockOnState(state);

      expect(state.activePlushie).not.toBeNull();

      // WHEN dragging and releasing the plushie above a shelf tier and stepping 2D physics
      dragPlushieOnState(state, 180, 80);
      releasePlushieOnState(state, 15, -20);

      for (let i = 0; i < 60; i++) {
        stepShelfPhysicsOnState(state, 0.016);
      }

      // THEN the plushie lands cleanly on a wooden shelf surface
      expect(state.activePlushie?.placedOnShelf).toBe(true);
      expect(Number.isFinite(state.activePlushie?.x)).toBe(true);
      expect(Number.isFinite(state.activePlushie?.y)).toBe(true);

      // AND if a player immediately clicks "Next Chest" before dragging, autoHop places it on the shelf
      advanceToNextChestOnState(state);
      'loin'.split('').forEach((ch, idx) => setDialCharOnState(state, idx, ch));
      validateChestLockOnState(state);
      expect(state.activePlushie?.placedOnShelf).toBe(false);

      advanceToNextChestOnState(state);
      expect(state.shelf.length).toBe(2);
      expect(state.shelf.every((p) => typeof p.x === 'number' && typeof p.y === 'number')).toBe(true);
    });

    it('renders the DOM chest lock, binds the left Replay button to speechEngine.speakWord, and plays Web Audio dial ticks, clunks, rattles, and plushie squeaks', () => {
      // GIVEN a DOM container and mocked speech/sound spies
      const container = document.createElement('div');
      document.body.appendChild(container);

      const speakSpy = vi.spyOn(speechEngine, 'speakWord').mockResolvedValue({ played: true, tier: 1 });
      const tickSpy = vi.spyOn(soundEngine, 'playDialTick');
      const clunkSpy = vi.spyOn(soundEngine, 'playPinLockClunk');
      const rattleSpy = vi.spyOn(soundEngine, 'playDialRattle');
      const squeakSpy = vi.spyOn(soundEngine, 'playPlushieSqueak');

      const chestGame = new ChestPlushieGame({
        stage: container,
        seed: 77
      });

      // WHEN starting a session with "câlin"
      chestGame.startSession([{ word: 'câlin', week_label: 'Week 8' }]);

      // THEN 5 vertical letter dials, a left Replay button, and a Validate button are rendered
      const dialEls = container.querySelectorAll('.chest-dial');
      expect(dialEls.length).toBe(5);

      const replayBtn = container.querySelector('.chest-replay-btn') as HTMLButtonElement;
      const validateBtn = container.querySelector('.chest-validate-btn') as HTMLButtonElement;
      expect(replayBtn).not.toBeNull();
      expect(validateBtn).not.toBeNull();

      // WHEN clicking the Replay button to the left of the lock
      speakSpy.mockClear();
      replayBtn.click();

      // THEN it triggers the existing word-reading audio service at normal speed
      expect(speakSpy).toHaveBeenCalledTimes(1);
      expect(speakSpy).toHaveBeenCalledWith(expect.objectContaining({ word: 'câlin' }));

      // WHEN scrolling a dial
      chestGame.scrollDial(0, 1);
      expect(tickSpy).toHaveBeenCalled();

      // Set dial 0 to 'c' (correct) and dial 1 to a wrong letter, then click Validate
      chestGame.setDialChar(0, 'c');
      const wrongChar = chestGame.state.dials[1].options.find((c) => c !== 'â')!;
      chestGame.setDialChar(1, wrongChar);
      validateBtn.click();

      // THEN dial 0 locks with a heavy mechanical clunk & green/gold frame class, and dial 1 rattles
      expect(clunkSpy).toHaveBeenCalled();
      expect(rattleSpy).toHaveBeenCalled();
      expect(dialEls[0].classList.contains('is-locked')).toBe(true);
      expect(dialEls[1].classList.contains('is-rattling')).toBe(true);

      // Complete unlocking the chest
      'câlin'.split('').forEach((ch, idx) => chestGame.setDialChar(idx, ch));
      validateBtn.click();
      chestGame.autoHopToShelf();

      // WHEN clicking a plushie on the shelf
      const shelfPlushieEl = container.querySelector('.shelf-plushie-item') as HTMLElement;
      expect(shelfPlushieEl).not.toBeNull();
      shelfPlushieEl.click();

      // THEN it plays a cute squeak sound and triggers the squish-and-bounce animation class
      expect(squeakSpy).toHaveBeenCalled();
      expect(shelfPlushieEl.classList.contains('is-squishing')).toBe(true);

      chestGame.stop();
      container.remove();
    });
  });
});
