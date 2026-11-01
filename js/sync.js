/**
 * Cloud Sync Manager for Google Sheets Apps Script Backend + Offline Queue + QR Code Setup
 *
 * Features:
 * - Auto-configures sync URL when opened with ?syncUrl=... query parameter (one-tap Fire Tablet setup).
 * - Offline-first queue: saves dirty SRS updates and weekly additions locally, syncing automatically
 *   whenever online or at session start using Content-Type: text/plain to avoid CORS preflight blocks.
 * - Pure client-side ISO/IEC 18004 SVG QR Code generator (zero external network/tracking dependencies).
 */

import { mergeWordsFromCloud, loadWords } from './srs.js';

const SYNC_URL_STORAGE_KEY = 'hottub_gas_webapp_url_v1';
const DIRTY_WORDS_STORAGE_KEY = 'hottub_dirty_srs_queue_v1';
const PENDING_WEEKLY_STORAGE_KEY = 'hottub_pending_weekly_batches_v1';
const LAST_SYNC_STORAGE_KEY = 'hottub_last_sync_iso_v1';

class CloudSyncManager {
  constructor() {
    this.syncing = false;
    this.statusListeners = new Set();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.syncNow().catch(() => {});
      });
    }
  }

  onStatusChange(listener) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  _emitStatus(detail) {
    for (const fn of this.statusListeners) {
      try {
        fn(detail);
      } catch {
        // Ignore UI listener error
      }
    }
  }

  getSyncUrl() {
    return (localStorage.getItem(SYNC_URL_STORAGE_KEY) || '').trim();
  }

  setSyncUrl(url) {
    const cleaned = String(url || '').trim();
    if (!cleaned) {
      localStorage.removeItem(SYNC_URL_STORAGE_KEY);
      this._emitStatus({ connected: false, message: 'Local storage only (no Cloud URL set)' });
      return '';
    }
    localStorage.setItem(SYNC_URL_STORAGE_KEY, cleaned);
    this._emitStatus({ connected: true, message: 'Cloud URL saved' });
    return cleaned;
  }

  getLastSyncTime() {
    return localStorage.getItem(LAST_SYNC_STORAGE_KEY) || '';
  }

  /**
   * Checks for ?syncUrl=... in the browser address bar so opening a shared link or QR code
   * on an Amazon Fire Tablet automatically configures the Google Apps Script backend URL.
   */
  consumeAutoConfigFromUrl() {
    if (typeof window === 'undefined') return null;

    try {
      const params = new URLSearchParams(window.location.search);
      const incomingUrl = (params.get('syncUrl') || '').trim();
      if (!incomingUrl) return null;

      if (/^https?:\/\//i.test(incomingUrl)) {
        this.setSyncUrl(incomingUrl);
        params.delete('syncUrl');
        const remainingQuery = params.toString();
        const cleanHref = `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ''}${window.location.hash}`;
        window.history.replaceState({}, document.title, cleanHref);
        return incomingUrl;
      }
    } catch (err) {
      console.warn('Auto-config URL parse warning:', err);
    }
    return null;
  }

  /**
   * Generates a shareable one-tap setup URL containing ?syncUrl=...
   */
  buildShareableSetupLink(customUrl) {
    const url = String(customUrl !== undefined ? customUrl : this.getSyncUrl()).trim();
    if (!url || typeof window === 'undefined') return '';
    const base = `${window.location.origin}${window.location.pathname}`;
    return `${base}?syncUrl=${encodeURIComponent(url)}`;
  }

  /**
   * Queues a word's updated SRS progression locally and pushes immediately if online.
   */
  async queueWordUpdate(wordRecord) {
    if (!wordRecord || !wordRecord.word) return;

    const queue = this._loadDirtyMap();
    queue[wordRecord.word] = {
      word: wordRecord.word,
      week_label: wordRecord.week_label,
      active: wordRecord.active !== false,
      box: wordRecord.box,
      next_review: wordRecord.next_review,
      streak: wordRecord.streak,
      total_attempts: wordRecord.total_attempts,
      custom_audio_url: wordRecord.custom_audio_url || ''
    };
    this._saveDirtyMap(queue);

    if (this.getSyncUrl() && navigator.onLine !== false) {
      await this.flushPendingChanges();
    }
  }

  /**
   * Pushes a new weekly list of 6-10 words to Google Sheets (or queues offline).
   */
  async pushWeeklyWordList(weekLabel, wordRecords) {
    const syncUrl = this.getSyncUrl();
    const payloadBatch = {
      week_label: weekLabel,
      words: wordRecords.map((w) => ({
        word: w.word,
        week_label: weekLabel,
        active: true,
        box: w.box || 1,
        next_review: w.next_review,
        streak: w.streak || 0,
        total_attempts: w.total_attempts || 0,
        custom_audio_url: w.custom_audio_url || ''
      }))
    };

    if (!syncUrl) {
      return { ok: true, localOnly: true };
    }

    if (navigator.onLine === false) {
      this._enqueueWeeklyBatch(payloadBatch);
      return { ok: true, queuedOffline: true };
    }

    try {
      const res = await this._postJsonTextPlain(syncUrl, {
        action: 'add_weekly_words',
        ...payloadBatch
      });

      if (res && res.ok && Array.isArray(res.words)) {
        mergeWordsFromCloud(res.words, this.getDirtyWordSet());
        this._recordSyncSuccess();
        return { ok: true, synced: true };
      }
      throw new Error((res && res.error) || 'Unexpected response from Google Sheet');
    } catch (err) {
      this._enqueueWeeklyBatch(payloadBatch);
      return { ok: false, queuedOffline: true, error: String(err.message || err) };
    }
  }

  /**
   * Deletes a word remotely if Cloud Sync is connected.
   */
  async deleteWordRemote(word) {
    const syncUrl = this.getSyncUrl();
    const dirty = this._loadDirtyMap();
    if (dirty[word]) {
      delete dirty[word];
      this._saveDirtyMap(dirty);
    }

    if (!syncUrl || navigator.onLine === false) {
      return { ok: true, localOnly: true };
    }

    try {
      await this._postJsonTextPlain(syncUrl, {
        action: 'delete_word',
        word
      });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  /**
   * Full 2-way sync:
   * 1. Flushes any offline-queued weekly word additions and SRS progress updates.
   * 2. Pulls full word list & SRS progression from Google Sheets and merges into localStorage.
   */
  async syncNow(timeoutMs = 4500) {
    const syncUrl = this.getSyncUrl();
    if (!syncUrl) {
      return { ok: false, reason: 'no_url', words: loadWords() };
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this._emitStatus({ connected: false, message: 'Offline — using saved local words' });
      return { ok: false, reason: 'offline', words: loadWords() };
    }
    if (this.syncing) {
      return { ok: true, reason: 'in_progress', words: loadWords() };
    }

    this.syncing = true;
    this._emitStatus({ syncing: true, message: 'Syncing with Google Sheets...' });

    try {
      await this.flushPendingChanges(timeoutMs);

      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

      try {
        const sep = syncUrl.includes('?') ? '&' : '?';
        const response = await fetch(`${syncUrl}${sep}_t=${Date.now()}`, {
          method: 'GET',
          redirect: 'follow',
          signal: controller ? controller.signal : undefined
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!data || data.ok === false) {
          throw new Error((data && data.error) || 'Invalid response from Apps Script');
        }

        const remoteWords = Array.isArray(data.words) ? data.words : [];
        // If remote sheet is brand new and completely empty, push our local starter words up!
        if (remoteWords.length === 0) {
          const localStarter = loadWords();
          await this._postJsonTextPlain(
            syncUrl,
            { action: 'sync_progress', updates: localStarter },
            timeoutMs
          );
          this._recordSyncSuccess();
          this._emitStatus({ connected: true, message: 'Initialized empty Google Sheet with starter words' });
          return { ok: true, words: localStarter };
        }

        const merged = mergeWordsFromCloud(remoteWords, this.getDirtyWordSet());
        this._recordSyncSuccess();
        this._emitStatus({ connected: true, message: `Synced (${merged.length} words)` });
        return { ok: true, words: merged };
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (err) {
      const msg = String(err && err.name === 'AbortError' ? 'Sync timed out — playing offline' : (err.message || err));
      this._emitStatus({ connected: false, error: true, message: msg });
      return { ok: false, reason: 'network_error', error: msg, words: loadWords() };
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Flushes pending weekly batches and dirty SRS updates to Google Sheets.
   */
  async flushPendingChanges(timeoutMs = 4500) {
    const syncUrl = this.getSyncUrl();
    if (!syncUrl || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      return false;
    }

    // 1. Flush pending weekly word additions
    const weeklyBatches = this._loadWeeklyBatches();
    if (weeklyBatches.length > 0) {
      const remaining = [];
      for (const batch of weeklyBatches) {
        try {
          const res = await this._postJsonTextPlain(
            syncUrl,
            { action: 'add_weekly_words', ...batch },
            timeoutMs
          );
          if (!res || res.ok === false) {
            remaining.push(batch);
          }
        } catch {
          remaining.push(batch);
        }
      }
      this._saveWeeklyBatches(remaining);
    }

    // 2. Flush dirty SRS word updates
    const dirtyMap = this._loadDirtyMap();
    const updates = Object.values(dirtyMap);
    if (updates.length === 0) return true;

    try {
      const res = await this._postJsonTextPlain(
        syncUrl,
        { action: 'sync_progress', updates },
        timeoutMs
      );
      if (res && res.ok) {
        this._saveDirtyMap({});
        this._recordSyncSuccess();
        return true;
      }
    } catch {
      // Keep dirty queue intact for next online retry
    }
    return false;
  }

  getDirtyWordSet() {
    return new Set(Object.keys(this._loadDirtyMap()));
  }

  getPendingSyncCount() {
    return Object.keys(this._loadDirtyMap()).length + this._loadWeeklyBatches().length;
  }

  async _postJsonTextPlain(url, payload, timeoutMs = 5500) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'follow',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  _recordSyncSuccess() {
    const iso = new Date().toISOString();
    localStorage.setItem(LAST_SYNC_STORAGE_KEY, iso);
  }

  _loadDirtyMap() {
    try {
      const raw = localStorage.getItem(DIRTY_WORDS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  _saveDirtyMap(map) {
    try {
      localStorage.setItem(DIRTY_WORDS_STORAGE_KEY, JSON.stringify(map));
    } catch {
      // Ignore quota errors
    }
  }

  _loadWeeklyBatches() {
    try {
      const raw = localStorage.getItem(PENDING_WEEKLY_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  _saveWeeklyBatches(list) {
    try {
      localStorage.setItem(PENDING_WEEKLY_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Ignore
    }
  }

  _enqueueWeeklyBatch(batch) {
    const list = this._loadWeeklyBatches();
    list.push(batch);
    this._saveWeeklyBatches(list);
  }
}

export const syncManager = new CloudSyncManager();

/* ============================================================================
 * Pure Client-Side ISO/IEC 18004 SVG QR Code Generator (Byte Mode, EC Level L)
 * Supports Versions 1-14 (up to 458 UTF-8 bytes) with zero external APIs.
 * ============================================================================ */

// [totalDataBytes, ecBytesPerBlock, numBlocksGroup1, dataPerBlock1, numBlocksGroup2, dataPerBlock2, alignmentCenters]
const QR_VERSIONS_L = [
  null,
  [19, 7, 1, 19, 0, 0, []],
  [34, 10, 1, 34, 0, 0, [6, 18]],
  [55, 15, 1, 55, 0, 0, [6, 22]],
  [80, 20, 1, 80, 0, 0, [6, 26]],
  [108, 26, 1, 108, 0, 0, [6, 30]],
  [136, 18, 2, 68, 0, 0, [6, 34]],
  [156, 20, 2, 78, 0, 0, [6, 22, 38]],
  [194, 24, 2, 97, 0, 0, [6, 24, 42]],
  [232, 30, 2, 116, 0, 0, [6, 26, 46]],
  [274, 18, 2, 68, 2, 69, [6, 28, 50]],
  [324, 20, 4, 81, 0, 0, [6, 30, 54]],
  [370, 24, 2, 92, 2, 93, [6, 32, 58]],
  [428, 26, 4, 107, 0, 0, [6, 34, 62]],
  [461, 30, 3, 115, 1, 116, [6, 26, 46, 66]]
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsComputeRemainder(data, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    for (let j = 0; j < ecLen; j++) {
      rem[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return rem;
}

/**
 * Generates an inline SVG string for a scannable QR code representing `text`.
 * @param {string} text
 * @returns {string} SVG markup
 */
export function generateQrCodeSvg(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  if (bytes.length === 0) return '';

  // Choose smallest QR version that fits byte payload + mode/length header
  let version = 0;
  for (let v = 1; v < QR_VERSIONS_L.length; v++) {
    const headerBytes = v <= 9 ? 2 : 3; // 4-bit mode + (8 or 16)-bit char count + 4-bit terminator
    if (bytes.length + headerBytes <= QR_VERSIONS_L[v][0]) {
      version = v;
      break;
    }
  }
  if (!version) {
    return '<p class="qr-fallback-note">Link is too long for QR preview — use Copy Link below.</p>';
  }

  const [totalDataBytes, ecLen, b1Count, b1Data, b2Count, b2Data, alignCenters] = QR_VERSIONS_L[version];

  // Encode bit stream: Byte mode (0100) + character count + payload + terminator + pad bytes
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  pushBits(0b0100, 4);
  pushBits(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);

  const maxDataBits = totalDataBytes * 8;
  pushBits(0, Math.min(4, maxDataBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCodewords = new Uint8Array(totalDataBytes);
  for (let i = 0; i < bits.length / 8; i++) {
    let byteVal = 0;
    for (let bit = 0; bit < 8; bit++) {
      byteVal = (byteVal << 1) | bits[i * 8 + bit];
    }
    dataCodewords[i] = byteVal;
  }

  const padBytes = [0xec, 0x11];
  for (let i = bits.length / 8, p = 0; i < totalDataBytes; i++, p++) {
    dataCodewords[i] = padBytes[p % 2];
  }

  // Split into RS blocks & interleave
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;

  for (let i = 0; i < b1Count; i++) {
    const blk = dataCodewords.slice(offset, offset + b1Data);
    offset += b1Data;
    dataBlocks.push(blk);
    ecBlocks.push(rsComputeRemainder(blk, ecLen));
  }
  for (let i = 0; i < b2Count; i++) {
    const blk = dataCodewords.slice(offset, offset + b2Data);
    offset += b2Data;
    dataBlocks.push(blk);
    ecBlocks.push(rsComputeRemainder(blk, ecLen));
  }

  const finalCodewords = [];
  const maxBlockLen = Math.max(b1Data, b2Data);
  for (let i = 0; i < maxBlockLen; i++) {
    for (const blk of dataBlocks) {
      if (i < blk.length) finalCodewords.push(blk[i]);
    }
  }
  for (let i = 0; i < ecLen; i++) {
    for (const ec of ecBlocks) {
      finalCodewords.push(ec[i]);
    }
  }

  // Build QR matrix
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Uint8Array(size));
  const isFunc = Array.from({ length: size }, () => new Uint8Array(size));

  const setFunctionModule = (x, y, dark) => {
    if (x >= 0 && x < size && y >= 0 && y < size) {
      modules[y][x] = dark ? 1 : 0;
      isFunc[y][x] = 1;
    }
  };

  const drawFinder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFunctionModule(cx + dx, cy + dy, dist !== 2 && dist !== 4);
      }
    }
  };

  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunctionModule(i, 6, i % 2 === 0);
    setFunctionModule(6, i, i % 2 === 0);
  }

  // Alignment patterns
  for (let i = 0; i < alignCenters.length; i++) {
    for (let j = 0; j < alignCenters.length; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === alignCenters.length - 1) ||
        (i === alignCenters.length - 1 && j === 0)
      ) {
        continue;
      }
      const cx = alignCenters[i];
      const cy = alignCenters[j];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFunctionModule(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // Reserve Format Info & Dark Module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFunctionModule(8, i, false);
      setFunctionModule(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    setFunctionModule(size - 1 - i, 8, false);
    setFunctionModule(8, size - 1 - i, false);
  }
  setFunctionModule(8, size - 8, true); // Dark module

  // Version Information (Versions 7+)
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) {
      rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    }
    const vBits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((vBits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunctionModule(b, a, bit);
      setFunctionModule(a, b, bit);
    }
  }

  // Place data bits in upward/downward 2-column zig-zag
  let bitIdx = 0;
  const totalPayloadBits = finalCodewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunc[y][x] && bitIdx < totalPayloadBits) {
          const byteVal = finalCodewords[bitIdx >>> 3];
          const dark = ((byteVal >>> (7 - (bitIdx & 7))) & 1) === 1;
          modules[y][x] = dark ? 1 : 0;
          bitIdx++;
        }
      }
    }
  }

  // Apply Mask Pattern 0: (x + y) % 2 === 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFunc[y][x] && (x + y) % 2 === 0) {
        modules[y][x] ^= 1;
      }
    }
  }

  // Write Format Information for EC Level L (01) + Mask 0 (000) -> 0x77c4
  const formatBits = 0x77c4;
  for (let i = 0; i <= 5; i++) setFunctionModule(8, i, ((formatBits >>> i) & 1) === 1);
  setFunctionModule(8, 7, ((formatBits >>> 6) & 1) === 1);
  setFunctionModule(8, 8, ((formatBits >>> 7) & 1) === 1);
  setFunctionModule(7, 8, ((formatBits >>> 8) & 1) === 1);
  for (let i = 9; i < 15; i++) setFunctionModule(14 - i, 8, ((formatBits >>> i) & 1) === 1);

  for (let i = 0; i < 8; i++) setFunctionModule(size - 1 - i, 8, ((formatBits >>> i) & 1) === 1);
  for (let i = 8; i < 15; i++) setFunctionModule(8, size - 15 + i, ((formatBits >>> i) & 1) === 1);
  setFunctionModule(8, size - 8, true);

  // Render crisp SVG path with 4-module quiet zone
  const margin = 4;
  const viewSize = size + margin * 2;
  let pathData = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) {
        pathData += `M${x + margin},${y + margin}h1v1h-1z`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges" class="qr-svg" role="img" aria-label="QR Code for Tablet Sync Setup"><rect width="${viewSize}" height="${viewSize}" rx="2" fill="#FFFDF8"/><path d="${pathData}" fill="#4A3525"/></svg>`;
}
