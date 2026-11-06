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

    it('sets spawnCounter = 2 on correct tap if the newly required character is not currently floating', () => {
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

      // WHEN tapping the correct 'l' bubble
      const nextState = stepGame(state, { type: 'TAP_BUBBLE', bubbleId: lBubble.id });

      // THEN spawnCounter is set to 2 so the very next bubble spawned (3 % 3 === 0) is guaranteed to be 'o'
      expect(nextState.currentIndex).toBe(1);
      expect(nextState.spawnCounter).toBe(2);
      const nextSpawned = spawnBubbleOnState(nextState)!;
      expect(nextSpawned.char).toBe('o');
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

    it('caps in-session retries at 2 per word and does not re-queue after second retry', () => {
      // GIVEN a 1-word session with 'chat'
      let state = createGameState({
        sessionWords: [{ word: 'chat' }],
        seed: 123
      });
      expect(state.currentWordObj?.word).toBe('chat');
      expect(state.currentWordObj?.isRetry).toBe(false);
      expect(state.currentWordObj?.retryCount ?? 0).toBe(0);

      // ATTEMPT 1: Player makes an error on 'chat', finishes word, completes it
      state = stepGame(state, { type: 'USE_HINT' });
      state = spellCurrentWordSpotlessly(state);
      expect(state.wordTransitioning).toBe(true);
      state = stepGame(state, { type: 'COMPLETE_WORD' });

      // THEN 'chat' is re-queued for Retry #1 (retryCount = 1)
      expect(state.running).toBe(true);
      expect(state.queue).toHaveLength(1);
      expect(state.queue[0].word).toBe('chat');
      expect(state.queue[0].isRetry).toBe(true);
      expect(state.queue[0].retryCount).toBe(1);

      // Advance to Retry #1
      state = stepGame(state, { type: 'TICK', dt: 0.05 });
      expect(state.currentWordObj?.word).toBe('chat');
      expect(state.currentWordObj?.retryCount).toBe(1);

      // RETRY 1: Player makes another error on 'chat', finishes word, completes it
      state = stepGame(state, { type: 'USE_HINT' });
      state = spellCurrentWordSpotlessly(state);
      state = stepGame(state, { type: 'COMPLETE_WORD' });

      // THEN 'chat' is re-queued for Retry #2 (retryCount = 2)
      expect(state.running).toBe(true);
      expect(state.queue).toHaveLength(1);
      expect(state.queue[0].word).toBe('chat');
      expect(state.queue[0].isRetry).toBe(true);
      expect(state.queue[0].retryCount).toBe(2);

      // Advance to Retry #2
      state = stepGame(state, { type: 'TICK', dt: 0.05 });
      expect(state.currentWordObj?.word).toBe('chat');
      expect(state.currentWordObj?.retryCount).toBe(2);

      // RETRY 2: Player makes an error again on 'chat', finishes word, completes it
      state = stepGame(state, { type: 'USE_HINT' });
      state = spellCurrentWordSpotlessly(state);
      state = stepGame(state, { type: 'COMPLETE_WORD' });

      // THEN retries are capped at 2: 'chat' is NOT re-queued again, queue is empty, and session ends
      expect(state.queue).toHaveLength(0);
      expect(state.running).toBe(false);
      expect(state.sessionSummary).not.toBeNull();
      expect(state.sessionSummary?.totalWords).toBe(1);
    });

    it('pre-fills letters player got right on first try on second retry (silent ending scenario)', () => {
      // GIVEN a session with word 'grand' (['g', 'r', 'a', 'n', 'd'])
      let state = createGameState({
        sessionWords: [{ word: 'grand' }],
        seed: 777
      });

      // ATTEMPT 1: Pop 'g', 'r', 'a', 'n' cleanly with zero errors
      for (const ch of ['g', 'r', 'a', 'n']) {
        let match = state.bubbles.find((b) => b.state === 'floating' && b.char === ch);
        if (!match) {
          match = spawnBubbleOnState(state)!;
          match.char = ch;
        }
        state = stepGame(state, { type: 'TAP_BUBBLE', bubbleId: match.id });
      }
      expect(state.currentIndex).toBe(4);
      expect(state.wordErrorCount).toBe(0);

      // At 'd' (silent ending), player taps a wrong bubble 'z' first, then taps 'd'
      const wrongBubble = spawnBubbleOnState(state)!;
      wrongBubble.char = 'z';
      state = stepGame(state, { type: 'TAP_BUBBLE', bubbleId: wrongBubble.id });
      expect(state.wordErrorCount).toBe(1);

      let dBubble = state.bubbles.find((b) => b.state === 'floating' && b.char === 'd');
      if (!dBubble) {
        dBubble = spawnBubbleOnState(state)!;
        dBubble.char = 'd';
      }
      state = stepGame(state, { type: 'TAP_BUBBLE', bubbleId: dBubble.id });
      expect(state.wordTransitioning).toBe(true);
      state = stepGame(state, { type: 'COMPLETE_WORD' });

      // RETRY 1: Not pre-filled yet on retry 1
      expect(state.currentWordObj?.retryCount).toBe(1);
      expect(state.prefilledIndices).toEqual([]);
      expect(state.currentIndex).toBe(0);

      // Player makes an error on retry 1 and completes word
      state = stepGame(state, { type: 'USE_HINT' });
      state = spellCurrentWordSpotlessly(state);
      state = stepGame(state, { type: 'COMPLETE_WORD' });

      // RETRY 2: Letters got right on first try ('g', 'r', 'a', 'n' at indices 0, 1, 2, 3) ARE pre-filled!
      expect(state.currentWordObj?.retryCount).toBe(2);
      expect(state.prefilledIndices).toEqual([0, 1, 2, 3]);
      // Current index starts directly at the silent ending 'd' (index 4)
      expect(state.currentIndex).toBe(4);
      expect(state.targetChars[state.currentIndex]).toBe('d');

      // Player pops the silent ending 'd'
      dBubble = state.bubbles.find((b) => b.state === 'floating' && b.char === 'd');
      if (!dBubble) {
        dBubble = spawnBubbleOnState(state)!;
        dBubble.char = 'd';
      }
      state = stepGame(state, { type: 'TAP_BUBBLE', bubbleId: dBubble.id });

      // Word transitions to complete immediately!
      expect(state.currentIndex).toBe(5);
      expect(state.wordTransitioning).toBe(true);
    });

    it('pre-fills letters player got right on first try on second retry (tricky middle scenario)', () => {
      // GIVEN a session with word 'porte' (['p', 'o', 'r', 't', 'e'])
      let state = createGameState({
        sessionWords: [{ word: 'porte' }],
        seed: 888
      });

      // ATTEMPT 1: Pop 'p' and 'o' cleanly
      for (const ch of ['p', 'o']) {
        let match = state.bubbles.find((b) => b.state === 'floating' && b.char === ch);
        if (!match) {
          match = spawnBubbleOnState(state)!;
          match.char = ch;
        }
        state = stepGame(state, { type: 'TAP_BUBBLE', bubbleId: match.id });
      }
      expect(state.currentIndex).toBe(2); // 'r'

      // Player taps wrong bubble on tricky middle 'r'
      const wrongBubble = spawnBubbleOnState(state)!;
      wrongBubble.char = 'x';
      state = stepGame(state, { type: 'TAP_BUBBLE', bubbleId: wrongBubble.id });
      expect(state.wordErrorCount).toBe(1);

      // Now finish 'r', 't', 'e' cleanly
      for (const ch of ['r', 't', 'e']) {
        let match = state.bubbles.find((b) => b.state === 'floating' && b.char === ch);
        if (!match) {
          match = spawnBubbleOnState(state)!;
          match.char = ch;
        }
        state = stepGame(state, { type: 'TAP_BUBBLE', bubbleId: match.id });
      }
      expect(state.wordTransitioning).toBe(true);
      state = stepGame(state, { type: 'COMPLETE_WORD' });

      // RETRY 1: Make error and complete
      state = stepGame(state, { type: 'USE_HINT' });
      state = spellCurrentWordSpotlessly(state);
      state = stepGame(state, { type: 'COMPLETE_WORD' });

      // RETRY 2: Indices 0, 1, 3, 4 ('p', 'o', 't', 'e') are prefilled! Only tricky middle 'r' (index 2) remains
      expect(state.currentWordObj?.retryCount).toBe(2);
      expect(state.prefilledIndices).toEqual([0, 1, 3, 4]);
      expect(state.currentIndex).toBe(2);
      expect(state.targetChars[state.currentIndex]).toBe('r');

      // Player pops 'r'
      let rBubble = state.bubbles.find((b) => b.state === 'floating' && b.char === 'r');
      if (!rBubble) {
        rBubble = spawnBubbleOnState(state)!;
        rBubble.char = 'r';
      }
      state = stepGame(state, { type: 'TAP_BUBBLE', bubbleId: rBubble.id });

      // Skips prefilled 3 and 4, advances to 5, completing word
      expect(state.currentIndex).toBe(5);
      expect(state.wordTransitioning).toBe(true);
    });

    it('marks letters as error when USE_HINT was activated on that letter during first try', () => {
      // GIVEN a session with 'bleu'
      let state = createGameState({
        sessionWords: [{ word: 'bleu' }],
        seed: 999
      });

      // ATTEMPT 1: Player uses USE_HINT at index 0 ('b')
      state = stepGame(state, { type: 'USE_HINT' });
      // Finish 'b', 'l', 'e', 'u' cleanly
      for (const ch of ['b', 'l', 'e', 'u']) {
        let match = state.bubbles.find((b) => b.state === 'floating' && b.char === ch);
        if (!match) {
          match = spawnBubbleOnState(state)!;
          match.char = ch;
        }
        state = stepGame(state, { type: 'TAP_BUBBLE', bubbleId: match.id });
      }
      state = stepGame(state, { type: 'COMPLETE_WORD' });

      // RETRY 1: Error & complete
      state = stepGame(state, { type: 'USE_HINT' });
      state = spellCurrentWordSpotlessly(state);
      state = stepGame(state, { type: 'COMPLETE_WORD' });

      // RETRY 2: Index 0 had error (from hint), so only 1, 2, 3 ('l', 'e', 'u') are prefilled
      expect(state.currentWordObj?.retryCount).toBe(2);
      expect(state.prefilledIndices).toEqual([1, 2, 3]);
      expect(state.currentIndex).toBe(0);
      expect(state.targetChars[state.currentIndex]).toBe('b');

      // Pop 'b'
      let bBubble = state.bubbles.find((b) => b.state === 'floating' && b.char === 'b');
      if (!bBubble) {
        bBubble = spawnBubbleOnState(state)!;
        bBubble.char = 'b';
      }
      state = stepGame(state, { type: 'TAP_BUBBLE', bubbleId: bBubble.id });

      // Skips 1, 2, 3, advances to 4, word completed!
      expect(state.currentIndex).toBe(4);
      expect(state.wordTransitioning).toBe(true);
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
