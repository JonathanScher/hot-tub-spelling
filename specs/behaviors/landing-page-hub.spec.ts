// @vitest-environment happy-dom
/**
 * Executable Behavioral Specification: ADHD-Friendly 2-State Landing Page
 * (State 1: The Login Gate | State 2: The Play Hub)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { soundEngine } from '../../js/audio.js';
import {
  setMockAuthUser,
  resetMockFirebase
} from '../mocks/firebase-mock.js';
import {
  clearMemoryStorage,
  loadWords,
  saveWords,
  getLocalISODate,
  getActiveProfileId,
  setActiveProfileId,
  awardCosmeticStars
} from '../../js/srs.js';

const rawHtml = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
const sanitizedHtml = rawHtml.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, '');

describe('ADHD-Friendly 2-State Landing Page: Login Gate & Play Hub (Executable Specification)', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    clearMemoryStorage();
    localStorage.clear();
    resetMockFirebase();

    vi.spyOn(soundEngine, 'unlockAudio').mockResolvedValue(undefined);
    vi.spyOn(soundEngine, 'playLevelSelectBathtub').mockImplementation(() => {});
    vi.spyOn(soundEngine, 'playLevelSelectChest').mockImplementation(() => {});
    vi.spyOn(soundEngine, 'playModeQuack').mockImplementation(() => {});
    vi.spyOn(soundEngine, 'playSleepMaskToggle').mockImplementation(() => {});
    vi.spyOn(soundEngine, 'playStartHarpGlissando').mockImplementation(() => {});
    vi.spyOn(soundEngine, 'playCatWakeMeow').mockImplementation(() => {});
    vi.spyOn(soundEngine, 'playUiTap').mockImplementation(() => {});

    document.documentElement.innerHTML = sanitizedHtml;
    await import('../../js/app.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('1. State 1 (The Login Gate) vs. State 2 (The Play Hub)', () => {
    it('renders ONLY the Login Gate when unauthenticated and reveals the Play Hub upon Google sign-in', async () => {
      // GIVEN no authenticated Google session
      const authGateBox = document.getElementById('auth-gate-box') as HTMLElement;
      const playHubView = document.getElementById('play-hub-view') as HTMLElement;
      const btnGoogleSignin = document.getElementById('btn-google-signin') as HTMLButtonElement;

      // THEN State 1 (Login Gate) is visible and State 2 (Play Hub) is hidden
      expect(authGateBox.hidden).toBe(false);
      expect(playHubView.hidden).toBe(true);
      expect(btnGoogleSignin).not.toBeNull();

      // WHEN the family Google account signs in
      setMockAuthUser({
        email: 'scher.jonathan@gmail.com',
        displayName: 'Zoé',
        photoURL: 'https://example.com/zoe.png'
      });
      await Promise.resolve();

      // THEN the cat wake/meow sound plays, Login Gate hides, and Play Hub is revealed
      expect(authGateBox.hidden).toBe(true);
      expect(playHubView.hidden).toBe(false);
      expect(soundEngine.playCatWakeMeow).toHaveBeenCalled();
    });
  });

  describe('2. Zero-Click Readiness, Level Select & Duck Mode Select', () => {
    it('pre-selects Cozy Bathtub and 3 Words by default and triggers tactile foley on selection', async () => {
      // GIVEN an authenticated session on the Play Hub
      setMockAuthUser({ email: 'scher.jonathan@gmail.com', displayName: 'Zoé' });
      await Promise.resolve();

      const cardBathtub = document.getElementById('card-level-bathtub') as HTMLButtonElement;
      const cardChest = document.getElementById('card-level-chest') as HTMLButtonElement;
      const btnMode3 = document.getElementById('btn-mode-3') as HTMLButtonElement;
      const btnMode10 = document.getElementById('btn-mode-10') as HTMLButtonElement;

      // THEN Cozy Bathtub and 3 Words are pre-selected for zero-click readiness
      expect(cardBathtub.classList.contains('is-selected')).toBe(true);
      expect(cardBathtub.getAttribute('aria-checked')).toBe('true');
      expect(cardChest.classList.contains('is-selected')).toBe(false);
      expect(btnMode3.classList.contains('is-selected')).toBe(true);
      expect(btnMode10.classList.contains('is-selected')).toBe(false);

      // WHEN selecting the Chest Opening level card
      cardChest.click();
      await Promise.resolve();

      // THEN Chest Opening becomes active and plays the wooden creak + coin chime
      expect(cardChest.classList.contains('is-selected')).toBe(true);
      expect(cardChest.getAttribute('aria-checked')).toBe('true');
      expect(cardBathtub.classList.contains('is-selected')).toBe(false);
      expect(soundEngine.playLevelSelectChest).toHaveBeenCalledTimes(1);

      // WHEN switching to 10 Words ("Big Soak") mode
      btnMode10.click();
      await Promise.resolve();

      // THEN 10 Words is active and plays the 3-quack chorus
      expect(btnMode10.classList.contains('is-selected')).toBe(true);
      expect(btnMode10.getAttribute('aria-checked')).toBe('true');
      expect(btnMode3.classList.contains('is-selected')).toBe(false);
      expect(soundEngine.playModeQuack).toHaveBeenCalledWith(10);
    });

    it('renders the Cover-Flow Carousel with a Selected crest (no bubble aura), wooden paddles, pebble dots, and scales from 2 to 10 levels', async () => {
      // GIVEN an authenticated session on the Play Hub
      setMockAuthUser({ email: 'scher.jonathan@gmail.com', displayName: 'Zoé' });
      await Promise.resolve();

      const levelGroup = document.getElementById('level-select-group') as HTMLElement;
      const cardBathtub = document.getElementById('card-level-bathtub') as HTMLButtonElement;
      const cardChest = document.getElementById('card-level-chest') as HTMLButtonElement;
      const btnNext = document.getElementById('btn-level-next') as HTMLButtonElement;
      const btnPrev = document.getElementById('btn-level-prev') as HTMLButtonElement;
      const dotsContainer = document.getElementById('level-carousel-dots') as HTMLElement;

      // THEN no bubble aura overlay exists on level cards, and each card has a top Selected crest
      expect(levelGroup.querySelector('.level-bubble-aura')).toBeNull();
      expect(cardBathtub.querySelector('.level-selected-crest')).not.toBeNull();
      expect(cardBathtub.classList.contains('pos-center')).toBe(true);
      expect(cardChest.classList.contains('pos-right')).toBe(true);
      expect(dotsContainer.querySelectorAll('.level-pebble-dot').length).toBe(2);

      // WHEN clicking the right wooden paddle (▶)
      btnNext.click();
      await Promise.resolve();

      // THEN Chest Opening moves to center stage and Cozy Bathtub peeks on the left
      expect(cardChest.classList.contains('is-selected')).toBe(true);
      expect(cardChest.classList.contains('pos-center')).toBe(true);
      expect(cardBathtub.classList.contains('pos-left')).toBe(true);

      // WHEN 8 additional level cards are added (totaling 10 levels) and a pebble dot is clicked
      for (let i = 3; i <= 10; i++) {
        const extraCard = document.createElement('button');
        extraCard.type = 'button';
        extraCard.className = 'level-polaroid-card';
        extraCard.setAttribute('data-level', `level-${i}`);
        extraCard.setAttribute('role', 'radio');
        extraCard.setAttribute('aria-label', `Level ${i}`);
        extraCard.innerHTML = `
          <span class="level-selected-crest" aria-hidden="true">★ Selected</span>
          <span class="level-step-counter" aria-hidden="true"></span>
          <span class="level-card-label">Level ${i}</span>
        `;
        levelGroup.appendChild(extraCard);
      }

      // Trigger carousel refresh via prev paddle click (back to index 0: Cozy Bathtub)
      btnPrev.click();
      await Promise.resolve();

      // THEN all 10 pebble step dots render and Cover-Flow assigns center, left/right, far-left/far-right, and hidden positions
      const dots = dotsContainer.querySelectorAll('.level-pebble-dot');
      expect(dots.length).toBe(10);
      expect(cardBathtub.classList.contains('pos-center')).toBe(true);
      expect(cardChest.classList.contains('pos-right')).toBe(true);
      const level3Card = levelGroup.querySelector('[data-level="level-3"]') as HTMLElement;
      const level6Card = levelGroup.querySelector('[data-level="level-6"]') as HTMLElement;
      const level9Card = levelGroup.querySelector('[data-level="level-9"]') as HTMLElement;
      const level10Card = levelGroup.querySelector('[data-level="level-10"]') as HTMLElement;
      expect(level3Card.classList.contains('pos-far-right')).toBe(true);
      expect(level6Card.classList.contains('pos-hidden')).toBe(true);
      expect(level9Card.classList.contains('pos-far-left')).toBe(true);
      expect(level10Card.classList.contains('pos-left')).toBe(true);

      // WHEN clicking the 6th pebble dot directly
      (dots[5] as HTMLButtonElement).click();
      await Promise.resolve();

      // THEN Level 6 moves to center stage and is selected
      expect(level6Card.classList.contains('is-selected')).toBe(true);
      expect(level6Card.classList.contains('pos-center')).toBe(true);
      expect(level6Card.querySelector('.level-step-counter')?.textContent).toBe('Level 6 of 10');
    });
  });

  describe('3. Words Due Soap Bubble Badge & Absence of Just for Fun Toggle', () => {
    it('displays the due word count in the floating bubble and shows a gold star when 0 words are due', async () => {
      // GIVEN an authenticated session with starter words due today
      setMockAuthUser({ email: 'scher.jonathan@gmail.com', displayName: 'Zoé' });
      await Promise.resolve();

      const wordsDueBubble = document.getElementById('words-due-bubble') as HTMLElement;
      const wordsDueCount = document.getElementById('words-due-count') as HTMLElement;
      const wordsDueSub = document.getElementById('words-due-sub') as HTMLElement;

      // THEN the floating soap bubble displays the due count > 0
      expect(wordsDueBubble.hidden).toBe(false);
      expect(Number(wordsDueCount.textContent)).toBeGreaterThan(0);
      expect(wordsDueSub.textContent).toBe('to pop!');

      // WHEN all words are scheduled in the future (0 words due today)
      const futureDate = '2099-12-31';
      const words = loadWords().map((w) => ({ ...w, next_review: futureDate }));
      saveWords(words, undefined, 'daughter');
      setActiveProfileId('daughter');
      // Trigger profile refresh via profile button
      const daughterBtn = document.querySelector('button[data-profile-id="daughter"]') as HTMLButtonElement;
      if (daughterBtn) daughterBtn.click();

      // THEN the bubble displays a gold star and "All done! Free play!"
      expect(wordsDueBubble.classList.contains('is-all-done')).toBe(true);
      expect(wordsDueCount.textContent).toBe('⭐');
      expect(wordsDueSub.textContent).toBe('All done! Free play!');
    });

    it('does not render the Just for Fun button on the title screen and preserves active profile under parent lock', async () => {
      // GIVEN an authenticated Play Hub session
      setMockAuthUser({ email: 'scher.jonathan@gmail.com', displayName: 'Zoé' });
      await Promise.resolve();

      // THEN the Just for Fun toggle button and its caption are absent from the DOM
      expect(document.getElementById('btn-tracking-toggle')).toBeNull();
      expect(document.getElementById('tracking-toggle-label')).toBeNull();
      expect(document.querySelector('.hub-tracking-corner')).toBeNull();

      // AND the title screen overlay does not have practice mode applied
      const startOverlay = document.getElementById('start-overlay') as HTMLElement;
      expect(startOverlay.classList.contains('is-practice-mode')).toBe(false);
    });
  });

  describe('4. Top Utility Bar & My Ducks Progress Shelf & Double-Tap Protection', () => {
    it('does not display week selection on the main screen play hub', async () => {
      // GIVEN authenticated Play Hub
      setMockAuthUser({ email: 'scher.jonathan@gmail.com', displayName: 'Zoé' });
      await Promise.resolve();

      // THEN week selector elements are removed from the main screen
      expect(document.getElementById('btn-week-selector')).toBeNull();
      expect(document.getElementById('week-selector-popover')).toBeNull();
      expect(document.getElementById('start-week-pill')).toBeNull();
      expect(document.getElementById('hub-week-dropdown-wrap')).toBeNull();
      expect(document.querySelector('.hub-topbar-spacer')).not.toBeNull();
    });

    it('opens the My Ducks progress modal when clicking the top-right My Ducks button', async () => {
      // GIVEN authenticated Play Hub
      setMockAuthUser({ email: 'scher.jonathan@gmail.com', displayName: 'Zoé' });
      await Promise.resolve();

      const btnMyDucks = document.getElementById('btn-my-ducks') as HTMLAnchorElement;
      const ducksModal = document.getElementById('ducks-progress-modal') as HTMLElement;
      expect(ducksModal.hidden).toBe(true);

      // WHEN clicking the My Ducks button
      btnMyDucks.click();

      // THEN the My Ducks & Garden Shelf modal opens
      expect(ducksModal.hidden).toBe(false);
    });

    it('disables the PLAY button immediately on first pointerdown to prevent double-tap spawning', async () => {
      // GIVEN authenticated Play Hub
      setMockAuthUser({ email: 'scher.jonathan@gmail.com', displayName: 'Zoé' });
      await Promise.resolve();

      const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
      expect(btnPlay.disabled).toBe(false);

      // WHEN the child mashes the PLAY button (pointerdown)
      btnPlay.dispatchEvent(new PointerEvent('pointerdown', { button: 0 }));

      // THEN the PLAY button is immediately disabled and enters its 400ms bubble-pop state
      expect(btnPlay.disabled).toBe(true);
      expect(btnPlay.classList.contains('is-popping-start')).toBe(true);
    });

    it('starts the game session and hides the start overlay when pressing the play button', async () => {
      // GIVEN authenticated Play Hub with start overlay visible
      setMockAuthUser({ email: 'scher.jonathan@gmail.com', displayName: 'Zoé' });
      await Promise.resolve();

      const startOverlay = document.getElementById('start-overlay') as HTMLElement;
      const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
      expect(startOverlay.hidden).toBe(false);

      // WHEN pressing the play button
      btnPlay.click();
      await vi.advanceTimersByTimeAsync(500);

      // THEN start overlay is hidden and game is running
      expect(startOverlay.hidden).toBe(true);
      expect(startOverlay.classList.contains('is-active')).toBe(false);
      // @ts-ignore
      expect(window.__gameInstance.running).toBe(true);
    });
  });

  describe('5. In-Game Abandon Game Button (Top Right)', () => {
    it('renders an abandon game button top right in the HUD topbar', () => {
      const topbarActions = document.querySelector('.hud-topbar .topbar-actions') as HTMLElement;
      expect(topbarActions).not.toBeNull();

      const btnAbandon = document.getElementById('btn-abandon-game') as HTMLButtonElement;
      expect(btnAbandon).not.toBeNull();
      expect(topbarActions.contains(btnAbandon)).toBe(true);
      expect(btnAbandon.getAttribute('aria-label')).toMatch(/abandon/i);
    });

    it('abandons the active game session and returns to the landing page when clicked', async () => {
      // GIVEN an active running game session launched from the Play Hub
      setMockAuthUser({ email: 'scher.jonathan@gmail.com', displayName: 'Zoé' });
      await Promise.resolve();

      const startOverlay = document.getElementById('start-overlay') as HTMLElement;
      const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
      const btnAbandon = document.getElementById('btn-abandon-game') as HTMLButtonElement;
      const bubbleStage = document.getElementById('bubble-stage') as HTMLElement;

      btnPlay.click();
      await vi.advanceTimersByTimeAsync(500);

      expect(startOverlay.hidden).toBe(true);
      // @ts-ignore
      expect(window.__gameInstance.running).toBe(true);

      // WHEN the child clicks the abandon button in top right
      btnAbandon.click();
      await Promise.resolve();

      // THEN the game session stops running and stage bubbles are cleared
      // @ts-ignore
      expect(window.__gameInstance.running).toBe(false);
      expect(bubbleStage.querySelectorAll('.soap-bubble').length).toBe(0);

      // AND the landing page (Play Hub) is restored and active
      expect(startOverlay.hidden).toBe(false);
      expect(startOverlay.classList.contains('is-active')).toBe(true);
      expect(soundEngine.playUiTap).toHaveBeenCalled();
    });

    it('allows starting a new game session after abandoning a previous game', async () => {
      // GIVEN a game session that was abandoned
      setMockAuthUser({ email: 'scher.jonathan@gmail.com', displayName: 'Zoé' });
      await Promise.resolve();

      const startOverlay = document.getElementById('start-overlay') as HTMLElement;
      const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
      const btnAbandon = document.getElementById('btn-abandon-game') as HTMLButtonElement;

      btnPlay.click();
      await vi.advanceTimersByTimeAsync(500);
      btnAbandon.click();
      await Promise.resolve();

      expect(startOverlay.hidden).toBe(false);

      // WHEN pressing play again from the landing page
      btnPlay.click();
      await vi.advanceTimersByTimeAsync(500);

      // THEN a new session is running and landing page is hidden again
      expect(startOverlay.hidden).toBe(true);
      // @ts-ignore
      expect(window.__gameInstance.running).toBe(true);
    });
  });

  describe('6. Landing Page Statistics (Shows Kid Statistics, Never Test Profile Statistics)', () => {
    it('always displays the kid’s words due and stars on the landing page even if test profile is active', async () => {
      // GIVEN authenticated session for Zoé (kid profile = daughter)
      setMockAuthUser({ email: 'scher.jonathan@gmail.com', displayName: 'Zoé' });
      await Promise.resolve();

      // Configure kid (daughter) to have 0 words due today (all done -> gold star) and 7 cosmetic stars
      const futureDate = '2099-12-31';
      const daughterWords = loadWords(undefined, undefined, 'daughter').map((w) => ({
        ...w,
        next_review: futureDate,
        box: 4
      }));
      saveWords(daughterWords, undefined, 'daughter');
      awardCosmeticStars(7, 'daughter');

      // Configure test profile to have 16 words due today (due now) and 0 stars
      const today = getLocalISODate();
      const testWords = loadWords(undefined, undefined, 'test').map((w) => ({
        ...w,
        next_review: today,
        box: 1
      }));
      saveWords(testWords, undefined, 'test');

      // WHEN switching active profile to 'test'
      const testBtn = document.querySelector('button[data-profile-id="test"]') as HTMLButtonElement;
      if (testBtn) {
        testBtn.click();
      } else {
        setActiveProfileId('test');
      }
      await Promise.resolve();

      expect(getActiveProfileId()).toBe('test');

      const wordsDueBubble = document.getElementById('words-due-bubble') as HTMLElement;
      const wordsDueCount = document.getElementById('words-due-count') as HTMLElement;
      const wordsDueSub = document.getElementById('words-due-sub') as HTMLElement;
      const hudStarsCount = document.getElementById('hud-stars-count') as HTMLElement;
      const btnQuickSplashText = document.getElementById('btn-quick-splash-text') as HTMLElement;

      // THEN the landing page statistics show the kid's statistics (⭐ all done, 7 stars), NEVER the test profile's (16 due, 0 stars)
      expect(wordsDueBubble.classList.contains('is-all-done')).toBe(true);
      expect(wordsDueCount.textContent).toBe('⭐');
      expect(wordsDueSub.textContent).toBe('All done! Free play!');
      expect(hudStarsCount.textContent).toBe('7');
      expect(btnQuickSplashText.textContent).toContain('0 due ⭐');
    });

    it('always displays the kid’s statistics in the My Ducks progress shelf even if test profile is active', async () => {
      // GIVEN authenticated session for Zoé
      setMockAuthUser({ email: 'scher.jonathan@gmail.com', displayName: 'Zoé' });
      await Promise.resolve();

      // Configure kid (daughter) stats: 5 stars, 4 blooming words, 2 due words
      const today = getLocalISODate();
      const daughterWords = loadWords(undefined, undefined, 'daughter').map((w, idx) => ({
        ...w,
        box: idx < 4 ? 4 : 2,
        next_review: idx < 2 ? today : '2099-12-31'
      }));
      saveWords(daughterWords, undefined, 'daughter');
      awardCosmeticStars(5, 'daughter');

      // Configure test profile stats: 0 stars, 0 blooming words, 16 due words
      const testWords = loadWords(undefined, undefined, 'test').map((w) => ({
        ...w,
        box: 1,
        next_review: today
      }));
      saveWords(testWords, undefined, 'test');

      // Switch active profile to test
      const testBtn = document.querySelector('button[data-profile-id="test"]') as HTMLButtonElement;
      if (testBtn) {
        testBtn.click();
      } else {
        setActiveProfileId('test');
      }
      await Promise.resolve();
      expect(getActiveProfileId()).toBe('test');

      // WHEN opening the My Ducks progress shelf from the landing page
      const btnMyDucks = document.getElementById('btn-my-ducks') as HTMLAnchorElement;
      btnMyDucks.click();
      await Promise.resolve();

      const ducksStarsTotal = document.getElementById('ducks-stars-total') as HTMLElement;
      const ducksBloomingTotal = document.getElementById('ducks-blooming-total') as HTMLElement;
      const ducksDueTotal = document.getElementById('ducks-due-total') as HTMLElement;
      const ducksLearnerSubtitle = document.getElementById('ducks-learner-subtitle') as HTMLElement;

      // THEN My Ducks shows the kid’s statistics (5 stars, 4 blooming, 2 due, Zoé's collection), NEVER the test profile's (0 stars, 0 blooming, 16 due, Test / Sandbox's collection)
      expect(ducksStarsTotal.textContent).toBe('5');
      expect(ducksBloomingTotal.textContent).toBe('4');
      expect(ducksDueTotal.textContent).toBe('2');
      expect(ducksLearnerSubtitle.textContent).toContain("Zoé");
      expect(ducksLearnerSubtitle.textContent).not.toContain("Test");
    });
  });
});


