/**
 * 3-Tier Pronunciation Engine (Amazon Fire Tablet / Silk Browser / Mobile Compatible)
 * Configured for Canadian French (fr-CA) with fallback to global French voices.
 *
 * Cascade Order:
 *  1. Tier 1 (Custom Audio URL): Plays local bundled human MP3 audio or custom audio URL from Firebase.
 *  2. Tier 2 (Dictionary API Human Audio): Fetches https://api.dictionaryapi.dev/api/v2/entries/en/<word>,
 *     extracts valid .mp3 phonetic audio URL (if learning English words with French accents),
 *     caches in memory, and plays via HTML5 <audio>.
 *  3. Tier 3 (Web Speech API Canadian French): Uses window.speechSynthesis
 *     prioritizing Canadian French voices (lang = 'fr-CA', rate = 0.85) such as
 *     Microsoft Caroline/Claude/Nathalie or Google French.
 */

import { getDefaultAudioUrl } from './srs.js';

// Minimal valid 44-byte 1-sample silent PCM WAV for gesture-unlocking HTML5 <audio> on Silk/Safari
const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

const DICTIONARY_API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

class SpeechCascadeEngine {
  constructor() {
    /** @type {Map<string, string | null>} */
    this.mp3Cache = new Map();
    /** @type {Map<string, Promise<string | null>>} */
    this.inflightLookups = new Map();
    this.player = typeof Audio !== 'undefined' ? new Audio() : null;
    if (this.player) {
      this.player.preload = 'auto';
    }
    this.activeToken = 0;
    this.voices = [];
    this.speakingListeners = new Set();

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this._refreshVoices();
      if (typeof window.speechSynthesis.addEventListener === 'function') {
        window.speechSynthesis.addEventListener('voiceschanged', () => this._refreshVoices());
      } else {
        window.speechSynthesis.onvoiceschanged = () => this._refreshVoices();
      }
    }
  }

  _refreshVoices() {
    try {
      this.voices = window.speechSynthesis.getVoices() || [];
    } catch {
      this.voices = [];
    }
  }

  onSpeakingStateChange(listener) {
    this.speakingListeners.add(listener);
    return () => this.speakingListeners.delete(listener);
  }

  _notifySpeaking(isSpeaking) {
    for (const fn of this.speakingListeners) {
      try {
        fn(isSpeaking);
      } catch {
        // Ignore UI callback errors
      }
    }
  }

  /**
   * Unlocks both HTML5 <audio> and Web Speech API during the user's "Play" button tap.
   */
  async unlockSpeech() {
    // 1. Unlock shared HTML5 <audio> element for async playback on Silk / mobile WebKit
    if (this.player) {
      try {
        this.player.src = SILENT_WAV_DATA_URI;
        this.player.volume = 0.01;
        const playPromise = this.player.play();
        if (playPromise && typeof playPromise.then === 'function') {
          await playPromise.catch(() => {});
        }
        this.player.pause();
        this.player.volume = 1.0;
      } catch {
        if (this.player) this.player.volume = 1.0;
      }
    }

    // 2. Unlock Web Speech API synthesizer if available
    if (typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') {
      try {
        this._refreshVoices();
        window.speechSynthesis.cancel();
        const primer = new SpeechSynthesisUtterance(' ');
        primer.volume = 0;
        primer.rate = 1;
        primer.lang = 'fr-CA';
        window.speechSynthesis.speak(primer);
      } catch {
        // Silk Browser may throw or no-op if local TTS engine is absent; Tier 1/2 cover it
      }
    }
  }

  /**
   * Quietly pre-fetches Dictionary API .mp3 URLs for the session's word list
   * so audio plays without network delay when each word starts.
   * @param {Array<{word: string, custom_audio_url?: string, audio_url?: string}>} wordList
   */
  prefetchWords(wordList) {
    if (!Array.isArray(wordList)) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    for (const item of wordList) {
      const custom =
        (item && (item.custom_audio_url || item.audio_url) || '').trim() ||
        getDefaultAudioUrl(item && item.word ? item.word : '');
      if (custom) continue;
      const clean = this._cleanWord(item && item.word ? item.word : '');
      if (clean && !this.mp3Cache.has(clean)) {
        this._resolveDictionaryMp3(clean).catch(() => {});
      }
    }
  }

  /**
   * Pronounces a word using the 3-tier audio cascade.
   * @param {string | {word: string, custom_audio_url?: string, audio_url?: string}} wordOrRecord
   * @returns {Promise<{played: boolean, tier: number}>}
   */
  async speakWord(wordOrRecord) {
    const token = ++this.activeToken;
    this._stopActiveAudio();

    const record = typeof wordOrRecord === 'string'
      ? { word: wordOrRecord }
      : (wordOrRecord || { word: '' });

    const cleanWord = this._cleanWord(record.word);
    if (!cleanWord) {
      return { played: false, tier: 0 };
    }

    this._notifySpeaking(true);

    try {
      // TIER 1: Custom Audio URL from Firebase Cloud Firestore or local bundled word sound
      const customUrl =
        String(record.custom_audio_url || record.audio_url || '').trim() ||
        getDefaultAudioUrl(cleanWord);
      if (customUrl) {
        const tier1Ok = await this._playHtml5Audio(this._normalizeUrl(customUrl), token, 4500);
        if (token !== this.activeToken) return { played: false, tier: 0 };
        if (tier1Ok) {
          return { played: true, tier: 1 };
        }
      }

      // TIER 2: High-Quality Human Dictionary Audio (.mp3 cached in memory)
      const dictMp3Url = await this._resolveDictionaryMp3(cleanWord);
      if (token !== this.activeToken) return { played: false, tier: 0 };

      if (dictMp3Url) {
        const tier2Ok = await this._playHtml5Audio(dictMp3Url, token, 4500);
        if (token !== this.activeToken) return { played: false, tier: 0 };
        if (tier2Ok) {
          return { played: true, tier: 2 };
        }
      }

      // TIER 3: Web Speech API Canadian French (lang = 'fr-CA', rate = 0.85)
      const tier3Ok = await this._playWebSpeechFallback(cleanWord, token);
      return { played: tier3Ok, tier: tier3Ok ? 3 : 0 };
    } finally {
      if (token === this.activeToken) {
        this._notifySpeaking(false);
      }
    }
  }

  _stopActiveAudio() {
    if (this.player) {
      try {
        this.player.pause();
        this.player.currentTime = 0;
      } catch {
        // Ignore reset error
      }
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore cancel error
      }
    }
  }

  async _resolveDictionaryMp3(cleanWord) {
    if (this.mp3Cache.has(cleanWord)) {
      return this.mp3Cache.get(cleanWord);
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return null;
    }

    if (this.inflightLookups.has(cleanWord)) {
      return this.inflightLookups.get(cleanWord);
    }

    const lookupPromise = (async () => {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 3200) : null;

      try {
        const response = await fetch(`${DICTIONARY_API_BASE}${encodeURIComponent(cleanWord)}`, {
          method: 'GET',
          signal: controller ? controller.signal : undefined
        });

        if (!response.ok) {
          if (response.status === 404) {
            this.mp3Cache.set(cleanWord, null);
          }
          return null;
        }

        const entries = await response.json();
        const mp3Url = this._extractBestMp3FromEntries(entries);
        this.mp3Cache.set(cleanWord, mp3Url);
        return mp3Url;
      } catch {
        // Do not permanently negative-cache transient network failures
        return null;
      } finally {
        if (timer) clearTimeout(timer);
        this.inflightLookups.delete(cleanWord);
      }
    })();

    this.inflightLookups.set(cleanWord, lookupPromise);
    return lookupPromise;
  }

  _extractBestMp3FromEntries(entries) {
    if (!Array.isArray(entries)) return null;

    const candidates = [];
    for (const entry of entries) {
      const phonetics = entry && Array.isArray(entry.phonetics) ? entry.phonetics : [];
      for (const ph of phonetics) {
        if (ph && typeof ph.audio === 'string') {
          const url = this._normalizeUrl(ph.audio.trim());
          if (/\.mp3(\?.*)?$/i.test(url)) {
            candidates.push(url);
          }
        }
      }
    }

    if (candidates.length === 0) return null;

    // Prefer clear US pronunciation when multiple regional recordings exist, then first valid MP3
    const usMatch = candidates.find((u) => /-us\.mp3/i.test(u));
    if (usMatch) return usMatch;

    const caOrUkMatch = candidates.find((u) => /-(ca|uk)\.mp3/i.test(u));
    if (caOrUkMatch) return caOrUkMatch;

    return candidates[0];
  }

  _playHtml5Audio(url, token, timeoutMs = 4500) {
    return new Promise((resolve) => {
      if (!this.player || !url || token !== this.activeToken) {
        resolve(false);
        return;
      }

      const audio = this.player;
      let settled = false;

      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimer);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        resolve(ok);
      };

      const onEnded = () => finish(true);
      const onError = () => finish(false);

      const safetyTimer = setTimeout(() => {
        // If audio started playing and merely exceeded timeout, treat as played; otherwise fail over
        const progressed = audio.currentTime > 0.05 && !audio.error;
        finish(progressed);
      }, timeoutMs);

      audio.addEventListener('ended', onEnded, { once: true });
      audio.addEventListener('error', onError, { once: true });

      try {
        audio.volume = 1.0;
        audio.src = url;
        audio.load();
        const playResult = audio.play();
        if (playResult && typeof playResult.then === 'function') {
          playResult.catch(() => finish(false));
        }
      } catch {
        finish(false);
      }
    });
  }

  _playWebSpeechFallback(cleanWord, token) {
    return new Promise((resolve) => {
      if (
        token !== this.activeToken ||
        typeof window === 'undefined' ||
        !('speechSynthesis' in window) ||
        typeof SpeechSynthesisUtterance === 'undefined'
      ) {
        resolve(false);
        return;
      }

      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimer);
        resolve(ok);
      };

      // Safety timer prevents deadlock on Fire OS Silk where utterance.onend can fail silently
      const estDuration = Math.max(1700, cleanWord.length * 240);
      const safetyTimer = setTimeout(() => finish(true), estDuration);

      try {
        this._refreshVoices();
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(cleanWord);
        utterance.lang = 'fr-CA';
        utterance.rate = 0.85;
        utterance.pitch = 1.02;
        utterance.volume = 1.0;

        const bestVoice = this._pickCanadianFrenchVoice();
        if (bestVoice) {
          utterance.voice = bestVoice;
          utterance.lang = bestVoice.lang || 'fr-CA';
        }

        utterance.onend = () => finish(true);
        utterance.onerror = () => finish(false);

        window.speechSynthesis.speak(utterance);
      } catch {
        finish(false);
      }
    });
  }

  /**
   * Prioritizes Canadian French (fr-CA) voices, followed by any French (fr) voice.
   */
  _pickCanadianFrenchVoice() {
    if (!this.voices || this.voices.length === 0) return null;

    // 1. Exact Canadian French matches (fr-CA)
    const frCaVoices = this.voices.filter((v) => /^fr[-_]CA/i.test(v.lang));
    // Prefer friendly natural Canadian French voices if available (e.g. Caroline, Nathalie, Chantal)
    const preferredCa = frCaVoices.find((v) =>
      /caroline|nathalie|chantal|claude|amelie|antoine|florence|natural/i.test(v.name)
    );
    if (preferredCa) return preferredCa;
    if (frCaVoices.length > 0) return frCaVoices[0];

    // 2. Fallback to any voice with "Canada" or "Canadian" in its name and French language
    const caByName = this.voices.find((v) => /^fr/i.test(v.lang) && /canada|canad/i.test(v.name));
    if (caByName) return caByName;

    // 3. Fallback to any French voice (fr-FR, fr-BE, fr-CH, etc.)
    const anyFr = this.voices.find((v) => /^fr/i.test(v.lang));
    if (anyFr) return anyFr;

    return null;
  }

  _normalizeUrl(url) {
    if (!url) return '';
    let target = url;
    if (target.startsWith('//')) {
      target = `https:${target}`;
    }
    try {
      return encodeURI(decodeURI(target));
    } catch {
      return target;
    }
  }

  _cleanWord(raw) {
    return String(raw || '').trim().toLowerCase();
  }
}

export const speechEngine = new SpeechCascadeEngine();
