// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { clearMemoryStorage, CURRENT_WEEK_KEY } from '../../js/srs.js';

const rawHtml = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
// Strip external stylesheet links to prevent happy-dom network warnings
const sanitizedHtml = rawHtml.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, '');

describe('Application Shell, Navigation & Parent Math Gate (Executable Specification for js/app.js)', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    clearMemoryStorage();
    localStorage.clear();

    // Populate DOM from sanitized index.html
    document.documentElement.innerHTML = sanitizedHtml;

    // Trigger DOMContentLoaded to invoke initApp() in js/app.js
    await import('../../js/app.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('1. Parent Math Gate PIN Challenge', () => {
    it('opens the math gate modal on brief tap and presents an addition challenge a + b', () => {
      // GIVEN the welcome screen is visible and math gate modal is hidden
      const btnParentLock = document.getElementById('btn-parent-lock') as HTMLElement;
      const mathGateModal = document.getElementById('math-gate-modal') as HTMLElement;
      const mathQuestionLabel = document.getElementById('math-question-label') as HTMLElement;
      expect(btnParentLock).not.toBeNull();
      expect(mathGateModal.hidden).toBe(true);

      // WHEN tapping the parent lock button briefly (< 2 seconds)
      btnParentLock.dispatchEvent(new Event('pointerdown'));
      btnParentLock.dispatchEvent(new Event('pointerup'));

      // THEN math gate modal becomes visible
      expect(mathGateModal.hidden).toBe(false);

      // And displays a valid math question in the form "a + b = ?" where a, b >= 5
      const text = mathQuestionLabel.textContent || '';
      const match = text.match(/(\d+)\s*\+\s*(\d+)\s*=\s*\?/);
      expect(match).not.toBeNull();
      const a = parseInt(match![1], 10);
      const b = parseInt(match![2], 10);
      expect(a).toBeGreaterThanOrEqual(6);
      expect(b).toBeGreaterThanOrEqual(5);
    });

    it('rejects incorrect answers with an error message and keeps parent dashboard locked', () => {
      // GIVEN math gate modal is open
      const btnParentLock = document.getElementById('btn-parent-lock') as HTMLElement;
      const mathGateModal = document.getElementById('math-gate-modal') as HTMLElement;
      const formMathGate = document.getElementById('form-math-gate') as HTMLFormElement;
      const inputMathAnswer = document.getElementById('input-math-answer') as HTMLInputElement;
      const mathGateError = document.getElementById('math-gate-error') as HTMLElement;
      const parentModal = document.getElementById('parent-modal') as HTMLElement;

      btnParentLock.dispatchEvent(new Event('pointerdown'));
      btnParentLock.dispatchEvent(new Event('pointerup'));
      expect(mathGateModal.hidden).toBe(false);

      // WHEN submitting an incorrect answer (e.g. 9999)
      inputMathAnswer.value = '9999';
      formMathGate.dispatchEvent(new Event('submit'));

      // THEN error message is shown, input is cleared, and parent modal remains locked (hidden)
      expect(mathGateError.hidden).toBe(false);
      expect(inputMathAnswer.value).toBe('');
      expect(parentModal.hidden).toBe(true);
    });

    it('unlocks the parent dashboard modal when the exact sum is entered', () => {
      // GIVEN math gate modal is open with an active challenge
      const btnParentLock = document.getElementById('btn-parent-lock') as HTMLElement;
      const mathGateModal = document.getElementById('math-gate-modal') as HTMLElement;
      const mathQuestionLabel = document.getElementById('math-question-label') as HTMLElement;
      const formMathGate = document.getElementById('form-math-gate') as HTMLFormElement;
      const inputMathAnswer = document.getElementById('input-math-answer') as HTMLInputElement;
      const parentModal = document.getElementById('parent-modal') as HTMLElement;

      btnParentLock.dispatchEvent(new Event('pointerdown'));
      btnParentLock.dispatchEvent(new Event('pointerup'));

      const text = mathQuestionLabel.textContent || '';
      const match = text.match(/(\d+)\s*\+\s*(\d+)\s*=\s*\?/);
      expect(match).not.toBeNull();
      const correctSum = parseInt(match![1], 10) + parseInt(match![2], 10);

      // WHEN submitting the correct sum
      inputMathAnswer.value = String(correctSum);
      formMathGate.dispatchEvent(new Event('submit'));

      // THEN math gate modal closes and parent dashboard unlocks
      expect(mathGateModal.hidden).toBe(true);
      expect(parentModal.hidden).toBe(false);
    });
  });

  describe('2. Learner Profile Switching & Local Development Protection', () => {
    it('defaults to Test profile in local development, allows switching to Zoé, and toggles sandbox banner', () => {
      // GIVEN Welcome profile buttons (on localhost, starts in safe Test Sandbox profile)
      const btnTest = document.querySelector('button[data-profile-id="test"]') as HTMLButtonElement;
      const btnDaughter = document.querySelector('button[data-profile-id="daughter"]') as HTMLButtonElement;
      const testModeBanner = document.getElementById('test-mode-banner') as HTMLElement;
      expect(btnTest).not.toBeNull();
      expect(btnDaughter).not.toBeNull();

      // Localhost auto-protection defaults active profile to Test
      expect(testModeBanner.hidden).toBe(false);
      expect(btnTest.classList.contains('is-active')).toBe(true);

      // WHEN switching to primary learner Zoé
      btnDaughter.click();

      // THEN testModeBanner is hidden and re-rendered Zoé button has is-active
      expect(testModeBanner.hidden).toBe(true);
      const newDaughterBtn = document.querySelector('button[data-profile-id="daughter"]') as HTMLButtonElement;
      const newTestBtn = document.querySelector('button[data-profile-id="test"]') as HTMLButtonElement;
      expect(newDaughterBtn.classList.contains('is-active')).toBe(true);
      expect(newTestBtn.classList.contains('is-active')).toBe(false);

      // WHEN switching back to Test Sandbox profile
      newTestBtn.click();

      // THEN testModeBanner is restored
      expect(testModeBanner.hidden).toBe(false);
      const finalTestBtn = document.querySelector('button[data-profile-id="test"]') as HTMLButtonElement;
      expect(finalTestBtn.classList.contains('is-active')).toBe(true);
    });
  });

  describe('3. Parent Dashboard Dismissal', () => {
    it('closes the parent dashboard when clicking the close button', () => {
      // GIVEN Parent Dashboard is open
      const parentModal = document.getElementById('parent-modal') as HTMLElement;
      const btnCloseParent = document.getElementById('btn-close-parent') as HTMLElement;
      parentModal.hidden = false;

      // WHEN clicking close button
      btnCloseParent.click();

      // THEN parent modal is hidden
      expect(parentModal.hidden).toBe(true);
    });
  });

  describe('4. Active Week Selection in Parent Dashboard', () => {
    function unlockParentDashboard() {
      const btnParentLock = document.getElementById('btn-parent-lock') as HTMLElement;
      const mathQuestionLabel = document.getElementById('math-question-label') as HTMLElement;
      const formMathGate = document.getElementById('form-math-gate') as HTMLFormElement;
      const inputMathAnswer = document.getElementById('input-math-answer') as HTMLInputElement;

      btnParentLock.dispatchEvent(new Event('pointerdown'));
      btnParentLock.dispatchEvent(new Event('pointerup'));

      const text = mathQuestionLabel.textContent || '';
      const match = text.match(/(\d+)\s*\+\s*(\d+)\s*=\s*\?/);
      const correctSum = parseInt(match![1], 10) + parseInt(match![2], 10);

      inputMathAnswer.value = String(correctSum);
      formMathGate.dispatchEvent(new Event('submit'));
    }

    it('renders the active week badge and quick week selection chips when dashboard opens', () => {
      // GIVEN parent dashboard is unlocked
      unlockParentDashboard();

      const activeBadge = document.getElementById('parent-active-week-badge') as HTMLElement;
      const weekSelect = document.getElementById('parent-week-select') as HTMLSelectElement;
      const weekChips = document.getElementById('parent-week-chips') as HTMLElement;

      expect(activeBadge).not.toBeNull();
      expect(weekSelect).not.toBeNull();
      expect(weekChips).not.toBeNull();

      // Starts with default active week (e.g. Week 8)
      expect(activeBadge.textContent).toContain('Active:');
      expect(weekSelect.options.length).toBeGreaterThan(0);
      expect(weekChips.children.length).toBeGreaterThan(0);
    });

    it('updates active week in storage and badge when clicking a week chip', () => {
      unlockParentDashboard();

      const activeBadge = document.getElementById('parent-active-week-badge') as HTMLElement;
      const week7Chip = document.querySelector('.parent-week-chip[data-week-label="Week 7"]') as HTMLButtonElement;
      expect(week7Chip).not.toBeNull();

      // WHEN clicking Week 7 chip
      week7Chip.click();

      // THEN active week badge and storage update to Week 7
      expect(activeBadge.textContent).toBe('Active: Week 7');
      expect(localStorage.getItem(CURRENT_WEEK_KEY)).toBe('Week 7');
      const activeChip = document.querySelector('.parent-week-chip[data-week-label="Week 7"]') as HTMLButtonElement;
      expect(activeChip.classList.contains('is-active')).toBe(true);

      const weekSelect = document.getElementById('parent-week-select') as HTMLSelectElement;
      expect(weekSelect.value).toBe('Week 7');
    });

    it('updates active week when choosing a week from the select dropdown', () => {
      unlockParentDashboard();

      const activeBadge = document.getElementById('parent-active-week-badge') as HTMLElement;
      const weekSelect = document.getElementById('parent-week-select') as HTMLSelectElement;

      // WHEN changing select to Week 4
      weekSelect.value = 'Week 4';
      weekSelect.dispatchEvent(new Event('change'));

      // THEN active week updates to Week 4
      expect(activeBadge.textContent).toBe('Active: Week 4');
      expect(localStorage.getItem(CURRENT_WEEK_KEY)).toBe('Week 4');

      const week4Chip = document.querySelector('.parent-week-chip[data-week-label="Week 4"]') as HTMLButtonElement;
      expect(week4Chip.classList.contains('is-active')).toBe(true);
    });
  });
});
