// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HotTubGame } from '../../js/game.js';

describe('DOM Presentation & View Controller (Executable Specification for js/game.js)', () => {
  let container: HTMLDivElement;
  let bubbleStage: HTMLDivElement;
  let slotsContainer: HTMLDivElement;
  let flyingLayer: HTMLDivElement;
  let mascotWrap: HTMLDivElement;
  let mascotSpeech: HTMLDivElement;
  let hintButton: HTMLButtonElement;
  let progressFill: HTMLDivElement;
  let progressLabel: HTMLDivElement;
  let retryBadge: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();

    container = document.createElement('div');
    document.body.appendChild(container);

    bubbleStage = document.createElement('div');
    bubbleStage.id = 'bubble-stage';
    // Mock stage geometry
    Object.defineProperty(bubbleStage, 'getBoundingClientRect', {
      value: () => ({ width: 360, height: 500, top: 0, left: 0, right: 360, bottom: 500 })
    });

    slotsContainer = document.createElement('div');
    slotsContainer.id = 'word-slots';

    flyingLayer = document.createElement('div');
    flyingLayer.id = 'flying-layer';

    mascotWrap = document.createElement('div');
    mascotWrap.id = 'mascot-wrap';

    mascotSpeech = document.createElement('div');
    mascotSpeech.id = 'mascot-speech';

    hintButton = document.createElement('button');
    hintButton.id = 'btn-hint';

    progressFill = document.createElement('div');
    progressFill.id = 'progress-fill';

    progressLabel = document.createElement('div');
    progressLabel.id = 'progress-label';

    retryBadge = document.createElement('div');
    retryBadge.id = 'retry-badge';

    container.appendChild(bubbleStage);
    container.appendChild(slotsContainer);
    container.appendChild(flyingLayer);
    container.appendChild(mascotWrap);
    container.appendChild(mascotSpeech);
    container.appendChild(hintButton);
    container.appendChild(progressFill);
    container.appendChild(progressLabel);
    container.appendChild(retryBadge);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    container.remove();
  });

  describe('1. DOM Word Slots & Watermark Rendering', () => {
    it('creates matching letter slots with empty character containers on word start', () => {
      // GIVEN a game instance with French target word "câlin" (5 letters)
      const game = new HotTubGame({
        bubbleStage,
        slotsContainer,
        flyingLayer,
        hintButton,
        progressFill,
        progressLabel,
        retryBadge,
        seed: 42
      });

      // WHEN starting a session
      game.startSession([{ word: 'câlin', week_label: 'Week 8' }]);

      // THEN slotsContainer contains exactly 5 .letter-slot elements
      const slots = slotsContainer.querySelectorAll('.letter-slot');
      expect(slots.length).toBe(5);

      // The first slot is marked current, others not current
      expect(slots[0].classList.contains('is-current')).toBe(true);
      expect(slots[1].classList.contains('is-current')).toBe(false);

      // Slot watermarks exist and display target character
      const watermark = slots[0].querySelector('.slot-watermark') as HTMLElement;
      expect(watermark).not.toBeNull();
      expect(watermark.textContent).toBe('c');
      // Watermark is initially hidden until hint or error threshold
      expect(slots[0].classList.contains('show-watermark')).toBe(false);

      game.stop();
    });

    it('activates watermark visibility on slots when Hint button is triggered', () => {
      // GIVEN an active game session on "loin"
      const game = new HotTubGame({
        bubbleStage,
        slotsContainer,
        flyingLayer,
        hintButton,
        seed: 123
      });
      game.startSession([{ word: 'loin', week_label: 'Week 8' }]);

      expect(game.watermarkActive).toBe(false);

      // WHEN clicking the hint button
      game.useHintButton();

      // THEN watermark state is active on the game and show-watermark is added to slots
      expect(game.watermarkActive).toBe(true);
      expect(game.wordErrorCount).toBe(1);

      const activeSlot = slotsContainer.querySelector('.letter-slot.is-current');
      expect(activeSlot?.classList.contains('show-watermark')).toBe(true);

      game.stop();
    });

    it('applies slot-gentle-shake and is-wrong-fizzle classes when a wrong bubble is tapped', () => {
      // GIVEN an active session where required character is 'l'
      const game = new HotTubGame({
        bubbleStage,
        slotsContainer,
        seed: 77
      });
      game.startSession([{ word: 'loin', week_label: 'Week 8' }]);

      // Find a non-matching bubble
      const wrongBubble = game.bubbles.find((b) => b.char !== 'l')!;
      expect(wrongBubble).toBeDefined();

      const activeSlot = slotsContainer.querySelector('.letter-slot.is-current') as HTMLElement;
      expect(activeSlot.classList.contains('slot-gentle-shake')).toBe(false);

      // WHEN tapping the wrong bubble
      game._handleBubbleTap(wrongBubble);

      // THEN the active slot gets the .slot-gentle-shake CSS class and bubble gets .is-wrong-fizzle
      expect(activeSlot.classList.contains('slot-gentle-shake')).toBe(true);
      expect(game.wordErrorCount).toBe(1);
      expect(game.letterErrorCount).toBe(1);
      expect(wrongBubble.state).toBe('fizzling');
      expect(wrongBubble.el.classList.contains('is-wrong-fizzle')).toBe(true);

      game.stop();
    });
  });

  describe('2. Bubble DOM Element Spawning & Pooling', () => {
    it('appends soap-bubble button elements with valid styles into bubbleStage', () => {
      // GIVEN an active game session
      const game = new HotTubGame({
        bubbleStage,
        slotsContainer,
        seed: 55
      });

      // WHEN session starts
      game.startSession([{ word: 'sans', week_label: 'Week 7' }]);

      // THEN 5 bubble elements are appended inside bubbleStage
      const bubbleElements = bubbleStage.querySelectorAll('.soap-bubble');
      expect(bubbleElements.length).toBe(5);

      bubbleElements.forEach((el) => {
        expect(el.tagName).toBe('BUTTON');
        expect(el.querySelector('.bubble-char')).not.toBeNull();
      });

      game.stop();
    });

    it('clears all bubbles from stage when stop() is called', () => {
      // GIVEN an active session with floating bubbles
      const game = new HotTubGame({
        bubbleStage,
        slotsContainer,
        seed: 10
      });
      game.startSession([{ word: 'sans', week_label: 'Week 7' }]);
      expect(bubbleStage.querySelectorAll('.soap-bubble').length).toBeGreaterThan(0);

      // WHEN game is stopped
      game.stop();

      // THEN all bubble elements are removed from DOM and running is false
      expect(bubbleStage.querySelectorAll('.soap-bubble').length).toBe(0);
      expect(game.running).toBe(false);
      expect(game.bubbles.length).toBe(0);
    });
  });

  describe('3. Mascot Reactions & Stage Clamping', () => {
    it('nods the mascot with mascot-nod class on correct bubble tap', () => {
      // GIVEN an active session on "soleil"
      const game = new HotTubGame({
        bubbleStage,
        slotsContainer,
        mascotWrap,
        mascotSpeech,
        seed: 88
      });
      game.startSession([{ word: 'soleil', week_label: 'Week 7' }]);

      // Find the required 's' bubble
      const sBubble = game.bubbles.find((b) => b.char === 's')!;
      expect(sBubble).toBeDefined();

      // WHEN correctly tapping 's'
      game._handleBubbleTap(sBubble);

      // THEN mascotWrap receives the .mascot-nod animation class
      expect(mascotWrap.classList.contains('mascot-nod')).toBe(true);
      expect(sBubble.state).toBe('popping');

      game.stop();
    });

    it('clamps bubble horizontal coordinates within stage bounds on resize', () => {
      // GIVEN a game with active bubbles
      const game = new HotTubGame({
        bubbleStage,
        slotsContainer,
        seed: 33
      });
      game.startSession([{ word: 'câlin', week_label: 'Week 8' }]);

      // Push a bubble way out of bounds
      game.bubbles[0].baseX = 9999;
      game.bubbles[0].x = 9999;

      // WHEN resize clamp is triggered
      game._clampBubblesToStage();

      // THEN baseX is clamped within safe horizontal bounds of the stage
      expect(game.bubbles[0].baseX).toBeLessThanOrEqual(360);
      expect(game.bubbles[0].baseX).toBeGreaterThanOrEqual(0);

      game.stop();
    });
  });
});
