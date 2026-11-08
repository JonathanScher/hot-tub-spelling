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
  setActiveProfileId
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
  });

  describe('3. Words Due Soap Bubble Badge & Sleep Mask Tracking Toggle', () => {
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

    it('toggles Secret Practice ("Just for Fun") via the white cat sleep mask and auto-resets the next day', async () => {
      // GIVEN a stale "Just for Fun" tracking state saved from yesterday
      localStorage.setItem(
        'hottub_tracking_mode_v1',
        JSON.stringify({ practiceMode: true, date: '2000-01-01' })
      );

      // Re-initialize app on a new day
      document.documentElement.innerHTML = sanitizedHtml;
      document.dispatchEvent(new Event('DOMContentLoaded'));
      setMockAuthUser({ email: 'scher.jonathan@gmail.com', displayName: 'Zoé' });
      await Promise.resolve();

      const startOverlay = document.getElementById('start-overlay') as HTMLElement;
      const btnTrackingToggle = document.getElementById('btn-tracking-toggle') as HTMLButtonElement;
      const trackingToggleLabel = document.getElementById('tracking-toggle-label') as HTMLElement;
      const wordsDueBubble = document.getElementById('words-due-bubble') as HTMLElement;

      // THEN it automatically resets back to "Counting: ON" for today
      expect(btnTrackingToggle.getAttribute('aria-checked')).toBe('false');
      expect(trackingToggleLabel.textContent).toBe('Counting: ON');
      expect(startOverlay.classList.contains('is-practice-mode')).toBe(false);
      expect(wordsDueBubble.hidden).toBe(false);

      // WHEN toggling the white cat's pink sleep mask ON
      btnTrackingToggle.click();
      await Promise.resolve();

      // THEN label updates to "Just for Fun", twilight filter class is applied, and due bubble hides
      expect(btnTrackingToggle.getAttribute('aria-checked')).toBe('true');
      expect(trackingToggleLabel.textContent).toBe('Just for Fun');
      expect(startOverlay.classList.contains('is-practice-mode')).toBe(true);
      expect(wordsDueBubble.hidden).toBe(true);
      expect(soundEngine.playSleepMaskToggle).toHaveBeenCalledWith(true);
    });

    it('launches the game with test profile when "Just for Fun" is selected and restores learner profile when toggled off', async () => {
      // GIVEN an authenticated session with active profile set to 'daughter'
      setMockAuthUser({ email: 'scher.jonathan@gmail.com', displayName: 'Zoé' });
      await Promise.resolve();
      setActiveProfileId('daughter');
      expect(getActiveProfileId()).toBe('daughter');

      const btnTrackingToggle = document.getElementById('btn-tracking-toggle') as HTMLButtonElement;
      const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;

      // WHEN "Just for Fun" is selected
      btnTrackingToggle.click();
      await Promise.resolve();

      // AND the game is launched
      btnPlay.click();
      await vi.advanceTimersByTimeAsync(500);

      // THEN the game launches with the test profile
      expect(getActiveProfileId()).toBe('test');

      // WHEN "Just for Fun" is toggled off (Counting: ON)
      btnTrackingToggle.click();
      await Promise.resolve();

      // THEN the learner profile is restored
      expect(getActiveProfileId()).toBe('daughter');
    });
  });

  describe('4. Top Utility Bar (Week Selector Grid & My Ducks Progress Shelf) & Double-Tap Protection', () => {
    it('opens the numbered wooden week tiles grid and updates the active week on selection', async () => {
      // GIVEN authenticated Play Hub
      setMockAuthUser({ email: 'scher.jonathan@gmail.com', displayName: 'Zoé' });
      await Promise.resolve();

      const btnWeekSelector = document.getElementById('btn-week-selector') as HTMLButtonElement;
      const weekPopover = document.getElementById('week-selector-popover') as HTMLElement;
      const startWeekPill = document.getElementById('start-week-pill') as HTMLElement;

      expect(weekPopover.hidden).toBe(true);

      // WHEN clicking the top-left Week pill
      btnWeekSelector.click();

      // THEN the numbered wooden tiles grid opens
      expect(weekPopover.hidden).toBe(false);
      const week4Tile = document.querySelector('.week-wood-tile[data-week-label="Week 4"]') as HTMLButtonElement;
      expect(week4Tile).not.toBeNull();

      // WHEN clicking tile "4"
      week4Tile.click();

      // THEN the popover closes and the top-left pill updates to "Week 4"
      expect(weekPopover.hidden).toBe(true);
      expect(startWeekPill.textContent).toBe('Week 4');
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
});
