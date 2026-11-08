/**
 * Procedural Web Audio API Synthesizer for Cozy Tub Spelling
 * Generates soft, relaxing organic sounds with zero external audio dependencies:
 * - Soft water bloop (correct bubble pop)
 * - Gentle steam fizzle / wooden thud (wrong letter tap)
 * - Warm celesta/marimba chime arpeggio (word completion & session celebration)
 */

// Warm C-major pentatonic frequencies for sequential letter pops
const PENTATONIC_SCALE = [
  293.66, // D4
  329.63, // E4
  392.00, // G4
  440.00, // A4
  523.25, // C5
  587.33, // D5
  659.25, // E5
  783.99  // G5
];

class SoundSynthesizer {
  constructor() {
    /** @type {AudioContext | null} */
    this.ctx = null;
    /** @type {GainNode | null} */
    this.masterGain = null;
    /** @type {AudioBuffer | null} */
    this.noiseBuffer = null;
    this.unlocked = false;

    // Clear any legacy mute preference so audio always plays
    if (typeof localStorage !== 'undefined' && localStorage !== null) {
      try {
        localStorage.removeItem('hottub_sfx_muted_v1');
      } catch (_) {}
    }
  }

  /**
   * Initializes and unlocks the Web Audio API context during a user gesture
   * (essential for Amazon Fire OS Silk Browser and mobile Safari/Chrome).
   */
  async unlockAudio() {
    try {
      const win = /** @type {Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }} */ (window);
      const AudioCtx = win.AudioContext || win.webkitAudioContext;
      if (!AudioCtx) return false;

      if (!this.ctx) {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.75;
        this.masterGain.connect(this.ctx.destination);
        this.noiseBuffer = this._createSoftNoiseBuffer();
      }

      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }

      // Play a 1-frame silent buffer to force hardware audio unlock on mobile WebViews
      const silentBuf = this.ctx.createBuffer(1, 1, 22050);
      const src = this.ctx.createBufferSource();
      src.buffer = silentBuf;
      src.connect(this.ctx.destination);
      src.start(0);

      this.unlocked = true;
      return true;
    } catch (err) {
      console.warn('Web Audio unlock warning:', err);
      return false;
    }
  }

  _ensureReady() {
    if (typeof window === 'undefined') return false;
    if (!this.ctx) {
      const win = /** @type {Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }} */ (window);
      const AudioCtx = win.AudioContext || win.webkitAudioContext;
      if (!AudioCtx) return false;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.75;
      this.masterGain.connect(this.ctx.destination);
      this.noiseBuffer = this._createSoftNoiseBuffer();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return true;
  }

  _createSoftNoiseBuffer() {
    const sampleRate = this.ctx.sampleRate;
    const length = Math.floor(sampleRate * 0.6);
    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    // Warm pink-tinted noise for organic water/steam texture
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.0990460;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.18;
    }
    return buffer;
  }

  /**
   * Soft water bloop sound when popping the correct letter bubble.
   * @param {number} stepIndex - Current letter index for subtle musical progression.
   */
  playBubblePop(stepIndex = 0) {
    if (!this._ensureReady()) return;

    const now = this.ctx.currentTime;
    const baseFreq = PENTATONIC_SCALE[stepIndex % PENTATONIC_SCALE.length];

    // Primary resonant water droplet upward pitch sweep
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq * 0.68, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.85, now + 0.095);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.34, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.15);

    // Subtle glassy harmonic ripple
    const shimmer = this.ctx.createOscillator();
    const shimmerGain = this.ctx.createGain();
    shimmer.type = 'sine';
    shimmer.frequency.setValueAtTime(baseFreq * 1.5, now + 0.015);
    shimmer.frequency.exponentialRampToValueAtTime(baseFreq * 2.35, now + 0.11);

    shimmerGain.gain.setValueAtTime(0.001, now + 0.015);
    shimmerGain.gain.linearRampToValueAtTime(0.11, now + 0.03);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

    shimmer.connect(shimmerGain);
    shimmerGain.connect(this.masterGain);
    shimmer.start(now + 0.015);
    shimmer.stop(now + 0.14);

    // Tiny soft water splash transient
    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1400, now);
      filter.Q.value = 2.2;

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.12, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.masterGain);
      noise.start(now);
      noise.stop(now + 0.06);
    }
  }

  /**
   * Gentle pastel fizzle and soft wooden-tub thud on wrong letter tap.
   * Calm and non-punishing for young learners.
   */
  playWrongFizzle() {
    if (!this._ensureReady()) return;

    const now = this.ctx.currentTime;

    // Soft low warm thud
    const osc = this.ctx.createOscillator();
    const oscFilter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(182, now);
    osc.frequency.exponentialRampToValueAtTime(96, now + 0.23);

    oscFilter.type = 'lowpass';
    oscFilter.frequency.setValueAtTime(420, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.24, now + 0.016);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(oscFilter);
    oscFilter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.26);

    // Gentle steam fizzle
    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;

      const bandpass = this.ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(1100, now);
      bandpass.frequency.exponentialRampToValueAtTime(520, now + 0.26);
      bandpass.Q.value = 1.3;

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.001, now);
      nGain.gain.linearRampToValueAtTime(0.20, now + 0.025);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      noise.connect(bandpass);
      bandpass.connect(nGain);
      nGain.connect(this.masterGain);
      noise.start(now);
      noise.stop(now + 0.29);
    }
  }

  /**
   * Warm chime arpeggio played when a word is completed.
   */
  playWordComplete() {
    if (!this._ensureReady()) return;

    const notes = [523.25, 659.25, 783.99, 880.00, 1046.50]; // C5, E5, G5, A5, C6
    const now = this.ctx.currentTime;

    notes.forEach((freq, idx) => {
      const start = now + idx * 0.082;
      this._playWarmBellNote(freq, start, idx === notes.length - 1 ? 0.85 : 0.52, 0.22);
    });
  }

  /**
   * Uplifting cozy chime cascade when the entire 8-10 word session is completed.
   */
  playSessionComplete() {
    if (!this._ensureReady()) return;

    const notes = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1318.51];
    const now = this.ctx.currentTime;

    notes.forEach((freq, idx) => {
      const start = now + idx * 0.09;
      this._playWarmBellNote(freq, start, idx >= notes.length - 2 ? 1.1 : 0.6, 0.22);
    });
  }

  /**
   * Playful water splash when the bath tube level surges on word completion.
   */
  playWaterSplash() {
    if (!this._ensureReady()) return;

    const now = this.ctx.currentTime;

    // Filtered water rush swoosh
    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(800, now);
      filter.frequency.exponentialRampToValueAtTime(1600, now + 0.18);
      filter.Q.value = 2.0;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      noise.start(now);
      noise.stop(now + 0.3);
    }

    // Two playful bubbly droplet pops
    const dropFreqs = [784, 1175];
    dropFreqs.forEach((freq, idx) => {
      const dropTime = now + 0.05 + idx * 0.07;
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * 0.8, dropTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.6, dropTime + 0.08);

      oscGain.gain.setValueAtTime(0.001, dropTime);
      oscGain.gain.linearRampToValueAtTime(0.22, dropTime + 0.015);
      oscGain.gain.exponentialRampToValueAtTime(0.001, dropTime + 0.12);

      osc.connect(oscGain);
      oscGain.connect(this.masterGain);
      osc.start(dropTime);
      osc.stop(dropTime + 0.13);
    });
  }

  /**
   * Cute, tactile rubber duck squeak when tapped or hopping.
   */
  playDuckSqueak() {
    if (!this._ensureReady()) return;

    const now = this.ctx.currentTime;
    const duckOsc = this.ctx.createOscillator();
    const duckGain = this.ctx.createGain();
    const duckFilter = this.ctx.createBiquadFilter();

    duckOsc.type = 'triangle';
    duckOsc.frequency.setValueAtTime(560, now);
    duckOsc.frequency.linearRampToValueAtTime(940, now + 0.08);
    duckOsc.frequency.linearRampToValueAtTime(840, now + 0.17);

    duckFilter.type = 'bandpass';
    duckFilter.frequency.setValueAtTime(1200, now);
    duckFilter.Q.value = 3.2;

    duckGain.gain.setValueAtTime(0.001, now);
    duckGain.gain.linearRampToValueAtTime(0.32, now + 0.02);
    duckGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    duckOsc.connect(duckFilter);
    duckFilter.connect(duckGain);
    duckGain.connect(this.masterGain);
    duckOsc.start(now);
    duckOsc.stop(now + 0.23);
  }

  /**
   * Awesome victory fanfare with rubber duck squeak for session completion!
   */
  playDuckVictory() {
    if (!this._ensureReady()) return;

    const now = this.ctx.currentTime;

    // 1. Playful Rubber Duck Squeak
    this.playDuckSqueak();

    // 2. Second little happy chirp squeak
    const chirpTime = now + 0.14;
    const chirpOsc = this.ctx.createOscillator();
    const chirpGain = this.ctx.createGain();
    chirpOsc.type = 'sine';
    chirpOsc.frequency.setValueAtTime(880, chirpTime);
    chirpOsc.frequency.exponentialRampToValueAtTime(1400, chirpTime + 0.08);

    chirpGain.gain.setValueAtTime(0.001, chirpTime);
    chirpGain.gain.linearRampToValueAtTime(0.25, chirpTime + 0.015);
    chirpGain.gain.exponentialRampToValueAtTime(0.001, chirpTime + 0.14);

    chirpOsc.connect(chirpGain);
    chirpGain.connect(this.masterGain);
    chirpOsc.start(chirpTime);
    chirpOsc.stop(chirpTime + 0.15);

    // 3. Grand Golden Chime Cascade (C5, E5, G5, C6, E6, G6)
    const fanfareNotes = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98];
    fanfareNotes.forEach((freq, idx) => {
      const start = now + 0.24 + idx * 0.085;
      this._playWarmBellNote(freq, start, idx >= fanfareNotes.length - 2 ? 1.25 : 0.7, 0.24);
    });
  }

  /**
   * Gentle rising steam-chime whisper when the Hint watermark appears.
   */
  playHintWhisper() {
    if (!this._ensureReady()) return;

    const now = this.ctx.currentTime;
    this._playWarmBellNote(440.0, now, 0.42, 0.14);
    this._playWarmBellNote(587.33, now + 0.09, 0.55, 0.15);

    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(750, now);
      filter.frequency.exponentialRampToValueAtTime(1350, now + 0.3);
      filter.Q.value = 1.8;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.11, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      noise.start(now);
      noise.stop(now + 0.35);
    }
  }

  /**
   * Subtle wooden tap sound for UI buttons.
   */
  playUiTap() {
    if (!this._ensureReady()) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(560, now + 0.045);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  /**
   * Level Select — Cozy Bathtub: Warm water splash + happy cat purr.
   */
  playLevelSelectBathtub() {
    if (!this._ensureReady()) return;

    const now = this.ctx.currentTime;
    // 1. Warm water splash
    this.playWaterSplash();

    // 2. Happy cat purr (gentle warm low trill)
    const purrDur = 0.48;
    const carrier = this.ctx.createOscillator();
    const purrFilter = this.ctx.createBiquadFilter();
    const purrGain = this.ctx.createGain();

    carrier.type = 'triangle';
    carrier.frequency.setValueAtTime(118, now + 0.08);
    carrier.frequency.linearRampToValueAtTime(142, now + 0.32);
    carrier.frequency.linearRampToValueAtTime(112, now + 0.08 + purrDur);

    purrFilter.type = 'lowpass';
    purrFilter.frequency.setValueAtTime(340, now + 0.08);

    purrGain.gain.setValueAtTime(0.001, now + 0.08);
    purrGain.gain.linearRampToValueAtTime(0.18, now + 0.16);
    purrGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08 + purrDur);

    carrier.connect(purrFilter);
    purrFilter.connect(purrGain);
    purrGain.connect(this.masterGain);
    carrier.start(now + 0.08);
    carrier.stop(now + 0.1 + purrDur);
  }

  /**
   * Level Select — Chest Opening: Heavy wooden creak + metallic coin chime.
   */
  playLevelSelectChest() {
    if (!this._ensureReady()) return;

    const now = this.ctx.currentTime;

    // 1. Heavy wooden lid creak
    const creakOsc = this.ctx.createOscillator();
    const creakFilter = this.ctx.createBiquadFilter();
    const creakGain = this.ctx.createGain();

    creakOsc.type = 'sawtooth';
    creakOsc.frequency.setValueAtTime(135, now);
    creakOsc.frequency.linearRampToValueAtTime(185, now + 0.11);
    creakOsc.frequency.exponentialRampToValueAtTime(98, now + 0.22);

    creakFilter.type = 'lowpass';
    creakFilter.frequency.setValueAtTime(380, now);

    creakGain.gain.setValueAtTime(0.001, now);
    creakGain.gain.linearRampToValueAtTime(0.16, now + 0.025);
    creakGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    creakOsc.connect(creakFilter);
    creakFilter.connect(creakGain);
    creakGain.connect(this.masterGain);
    creakOsc.start(now);
    creakOsc.stop(now + 0.25);

    // 2. Metallic gold coin chime arpeggio
    const coinNotes = [1046.5, 1318.51, 1567.98, 2093.0];
    coinNotes.forEach((freq, idx) => {
      const start = now + 0.1 + idx * 0.055;
      this._playWarmBellNote(freq, start, 0.36, 0.19);
    });
  }

  /**
   * Mode Select (3 vs. 10 Ducks):
   * - count === 3: Quick single rubber duck "quack".
   * - count === 10: Rapid, funny chorus of three "quack-quack-quacks".
   * @param {number} [count=3]
   */
  playModeQuack(count = 3) {
    if (!this._ensureReady()) return;

    const now = this.ctx.currentTime;
    const quacks = count >= 10
      ? [
          { delay: 0, baseFreq: 540, peakFreq: 920 },
          { delay: 0.11, baseFreq: 610, peakFreq: 1020 },
          { delay: 0.22, baseFreq: 500, peakFreq: 980 }
        ]
      : [{ delay: 0, baseFreq: 560, peakFreq: 940 }];

    for (const q of quacks) {
      const t = now + q.delay;
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(q.baseFreq, t);
      osc.frequency.linearRampToValueAtTime(q.peakFreq, t + 0.055);
      osc.frequency.linearRampToValueAtTime(q.baseFreq * 1.35, t + 0.12);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1250, t);
      filter.Q.value = 3.0;

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.3, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.15);
    }
  }

  /**
   * Tracking Toggle (Sleep Mask):
   * - maskOn === true ("Just for Fun"): Soft fabric swoosh + quiet cozy snore.
   * - maskOn === false ("Counting: ON"): Fabric lift swoosh + gentle wake note.
   * @param {boolean} [maskOn=true]
   */
  playSleepMaskToggle(maskOn = true) {
    if (!this._ensureReady()) return;

    const now = this.ctx.currentTime;

    // 1. Soft fabric swoosh
    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(maskOn ? 950 : 620, now);
      filter.frequency.exponentialRampToValueAtTime(maskOn ? 480 : 1100, now + 0.16);
      filter.Q.value = 1.6;

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.001, now);
      nGain.gain.linearRampToValueAtTime(0.16, now + 0.03);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.masterGain);
      noise.start(now);
      noise.stop(now + 0.19);
    }

    if (maskOn) {
      // 2. Quiet cozy snore sigh
      const snoreOsc = this.ctx.createOscillator();
      const snoreFilter = this.ctx.createBiquadFilter();
      const snoreGain = this.ctx.createGain();

      snoreOsc.type = 'sine';
      snoreOsc.frequency.setValueAtTime(165, now + 0.14);
      snoreOsc.frequency.exponentialRampToValueAtTime(110, now + 0.46);

      snoreFilter.type = 'lowpass';
      snoreFilter.frequency.setValueAtTime(280, now + 0.14);

      snoreGain.gain.setValueAtTime(0.001, now + 0.14);
      snoreGain.gain.linearRampToValueAtTime(0.14, now + 0.22);
      snoreGain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);

      snoreOsc.connect(snoreFilter);
      snoreFilter.connect(snoreGain);
      snoreGain.connect(this.masterGain);
      snoreOsc.start(now + 0.14);
      snoreOsc.stop(now + 0.5);
    } else {
      // Wake up chime
      this._playWarmBellNote(587.33, now + 0.08, 0.25, 0.16);
      this._playWarmBellNote(783.99, now + 0.15, 0.3, 0.18);
    }
  }

  /**
   * Start Button: Giant soap bubble pop + bright harp glissando.
   */
  playStartHarpGlissando() {
    if (!this._ensureReady()) return;

    this.playBubblePop(4);

    const now = this.ctx.currentTime;
    const harpNotes = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51];
    harpNotes.forEach((freq, idx) => {
      const start = now + 0.04 + idx * 0.042;
      this._playWarmBellNote(freq, start, idx === harpNotes.length - 1 ? 0.65 : 0.36, 0.18);
    });
  }

  /**
   * Login Gate: Gentle happy cat meow when waking up the sleeping cat door.
   */
  playCatWakeMeow() {
    if (!this._ensureReady()) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(740, now + 0.14);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.36);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  /**
   * Idle State: Very faint, slow bubble pop every 10 seconds.
   */
  playFaintAmbientBubble() {
    if (!this._ensureReady()) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(360, now);
    osc.frequency.exponentialRampToValueAtTime(680, now + 0.08);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.045, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  _playWarmBellNote(freq, startTime, duration, peakGain) {
    const osc = this.ctx.createOscillator();
    const overtone = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const overGain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    overtone.type = 'sine';
    overtone.frequency.setValueAtTime(freq * 2.0, startTime);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.016);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    overGain.gain.setValueAtTime(0.001, startTime);
    overGain.gain.linearRampToValueAtTime(peakGain * 0.22, startTime + 0.012);
    overGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration * 0.55);

    osc.connect(gain);
    overtone.connect(overGain);
    gain.connect(this.masterGain);
    overGain.connect(this.masterGain);

    osc.start(startTime);
    overtone.start(startTime);
    osc.stop(startTime + duration + 0.02);
    overtone.stop(startTime + duration * 0.6);
  }

  /**
   * Treasure Chest Level — Crisp mechanical tick sound when a letter dial snaps to the next letter.
   * @param {number} [stepIndex=0]
   */
  playDialTick(stepIndex = 0) {
    if (!this._ensureReady()) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    const baseFreq = 620 + ((Math.abs(stepIndex) % 6) * 28);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(280, now + 0.028);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.032);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.035);
  }

  /**
   * Treasure Chest Level — Heavy mechanical pin-lock "clunk" + brass chime when a dial locks into place.
   * @param {number} [pinIndex=0]
   */
  playPinLockClunk(pinIndex = 0) {
    if (!this._ensureReady()) return;

    const now = this.ctx.currentTime;

    // 1. Heavy brass tumbler clunk
    const clunkOsc = this.ctx.createOscillator();
    const clunkFilter = this.ctx.createBiquadFilter();
    const clunkGain = this.ctx.createGain();

    clunkOsc.type = 'square';
    clunkOsc.frequency.setValueAtTime(165, now);
    clunkOsc.frequency.exponentialRampToValueAtTime(72, now + 0.09);

    clunkFilter.type = 'lowpass';
    clunkFilter.frequency.setValueAtTime(360, now);

    clunkGain.gain.setValueAtTime(0.001, now);
    clunkGain.gain.linearRampToValueAtTime(0.28, now + 0.01);
    clunkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

    clunkOsc.connect(clunkFilter);
    clunkFilter.connect(clunkGain);
    clunkGain.connect(this.masterGain);
    clunkOsc.start(now);
    clunkOsc.stop(now + 0.12);

    // 2. Warm golden pin-lock resonance
    const noteFreq = PENTATONIC_SCALE[Math.abs(pinIndex) % PENTATONIC_SCALE.length];
    this._playWarmBellNote(noteFreq, now + 0.035, 0.28, 0.2);
  }

  /**
   * Treasure Chest Level — Dull wooden/metallic rattle sound when incorrect dials shake on validation.
   */
  playDialRattle() {
    if (!this._ensureReady()) return;

    const now = this.ctx.currentTime;
    const pulses = [0, 0.065];

    for (const offset of pulses) {
      const t = now + offset;
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(148, t);
      osc.frequency.exponentialRampToValueAtTime(92, t + 0.055);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(320, t);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.2, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.065);
    }
  }

  /**
   * Treasure Chest Level — Celebratory chest opening fanfare (golden sparkle burst or standard warm unlock).
   * @param {boolean} [isGolden=false]
   */
  playChestUnlock(isGolden = false) {
    if (!this._ensureReady()) return;

    this.playLevelSelectChest();
    if (isGolden) {
      const now = this.ctx.currentTime;
      const sparkleNotes = [783.99, 1046.5, 1318.51, 1567.98, 2093.0];
      sparkleNotes.forEach((freq, idx) => {
        this._playWarmBellNote(freq, now + 0.22 + idx * 0.06, 0.45, 0.22);
      });
    }
  }

  /**
   * Treasure Chest Level — Cute plushie squeak when tapped on the wooden shelf.
   * @param {number} [pitchMultiplier=1.0]
   */
  playPlushieSqueak(pitchMultiplier = 1.0) {
    if (!this._ensureReady()) return;

    const now = this.ctx.currentTime;
    const mult = Number.isFinite(pitchMultiplier) ? Math.max(0.75, Math.min(1.35, pitchMultiplier)) : 1.0;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(640 * mult, now);
    osc.frequency.exponentialRampToValueAtTime(1120 * mult, now + 0.065);
    osc.frequency.exponentialRampToValueAtTime(780 * mult, now + 0.15);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.28, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.18);
  }
}

export const soundEngine = new SoundSynthesizer();


