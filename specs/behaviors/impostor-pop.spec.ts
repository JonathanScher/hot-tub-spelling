import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  createGameState,
  stepGame,
  spawnBubbleOnState,
  handleBubbleFlickOnState,
  handleBubbleTapOnState,
  type GameState,
  type BubbleEntity
} from '../../js/game-core.js';
import { HotTubGame } from '../../js/game.js';

describe('Impostor Pop: Distractor Flicking & Impulse Control Mechanics', () => {
  describe('Headless Game Core: Distractor Flick Action (`FLICK_BUBBLE`)', () => {
    it('removes a distractor bubble without triggering an error tap penalty', () => {
      // GIVEN a session with the word "enfin" (current required char 'e' at index 0)
      let state = createGameState({
        sessionWords: [{ word: 'enfin' }],
        seed: 123
      });
      expect(state.currentIndex).toBe(0);
      expect(state.targetChars[0]).toBe('e');
      expect(state.wordErrorCount).toBe(0);
      expect(state.letterErrorCount).toBe(0);

      // Inject an obvious phonetic distractor 'm' (nasal trap for enfin)
      const distractor = spawnBubbleOnState(state)!;
      distractor.char = 'm';

      // WHEN flicking the distractor bubble away
      const nextState = stepGame(state, { type: 'FLICK_BUBBLE', bubbleId: distractor.id });

      // THEN the distractor is removed from floating bubbles
      const found = nextState.bubbles.find((b) => b.id === distractor.id && b.state === 'floating');
      expect(found).toBeUndefined();

      // AND NO error tap penalty is assessed
      expect(nextState.wordErrorCount).toBe(0);
      expect(nextState.letterErrorCount).toBe(0);
      expect(nextState.watermarkActive).toBe(false);
      expect(nextState.currentIndex).toBe(0);

      // AND impulse control / combo is rewarded
      expect(nextState.combo).toBe(1);
      expect(nextState.impostorCombo).toBe(1);
      expect(nextState.impostorPops).toBe(1);
    });

    it('contrasts tapping vs flicking: tapping a distractor incurs errors while flicking rewards combo', () => {
      // GIVEN word "enfin" with two distractor bubbles 'm' and 'z'
      let state = createGameState({
        sessionWords: [{ word: 'enfin' }],
        seed: 456
      });

      const distractorM = spawnBubbleOnState(state)!;
      distractorM.char = 'm';
      const distractorZ = spawnBubbleOnState(state)!;
      distractorZ.char = 'z';

      // WHEN tapping the distractor 'm'
      const afterWrongTap = stepGame(state, { type: 'TAP_BUBBLE', bubbleId: distractorM.id });

      // THEN error counts are penalized and combo is 0
      expect(afterWrongTap.wordErrorCount).toBe(1);
      expect(afterWrongTap.letterErrorCount).toBe(1);
      expect(afterWrongTap.combo).toBe(0);
      expect(afterWrongTap.impostorCombo).toBe(0);

      // WHEN flicking the second distractor 'z'
      const afterFlick = stepGame(afterWrongTap, { type: 'FLICK_BUBBLE', bubbleId: distractorZ.id });

      // THEN no extra error is added and combo increments
      expect(afterFlick.wordErrorCount).toBe(1);
      expect(afterFlick.letterErrorCount).toBe(1);
      expect(afterFlick.combo).toBe(1);
      expect(afterFlick.impostorCombo).toBe(1);
      expect(afterFlick.impostorPops).toBe(1);
    });

    it('builds combo streaks across consecutive distractor flicks and tracks maxCombo', () => {
      // GIVEN an active session
      let state = createGameState({
        sessionWords: [{ word: 'maison' }],
        seed: 789
      });
      // Target char is 'm'
      expect(state.targetChars[state.currentIndex]).toBe('m');

      // Inject 3 distinct distractors: 'z', 'b', 'p'
      const d1 = spawnBubbleOnState(state)!;
      d1.char = 'z';
      const d2 = spawnBubbleOnState(state)!;
      d2.char = 'b';
      const d3 = spawnBubbleOnState(state)!;
      d3.char = 'p';

      // WHEN flicking each distractor consecutively
      state = stepGame(state, { type: 'FLICK_BUBBLE', bubbleId: d1.id });
      expect(state.impostorCombo).toBe(1);
      expect(state.combo).toBe(1);

      state = stepGame(state, { type: 'FLICK_BUBBLE', bubbleId: d2.id });
      expect(state.impostorCombo).toBe(2);
      expect(state.combo).toBe(2);

      state = stepGame(state, { type: 'FLICK_BUBBLE', bubbleId: d3.id });
      expect(state.impostorCombo).toBe(3);
      expect(state.combo).toBe(3);
      expect(state.impostorPops).toBe(3);
      expect(state.maxCombo).toBe(3);
      expect(state.wordErrorCount).toBe(0);
    });

    it('resets combo on wrong bubble tap, but preserves maxCombo', () => {
      let state = createGameState({
        sessionWords: [{ word: 'loin' }],
        seed: 321
      });

      const d1 = spawnBubbleOnState(state)!;
      d1.char = 'x';
      const d2 = spawnBubbleOnState(state)!;
      d2.char = 'k';

      state = stepGame(state, { type: 'FLICK_BUBBLE', bubbleId: d1.id });
      state = stepGame(state, { type: 'FLICK_BUBBLE', bubbleId: d2.id });
      expect(state.combo).toBe(2);
      expect(state.maxCombo).toBe(2);

      // Now wrongly tap another distractor 'w'
      const d3 = spawnBubbleOnState(state)!;
      d3.char = 'w';
      state = stepGame(state, { type: 'TAP_BUBBLE', bubbleId: d3.id });

      // Combo is reset, but maxCombo persists
      expect(state.combo).toBe(0);
      expect(state.impostorCombo).toBe(0);
      expect(state.maxCombo).toBe(2);
      expect(state.wordErrorCount).toBe(1);
    });

    it('flicks away the target letter, resets combo to 0, and applies no SRS error penalty', () => {
      // GIVEN word "enfin", target required char is 'e'
      let state = createGameState({
        sessionWords: [{ word: 'enfin' }],
        seed: 999
      });

      // Build a combo of 2 by flicking distractors first
      const d1 = spawnBubbleOnState(state)!;
      d1.char = 'z';
      const d2 = spawnBubbleOnState(state)!;
      d2.char = 'k';
      state = stepGame(state, { type: 'FLICK_BUBBLE', bubbleId: d1.id });
      state = stepGame(state, { type: 'FLICK_BUBBLE', bubbleId: d2.id });
      expect(state.combo).toBe(2);
      expect(state.impostorCombo).toBe(2);

      const targetBubble = state.bubbles.find((b) => b.char === 'e' && b.state === 'floating')!;
      expect(targetBubble).toBeDefined();

      // WHEN flicking the required target letter 'e'
      const nextState = stepGame(state, { type: 'FLICK_BUBBLE', bubbleId: targetBubble.id });

      // THEN the target bubble flies away and is removed from floating bubbles
      const targetStillFloating = nextState.bubbles.find((b) => b.id === targetBubble.id);
      expect(targetStillFloating).toBeUndefined();

      // AND combo is reset to 0 while maxCombo is preserved
      expect(nextState.combo).toBe(0);
      expect(nextState.impostorCombo).toBe(0);
      expect(nextState.maxCombo).toBe(2);

      // AND no harsh SRS error penalty is applied and slot index does not advance
      expect(nextState.wordErrorCount).toBe(0);
      expect(nextState.letterErrorCount).toBe(0);
      expect(nextState.currentIndex).toBe(0);
    });

    it('supports alias action type SWIPE_BUBBLE identically to FLICK_BUBBLE', () => {
      let state = createGameState({
        sessionWords: [{ word: 'sans' }],
        seed: 777
      });
      const d = spawnBubbleOnState(state)!;
      d.char = 'm';

      const nextState = stepGame(state, { type: 'SWIPE_BUBBLE', bubbleId: d.id });
      expect(nextState.bubbles.find((b) => b.id === d.id)).toBeUndefined();
      expect(nextState.impostorCombo).toBe(1);
      expect(nextState.wordErrorCount).toBe(0);
    });
  });

  describe('handleBubbleFlickOnState Unit Contract', () => {
    it('returns handled: true and isDistractor: true with updated counts when flicking a distractor', () => {
      const state = createGameState({
        sessionWords: [{ word: 'enfin' }],
        seed: 111
      });
      const distractor = spawnBubbleOnState(state)!;
      distractor.char = 'z';

      const res = (handleBubbleFlickOnState as any)(state, distractor.id);
      expect(res.handled).toBe(true);
      expect(res.isDistractor).toBe(true);
      expect(res.bubble.id).toBe(distractor.id);
      expect(res.combo).toBe(1);
      expect(res.impostorCombo).toBe(1);
      expect(res.impostorPops).toBe(1);
      expect(distractor.state).toBe('popping');
    });

    it('returns handled: true, isDistractor: false, and targetFlickedAway: true while resetting combo when flicking the target letter', () => {
      const state = createGameState({
        sessionWords: [{ word: 'enfin' }],
        seed: 222
      });
      state.combo = 3;
      state.impostorCombo = 3;
      const target = state.bubbles.find((b) => b.char === 'e')!;

      const res = (handleBubbleFlickOnState as any)(state, target.id);
      expect(res.handled).toBe(true);
      expect(res.isDistractor).toBe(false);
      expect(res.targetFlickedAway).toBe(true);
      expect(target.state).not.toBe('floating');
      expect(state.combo).toBe(0);
      expect(state.impostorCombo).toBe(0);
      expect(state.wordErrorCount).toBe(0);
    });

    it('safely handles non-existent bubble IDs or inactive states', () => {
      const state = createGameState({
        sessionWords: [{ word: 'enfin' }],
        seed: 333
      });

      const resMissing = (handleBubbleFlickOnState as any)(state, 999999);
      expect(resMissing.handled).toBe(false);

      state.paused = true;
      const d = spawnBubbleOnState(state)!;
      d.char = 'x';
      const resPaused = (handleBubbleFlickOnState as any)(state, d.id);
      expect(resPaused.handled).toBe(false);
    });
  });

  describe('HotTubGame Browser Engine Integration (`js/game.js`)', () => {
    it('provides flickBubble method that removes distractor, rewards combo, and triggers mascot reaction', () => {
      const game = new HotTubGame({ seed: 555 });
      game.startSession([{ word: 'maison' }]);
      expect(game.running).toBe(true);
      expect(game.targetChars[game.currentIndex]).toBe('m');

      // Inject distractor 'z'
      const distractor = spawnBubbleOnState(game as any)!;
      distractor.char = 'z';

      // Track initial error and combo
      expect(game.wordErrorCount).toBe(0);
      expect((game as any).impostorCombo).toBe(0);

      // WHEN calling flickBubble on distractor
      const res = (game as any).flickBubble(distractor.id);

      // THEN distractor flick is handled successfully
      expect(res.handled).toBe(true);
      expect(res.isDistractor).toBe(true);
      expect(game.wordErrorCount).toBe(0);
      expect((game as any).impostorCombo).toBe(1);
      expect((game as any).combo).toBe(1);
    });
  });

  describe('State Cloner & Invariant Properties with Impostor Stats', () => {
    it('accurately preserves combo, impostorCombo, and impostorPops across cloneGameState', () => {
      let state = createGameState({
        sessionWords: [{ word: 'serpent' }],
        seed: 888
      });
      const d1 = spawnBubbleOnState(state)!;
      d1.char = 'k';
      state = stepGame(state, { type: 'FLICK_BUBBLE', bubbleId: d1.id });

      expect(state.impostorCombo).toBe(1);
      expect(state.impostorPops).toBe(1);

      // TICK state to trigger cloning in stepGame
      const tickedState = stepGame(state, { type: 'TICK', dt: 0.02 });
      expect(tickedState.impostorCombo).toBe(1);
      expect(tickedState.impostorPops).toBe(1);
      expect(tickedState.maxCombo).toBe(1);
    });
  });
});
