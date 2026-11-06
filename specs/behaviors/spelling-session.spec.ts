import { describe, it, expect } from 'vitest';
import {
  CHEER_MESSAGES_PERFECT,
  CHEER_MESSAGES_PRACTICE,
  createGameState,
  stepGame,
  handleBubbleTapOnState,
  spawnBubbleOnState
} from '../../js/game-core.js';

describe('Sequential Spelling, Hint Scaffolding & Session Mastery (js/game-core.js)', () => {
  describe('Strict Lowercase & Accent Character Matching', () => {
    it('accepts only the exact matching character and rejects unaccented lookalikes (e.g. "a" !== "â")', () => {
      // GIVEN a session with the accented word "câlin"
      let state = createGameState({
        sessionWords: [{ word: 'câlin', week_label: 'Week 8' }],
        seed: 42
      });

      // First pop 'c' (guaranteed at bubble index 2 from initial wave)
      const cBubble = state.bubbles.find((b) => b.char === 'c')!;
      state = stepGame(state, { type: 'TAP_BUBBLE', bubbleId: cBubble.id });
      expect(state.currentIndex).toBe(1);
      expect(state.targetChars[state.currentIndex]).toBe('â');

      // Inject an unaccented 'a' bubble and an accented 'â' bubble
      const plainABubble = spawnBubbleOnState(state)!;
      plainABubble.char = 'a';
      const accentedABubble = spawnBubbleOnState(state)!;
      accentedABubble.char = 'â';

      // WHEN tapping the plain 'a' bubble when 'â' is required
      const afterWrongTap = stepGame(state, { type: 'TAP_BUBBLE', bubbleId: plainABubble.id });

      // THEN it counts as an error and currentIndex remains at 1
      expect(afterWrongTap.currentIndex).toBe(1);
      expect(afterWrongTap.wordErrorCount).toBe(1);
      expect(afterWrongTap.letterErrorCount).toBe(1);

      // WHEN subsequently tapping the accented 'â' bubble
      const afterCorrectTap = stepGame(afterWrongTap, { type: 'TAP_BUBBLE', bubbleId: accentedABubble.id });

      // THEN currentIndex advances to 2 and letterErrorCount resets to 0 while wordErrorCount stays 1
      expect(afterCorrectTap.currentIndex).toBe(2);
      expect(afterCorrectTap.letterErrorCount).toBe(0);
      expect(afterCorrectTap.wordErrorCount).toBe(1);
    });

    it('spawns two bubbles at once (target letter plus high-weight distractor) on correct tap when the newly required character is not currently floating', () => {
      // GIVEN a game state on word "loin" where 'l' is floating, and no floating bubble has 'o'
      const state = createGameState({
        sessionWords: [{ word: 'loin' }],
        seed: 10
      });
      for (const b of state.bubbles) {
        if (b.char === 'o') b.char = 'z';
      }
      const lBubble = state.bubbles.find((b) => b.char === 'l')!;
      expect(state.spawnCounter).toBe(5);
      const initialFloatingCount = state.bubbles.filter((b) => b.state === 'floating').length;

      // WHEN tapping the correct 'l' bubble
      const nextState = stepGame(state, { type: 'TAP_BUBBLE', bubbleId: lBubble.id });

      // THEN urgent spawn triggers immediately, spawning two bubbles at once (target 'o' + high-weight distractor)
      expect(nextState.currentIndex).toBe(1);
      const oBubbles = nextState.bubbles.filter((b) => b.state === 'floating' && b.char === 'o');
      expect(oBubbles).toHaveLength(1);

      // 'l' was removed (-1) and two new bubbles spawned (+2), so floating count increased by 1
      const newFloatingCount = nextState.bubbles.filter((b) => b.state === 'floating').length;
      expect(newFloatingCount).toBe(initialFloatingCount + 1);

      // Both newly spawned bubbles are in the lower arena and have distinct baseX positions
      const newBubbles = nextState.bubbles.slice(-2);
      expect(newBubbles[0].char === 'o' || newBubbles[1].char === 'o').toBe(true);
      expect(newBubbles[0].baseX).not.toBe(newBubbles[1].baseX);
      expect(newBubbles[0].y).toBeGreaterThanOrEqual(nextState.stageHeight / 3);
      expect(newBubbles[1].y).toBeGreaterThanOrEqual(nextState.stageHeight / 3);
    });
  });

  describe('Watermark Hint Scaffolding & Error Rules', () => {
    it('activates watermark and increments wordErrorCount by 1 on first USE_HINT, and does not add extra errors on subsequent USE_HINT', () => {
      // GIVEN an active game state with watermarkActive = false and 0 errors
      const state = createGameState({
        sessionWords: [{ word: 'singe' }],
        seed: 50
      });
      expect(state.watermarkActive).toBe(false);
      expect(state.wordErrorCount).toBe(0);

      // WHEN USE_HINT is dispatched once, and then dispatched a second time
      const afterFirstHint = stepGame(state, { type: 'USE_HINT' });
      const afterSecondHint = stepGame(afterFirstHint, { type: 'USE_HINT' });

      // THEN first hint sets watermarkActive = true and wordErrorCount = 1; second hint keeps wordErrorCount = 1
      expect(afterFirstHint.watermarkActive).toBe(true);
      expect(afterFirstHint.wordErrorCount).toBe(1);
      expect(afterSecondHint.watermarkActive).toBe(true);
      expect(afterSecondHint.wordErrorCount).toBe(1);
    });

    it('automatically activates watermark after 2 wrong taps on the same letter without adding an extra 3rd error penalty', () => {
      // GIVEN an active game state on word "sans" (targetChars[0] === 's')
      let state = createGameState({
        sessionWords: [{ word: 'sans' }],
        seed: 88
      });
      const wrongBubbles = state.bubbles.filter((b) => b.char !== 's');
      expect(wrongBubbles.length).toBeGreaterThanOrEqual(2);

      // WHEN tapping 2 wrong bubbles on index 0
      state = stepGame(state, { type: 'TAP_BUBBLE', bubbleId: wrongBubbles[0].id });
      expect(state.watermarkActive).toBe(false);
      expect(state.letterErrorCount).toBe(1);
      expect(state.wordErrorCount).toBe(1);

      state = stepGame(state, { type: 'TAP_BUBBLE', bubbleId: wrongBubbles[1].id });

      // THEN watermarkActive becomes true and wordErrorCount is exactly 2
      expect(state.watermarkActive).toBe(true);
      expect(state.letterErrorCount).toBe(2);
      expect(state.wordErrorCount).toBe(2);
    });
  });

  describe('Word Completion, Zero-Error Mastery, In-Session Retry & Session Summary', () => {
    function spellCurrentWordSpotlessly(initialState: ReturnType<typeof createGameState>) {
      let state = initialState;
      while (!state.wordTransitioning && state.currentIndex < state.targetChars.length) {
        const reqChar = state.targetChars[state.currentIndex];
        let match = state.bubbles.find((b) => b.state === 'floating' && b.char === reqChar);
        if (!match) {
          match = spawnBubbleOnState(state)!;
          match.char = reqChar;
        }
        state = stepGame(state, { type: 'TAP_BUBBLE', bubbleId: match.id });
      }
      return state;
    }

    it('re-queues a word with isRetry=true when wordErrorCount > 0 and records only the FIRST attempt in sessionResults', () => {
      // GIVEN a 2-word session: ["loin", "sans"]
      let state = createGameState({
        sessionWords: [{ word: 'loin' }, { word: 'sans' }],
        seed: 333
      });
      expect(state.totalUniqueWords).toBe(2);
      expect(state.currentWordObj?.word).toBe('loin');
      expect(state.currentWordObj?.isRetry).toBe(false);

      // WHEN the player uses a hint on "loin" (wordErrorCount = 1), finishes spelling "loin", and completes the word
      state = stepGame(state, { type: 'USE_HINT' });
      state = spellCurrentWordSpotlessly(state);
      expect(state.wordTransitioning).toBe(true);

      state = stepGame(state, { type: 'COMPLETE_WORD' });

      // THEN "loin" is recorded in sessionResults with firstAttemptErrors=1 (masteredFirstTry=false),
      // masteredCount remains 0, and "loin" is re-queued at the end of the queue with isRetry=true
      expect(state.masteredCount).toBe(0);
      expect(state.sessionResults).toEqual([
        { word: 'loin', firstAttemptErrors: 1, masteredFirstTry: false }
      ]);
      expect(CHEER_MESSAGES_PRACTICE).toContain(state.lastCheerMessage);
      expect(state.currentWordObj?.word).toBe('sans');
      expect(state.queue).toHaveLength(1);
      expect(state.queue[0].word).toBe('loin');
      expect(state.queue[0].isRetry).toBe(true);

      // WHEN the player spells "sans" spotlessly (0 errors) and then spells the re-queued "loin" spotlessly (0 errors)
      state = spellCurrentWordSpotlessly(state);
      state = stepGame(state, { type: 'COMPLETE_WORD' });
      expect(state.masteredCount).toBe(1);
      expect(CHEER_MESSAGES_PERFECT).toContain(state.lastCheerMessage);
      expect(state.currentWordObj?.word).toBe('loin');
      expect(state.currentWordObj?.isRetry).toBe(true);

      state = spellCurrentWordSpotlessly(state);
      state = stepGame(state, { type: 'COMPLETE_WORD' });

      // THEN the session finishes with masteredCount=2, running=false, and sessionSummary preserving first-attempt stats
      expect(state.running).toBe(false);
      expect(state.masteredCount).toBe(2);
      expect(state.sessionSummary).toEqual({
        totalWords: 2,
        firstTryPerfect: 1,
        results: [
          { word: 'loin', firstAttemptErrors: 1, masteredFirstTry: false },
          { word: 'sans', firstAttemptErrors: 0, masteredFirstTry: true }
        ]
      });
    });

    it('ignores taps, hints, and ticks when paused, stopped, or wordTransitioning', () => {
      // GIVEN an active game state
      const state = createGameState({
        sessionWords: [{ word: 'enfin' }],
        seed: 77
      });
      const b0 = state.bubbles[0];

      // WHEN paused via PAUSE action
      const pausedState = stepGame(state, { type: 'PAUSE' });
      const afterPausedTap = stepGame(pausedState, { type: 'TAP_BUBBLE', bubbleId: b0.id });
      const afterPausedTick = stepGame(pausedState, { type: 'TICK', dt: 0.05 });

      // THEN bubble positions and currentIndex do not change while paused
      expect(pausedState.paused).toBe(true);
      expect(afterPausedTap.currentIndex).toBe(0);
      expect(afterPausedTap.bubbles).toHaveLength(5);
      expect(afterPausedTick.bubbles[0].y).toBe(pausedState.bubbles[0].y);

      // WHEN resumed via RESUME and then stopped via STOP
      const resumed = stepGame(pausedState, { type: 'RESUME' });
      expect(resumed.paused).toBe(false);

      const stopped = stepGame(resumed, { type: 'STOP' });
      const afterStoppedHint = stepGame(stopped, { type: 'USE_HINT' });
      const tapResOnStopped = handleBubbleTapOnState(stopped, b0.id);

      // THEN stopped state clears bubbles, sets running=false, and ignores all inputs
      expect(stopped.running).toBe(false);
      expect(stopped.bubbles).toHaveLength(0);
      expect(afterStoppedHint.watermarkActive).toBe(false);
      expect(tapResOnStopped.handled).toBe(false);
    });
  });
});
