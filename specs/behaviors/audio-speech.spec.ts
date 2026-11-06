// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { soundEngine } from '../../js/audio.js';
import { speechEngine } from '../../js/speech.js';

describe('Web Audio Synthesizer & 3-Tier Speech Cascade (Executable Specification for audio.js & speech.js)', () => {
  let mockAudioContext: any;
  let mockOscillator: any;
  let mockGain: any;

  beforeEach(() => {
    // Mock fetch to prevent external network calls to dictionaryapi.dev during test execution
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => []
    });

    mockOscillator = {
      type: 'sine',
      frequency: {
        value: 440,
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn()
      },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn()
    };

    mockGain = {
      gain: {
        value: 1,
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn()
      },
      connect: vi.fn()
    };

    mockAudioContext = {
      state: 'running',
      currentTime: 10,
      sampleRate: 44100,
      destination: {},
      resume: vi.fn().mockResolvedValue(undefined),
      createOscillator: vi.fn(() => mockOscillator),
      createGain: vi.fn(() => mockGain),
      createBuffer: vi.fn((channels, length, rate) => ({
        length,
        sampleRate: rate,
        getChannelData: vi.fn(() => new Float32Array(length))
      })),
      createBufferSource: vi.fn(() => ({
        buffer: null,
        connect: vi.fn(),
        start: vi.fn()
      })),
      createBiquadFilter: vi.fn(() => ({
        type: 'lowpass',
        frequency: { setValueAtTime: vi.fn() },
        Q: { setValueAtTime: vi.fn() },
        connect: vi.fn()
      }))
    };

    // Mount Mock Web Audio API
    (window as any).AudioContext = vi.fn(() => mockAudioContext);
    soundEngine.ctx = mockAudioContext;
    soundEngine.masterGain = mockGain;
    soundEngine.unlocked = true;

    // Provide SpeechSynthesisUtterance if absent in test runner
    if (typeof (globalThis as any).SpeechSynthesisUtterance === 'undefined') {
      (globalThis as any).SpeechSynthesisUtterance = class {
        text: string;
        lang = '';
        rate = 1;
        volume = 1;
        onstart: any = null;
        onend: any = null;
        onerror: any = null;
        constructor(text: string) {
          this.text = text;
        }
      };
      (window as any).SpeechSynthesisUtterance = (globalThis as any).SpeechSynthesisUtterance;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Web Audio Sound Synthesizer', () => {
    it('synthesizes ascending pentatonic bloops on correct bubble pops without errors', () => {
      // GIVEN an unlocked sound engine
      expect(soundEngine.unlocked).toBe(true);

      // WHEN playing bubble pops for sequential letters 0 through 4
      for (let i = 0; i < 5; i++) {
        soundEngine.playBubblePop(i);
      }

      // THEN oscillators are created and connected to destination
      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
      expect(mockOscillator.start).toHaveBeenCalled();
      expect(mockOscillator.stop).toHaveBeenCalled();
    });

    it('plays wrong-fizzle and hint-whisper sounds on demand', () => {
      // WHEN triggering wrong fizzle and hint whisper
      soundEngine.playWrongFizzle();
      soundEngine.playHintWhisper();

      // THEN oscillators and gain nodes are configured
      expect(mockAudioContext.createGain).toHaveBeenCalled();
      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('plays victory celebration chords when word and session complete', () => {
      // WHEN word and session completion audio triggers
      soundEngine.playWordComplete();
      soundEngine.playDuckVictory();
      soundEngine.playSessionComplete();

      // THEN celebratory oscillators are dispatched
      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('safely handles missing Web Audio API without throwing errors', () => {
      // GIVEN an environment without AudioContext
      soundEngine.ctx = null;
      (window as any).AudioContext = null;

      // WHEN audio methods are invoked
      expect(() => soundEngine.playBubblePop(0)).not.toThrow();
      expect(() => soundEngine.playWrongFizzle()).not.toThrow();
      expect(() => soundEngine.playWordComplete()).not.toThrow();
      expect(() => soundEngine.playSessionComplete()).not.toThrow();
    });
  });

  describe('2. 3-Tier Speech Cascade Engine', () => {
    it('prioritizes Tier-1 bundled offline audio for French starter words', async () => {
      // GIVEN a French starter word with bundled audio ("câlin")
      const wordObj = { word: 'câlin', week_label: 'Week 8' };

      const listeners: Record<string, () => void> = {};
      const mockPlayer = {
        src: '',
        volume: 1,
        currentTime: 0,
        load: vi.fn(),
        play: vi.fn(function (this: any) {
          queueMicrotask(() => {
            if (listeners['ended']) listeners['ended']();
          });
          return Promise.resolve();
        }),
        pause: vi.fn(),
        addEventListener: vi.fn((event, handler) => {
          listeners[event] = handler;
        }),
        removeEventListener: vi.fn((event) => {
          delete listeners[event];
        })
      };
      speechEngine.player = mockPlayer as any;

      // WHEN speakWord is requested
      const result = await speechEngine.speakWord(wordObj);

      // THEN it plays the bundled human mp3 audio file via Tier 1
      expect(decodeURIComponent(mockPlayer.src)).toContain('assets/audio/words/câlin.mp3');
      expect(mockPlayer.play).toHaveBeenCalled();
      expect(result.tier).toBe(1);
      expect(result.played).toBe(true);
    });

    it('falls back to Canadian French (fr-CA) Web Speech API when no audio URL exists', async () => {
      // GIVEN a custom invented word without an audio URL
      const customWord = { word: 'xylophonez', week_label: 'Week 9' };

      const mockUtterances: any[] = [];
      (window as any).speechSynthesis = {
        speak: vi.fn((utterance) => {
          mockUtterances.push(utterance);
          queueMicrotask(() => {
            if (typeof utterance.onend === 'function') {
              utterance.onend();
            }
          });
        }),
        cancel: vi.fn(),
        getVoices: vi.fn(() => [{ name: 'Caroline', lang: 'fr-CA' }]),
        addEventListener: vi.fn()
      };

      // Disconnect HTML5 audio player and clear cache
      speechEngine.player = null;
      speechEngine.mp3Cache.set('xylophonez', null);

      // WHEN speakWord is called on the word
      const result = await speechEngine.speakWord(customWord);

      // THEN window.speechSynthesis speaks with fr-CA and 0.85 rate via Tier 3
      expect((window as any).speechSynthesis.speak).toHaveBeenCalled();
      expect(mockUtterances.length).toBe(1);
      expect(mockUtterances[0].text).toBe('xylophonez');
      expect(mockUtterances[0].lang).toBe('fr-CA');
      expect(mockUtterances[0].rate).toBe(0.85);
      expect(result.tier).toBe(3);
      expect(result.played).toBe(true);
    });

    it('notifies speaking state listeners when speech starts and finishes', async () => {
      // GIVEN a speaking state listener
      const states: boolean[] = [];
      const unsub = speechEngine.onSpeakingStateChange((isSpeaking: boolean) => {
        states.push(isSpeaking);
      });

      (window as any).speechSynthesis = {
        speak: vi.fn((u) => {
          if (u.onstart) u.onstart();
          queueMicrotask(() => {
            if (u.onend) u.onend();
          });
        }),
        cancel: vi.fn(),
        getVoices: vi.fn(() => []),
        addEventListener: vi.fn()
      };
      speechEngine.player = null;
      speechEngine.mp3Cache.set('soleil', null);

      // WHEN speech is invoked
      await speechEngine.speakWord({ word: 'soleil' });

      // THEN speaking listeners receive true on start and false on finish
      expect(states).toContain(true);
      expect(states).toContain(false);

      unsub();
    });
  });
});
