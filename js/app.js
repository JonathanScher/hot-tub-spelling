/**
 * Cozy Tub Spelling — Main Application Controller & Parent Dashboard
 */

import { soundEngine } from './audio.js';
import { speechEngine } from './speech.js';
import {
  loadWords,
  buildSessionWords,
  recordFirstAttemptSRS,
  addWeeklyWordList,
  removeWordFromStore,
  suggestNextWeekLabel,
  getCurrentWeekLabel,
  getLocalISODate,
  normalizeWord
} from './srs.js';
import { syncManager, generateQrCodeSvg } from './sync.js';
import { HotTubGame } from './game.js';

const LOCK_HOLD_DURATION_MS = 2000;
const RING_CIRCUMFERENCE = 120;

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  // DOM References
  const startOverlay = document.getElementById('start-overlay');
  const startWeekPill = document.getElementById('start-week-pill');
  const startSyncNote = document.getElementById('start-sync-note');
  const btnPlay = document.getElementById('btn-play');
  const btnPlayText = document.getElementById('btn-play-text');

  const completeOverlay = document.getElementById('complete-overlay');
  const completeSummaryText = document.getElementById('complete-summary-text');
  const completeWordChips = document.getElementById('complete-word-chips');
  const btnPlayAgain = document.getElementById('btn-play-again');

  const btnListen = document.getElementById('btn-listen');
  const btnHint = document.getElementById('btn-hint');
  const btnSfxToggle = document.getElementById('btn-sfx-toggle');
  const iconSfxOn = document.getElementById('icon-sfx-on');
  const iconSfxOff = document.getElementById('icon-sfx-off');
  const syncStatusDot = document.getElementById('sync-status-dot');

  const btnParentLock = document.getElementById('btn-parent-lock');
  const lockHoldRing = document.getElementById('lock-hold-ring');

  const mathGateModal = document.getElementById('math-gate-modal');
  const formMathGate = document.getElementById('form-math-gate');
  const mathQuestionLabel = document.getElementById('math-question-label');
  const inputMathAnswer = document.getElementById('input-math-answer');
  const mathGateError = document.getElementById('math-gate-error');
  const btnCancelMath = document.getElementById('btn-cancel-math');

  const parentModal = document.getElementById('parent-modal');
  const btnCloseParent = document.getElementById('btn-close-parent');
  const inputSyncUrl = document.getElementById('input-sync-url');
  const btnSaveSync = document.getElementById('btn-save-sync');
  const parentSyncBadge = document.getElementById('parent-sync-badge');
  const shareSetupPanel = document.getElementById('share-setup-panel');
  const qrCodeContainer = document.getElementById('qr-code-container');
  const inputShareLink = document.getElementById('input-share-link');
  const btnCopyShareLink = document.getElementById('btn-copy-share-link');

  const inputWeekLabel = document.getElementById('input-week-label');
  const inputWeeklyWords = document.getElementById('input-weekly-words');
  const weeklyWordCount = document.getElementById('weekly-word-count');
  const btnAddWeekly = document.getElementById('btn-add-weekly');

  const statTotalWords = document.getElementById('stat-total-words');
  const statDueWords = document.getElementById('stat-due-words');
  const statMasteredWords = document.getElementById('stat-mastered-words');
  const parentWordsTbody = document.getElementById('parent-words-tbody');

  const toastEl = document.getElementById('app-toast');
  let toastTimer = null;

  function showToast(msg, duration = 3200) {
    if (!toastEl) return;
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.hidden = false;
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, duration);
  }

  // Instantiate Core Game Engine
  const game = new HotTubGame({
    bubbleStage: document.getElementById('bubble-stage'),
    slotsContainer: document.getElementById('word-slots'),
    flyingLayer: document.getElementById('flying-layer'),
    mascotWrap: document.getElementById('mascot-wrap'),
    mascotSpeech: document.getElementById('mascot-speech'),
    hintButton: btnHint,
    progressFill: document.getElementById('progress-pebbles'),
    progressLabel: document.getElementById('progress-label'),
    retryBadge: document.getElementById('retry-badge'),

    onFirstAttemptComplete: (wordStr, firstAttemptErrors) => {
      const updatedRecord = recordFirstAttemptSRS(wordStr, firstAttemptErrors);
      if (updatedRecord) {
        syncManager.queueWordUpdate(updatedRecord).catch(() => {});
      }
    },

    onSessionComplete: (summary) => {
      renderCompletionScreen(summary);
    }
  });

  // 1. Check ?syncUrl=... query parameter for one-tap Amazon Fire Tablet configuration
  const autoConfiguredUrl = syncManager.consumeAutoConfigFromUrl();
  if (autoConfiguredUrl) {
    showToast('Cloud Sync URL automatically configured for this device!', 4200);
    syncManager.syncNow().then(() => refreshWelcomeMetadata());
  }

  // 2. Wire Sync Status Indicator
  syncManager.onStatusChange((status) => {
    if (!syncStatusDot) return;
    syncStatusDot.classList.toggle('is-syncing', Boolean(status.syncing));
    syncStatusDot.classList.toggle('is-online', Boolean(status.connected && !status.syncing));
    if (status.message) {
      syncStatusDot.title = status.message;
    }
    updateParentSyncBadge(status);
  });

  // 3. Wire Speech Speaking Pulse on "Listen Again" Button
  speechEngine.onSpeakingStateChange((isSpeaking) => {
    if (btnListen) {
      btnListen.classList.toggle('is-speaking', isSpeaking);
    }
  });

  // 4. Sound Effects Mute Toggle
  function syncSfxIcons() {
    const muted = soundEngine.isMuted();
    if (iconSfxOn) iconSfxOn.hidden = muted;
    if (iconSfxOff) iconSfxOff.hidden = !muted;
  }
  syncSfxIcons();

  btnSfxToggle.addEventListener('click', () => {
    soundEngine.setMuted(!soundEngine.isMuted());
    syncSfxIcons();
    if (!soundEngine.isMuted()) {
      soundEngine.unlockAudio().then(() => soundEngine.playUiTap());
    }
  });

  // 5. Refresh Welcome Screen Metadata
  function refreshWelcomeMetadata() {
    const words = loadWords();
    const activeWords = words.filter((w) => w.active !== false);
    const currentWeek = getCurrentWeekLabel(activeWords);
    const today = getLocalISODate();
    const dueCount = activeWords.filter((w) => !w.next_review || w.next_review <= today).length;

    if (startWeekPill) {
      startWeekPill.textContent = `${currentWeek} • Cozy Bathhouse`;
    }

    const hasCloud = Boolean(syncManager.getSyncUrl());
    if (startSyncNote) {
      const syncText = hasCloud ? 'Google Sheets Sync active' : 'Offline-ready local storage';
      startSyncNote.textContent = `${activeWords.length} words (${dueCount} due today) • ${syncText}`;
    }

    if (syncStatusDot) {
      syncStatusDot.classList.toggle('is-online', hasCloud && navigator.onLine !== false);
    }
  }
  refreshWelcomeMetadata();

  // 6. Session Start ("Play" & "Play Again" Buttons)
  async function launchNewSession(triggerBtn, labelEl) {
    if (triggerBtn) triggerBtn.disabled = true;
    const prevText = labelEl ? labelEl.textContent : '';
    if (labelEl) labelEl.textContent = 'Warming tub...';

    // Unlock Web Audio API & 3-Tier Speech Cascade inside direct tap gesture!
    await Promise.all([
      soundEngine.unlockAudio(),
      speechEngine.unlockSpeech()
    ]);
    soundEngine.playBubblePop(2);

    // Fetch latest word list & SRS progression from Google Sheets if configured (falling back to localStorage)
    if (syncManager.getSyncUrl() && navigator.onLine !== false) {
      await syncManager.syncNow(3500);
    }

    const allWords = loadWords();
    const sessionWords = buildSessionWords(allWords, 8, 10);

    if (startOverlay) {
      startOverlay.hidden = true;
      startOverlay.classList.remove('is-active');
    }
    if (completeOverlay) {
      completeOverlay.hidden = true;
      completeOverlay.classList.remove('is-active');
    }

    if (triggerBtn) triggerBtn.disabled = false;
    if (labelEl && prevText) labelEl.textContent = prevText;

    refreshWelcomeMetadata();
    game.startSession(sessionWords, allWords);
  }

  btnPlay.addEventListener('click', () => launchNewSession(btnPlay, btnPlayText));
  btnPlayAgain.addEventListener('click', () => launchNewSession(btnPlayAgain, null));

  // 7. Gameplay HUD Buttons ("Listen Again" & "Hint")
  btnListen.addEventListener('click', () => {
    soundEngine.playUiTap();
    game.replayCurrentWord();
  });

  btnHint.addEventListener('click', () => {
    game.useHintButton();
  });

  // 8. Session Completion Screen
  function renderCompletionScreen(summary) {
    if (!completeOverlay) return;
    const allWordsByKey = new Map(loadWords().map((w) => [w.word, w]));

    if (completeSummaryText) {
      completeSummaryText.textContent =
        summary.firstTryPerfect === summary.totalWords
          ? `Spotless! All ${summary.totalWords} words spelled with zero errors on the first try!`
          : `All ${summary.totalWords} words mastered! (${summary.firstTryPerfect} spotless on first try)`;
    }

    if (completeWordChips) {
      completeWordChips.innerHTML = '';
      for (const item of summary.results) {
        const rec = allWordsByKey.get(item.word);
        const boxNum = rec ? rec.box : 1;
        const chip = document.createElement('span');
        chip.className = `word-chip${item.masteredFirstTry ? '' : ' practiced'}`;
        chip.textContent = `${item.word} • Box ${boxNum}`;
        completeWordChips.appendChild(chip);
      }
    }

    completeOverlay.hidden = false;
    completeOverlay.classList.add('is-active');
  }

  // 9. Discreet Parent Lock (2-Second Long-Press OR Quick Math Check)
  let holdStartTs = 0;
  let holdRaf = null;
  let holdTriggered = false;
  let expectedMathSum = 13;

  function resetHoldRing() {
    if (holdRaf) {
      cancelAnimationFrame(holdRaf);
      holdRaf = null;
    }
    btnParentLock.classList.remove('is-holding');
    if (lockHoldRing) {
      lockHoldRing.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
    }
  }

  function animateHoldProgress() {
    const elapsed = performance.now() - holdStartTs;
    const progress = Math.min(1, elapsed / LOCK_HOLD_DURATION_MS);
    if (lockHoldRing) {
      const offset = RING_CIRCUMFERENCE * (1 - progress);
      lockHoldRing.style.strokeDashoffset = offset.toFixed(1);
    }
    if (progress >= 1) {
      holdTriggered = true;
      resetHoldRing();
      soundEngine.playUiTap();
      openParentDashboard();
      return;
    }
    holdRaf = requestAnimationFrame(animateHoldProgress);
  }

  btnParentLock.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    holdTriggered = false;
    holdStartTs = performance.now();
    btnParentLock.classList.add('is-holding');
    if (holdRaf) cancelAnimationFrame(holdRaf);
    holdRaf = requestAnimationFrame(animateHoldProgress);
  });

  const endLockHold = () => {
    if (!btnParentLock.classList.contains('is-holding')) return;
    const elapsed = performance.now() - holdStartTs;
    resetHoldRing();
    // If tapped briefly (< 2s) without completing hold, offer simple Parent Math Check
    if (!holdTriggered && elapsed < LOCK_HOLD_DURATION_MS) {
      openMathGate();
    }
  };

  btnParentLock.addEventListener('pointerup', endLockHold);
  btnParentLock.addEventListener('pointercancel', resetHoldRing);
  btnParentLock.addEventListener('pointerleave', resetHoldRing);
  btnParentLock.addEventListener('contextmenu', (e) => e.preventDefault());

  function openMathGate() {
    game.pause();
    const a = 6 + Math.floor(Math.random() * 8);
    const b = 5 + Math.floor(Math.random() * 9);
    expectedMathSum = a + b;
    mathQuestionLabel.textContent = `${a} + ${b} = ?`;
    inputMathAnswer.value = '';
    mathGateError.hidden = true;
    mathGateModal.hidden = false;
    setTimeout(() => inputMathAnswer.focus(), 60);
  }

  function closeMathGate(resumeGame = true) {
    mathGateModal.hidden = true;
    if (resumeGame) game.resume();
  }

  btnCancelMath.addEventListener('click', () => closeMathGate(true));

  formMathGate.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const val = parseInt(inputMathAnswer.value, 10);
    if (val === expectedMathSum) {
      closeMathGate(false);
      soundEngine.playUiTap();
      openParentDashboard();
    } else {
      mathGateError.hidden = false;
      inputMathAnswer.value = '';
      inputMathAnswer.focus();
    }
  });

  // 10. Parent Dashboard Operations
  function openParentDashboard() {
    game.pause();
    const currentUrl = syncManager.getSyncUrl();
    inputSyncUrl.value = currentUrl;
    inputWeekLabel.value = suggestNextWeekLabel();
    updateShareSetupPreview(currentUrl);
    updateParentSyncBadge({
      connected: Boolean(currentUrl),
      message: currentUrl ? 'Cloud Sync Configured' : 'Local Mode'
    });
    updateWeeklyCountBadge();
    renderParentWordsTable();
    parentModal.hidden = false;
  }

  function closeParentDashboard() {
    parentModal.hidden = true;
    refreshWelcomeMetadata();
    game.resume();
  }

  btnCloseParent.addEventListener('click', closeParentDashboard);

  parentModal.addEventListener('click', (ev) => {
    if (ev.target === parentModal) {
      closeParentDashboard();
    }
  });

  function updateParentSyncBadge(status) {
    if (!parentSyncBadge) return;
    const hasUrl = Boolean(syncManager.getSyncUrl());
    parentSyncBadge.classList.toggle('is-connected', Boolean(hasUrl && status.connected !== false));
    if (status && status.message) {
      parentSyncBadge.textContent = status.message;
    } else {
      parentSyncBadge.textContent = hasUrl ? 'Cloud Connected' : 'Local Mode';
    }
  }

  function updateShareSetupPreview(url) {
    const clean = String(url || '').trim();
    if (!clean) {
      shareSetupPanel.hidden = true;
      return;
    }

    const shareLink = syncManager.buildShareableSetupLink(clean);
    inputShareLink.value = shareLink;
    qrCodeContainer.innerHTML = generateQrCodeSvg(shareLink);
    shareSetupPanel.hidden = false;
  }

  btnSaveSync.addEventListener('click', async () => {
    const url = inputSyncUrl.value.trim();
    syncManager.setSyncUrl(url);
    updateShareSetupPreview(url);

    if (!url) {
      showToast('Switched to offline local storage mode.');
      renderParentWordsTable();
      return;
    }

    btnSaveSync.disabled = true;
    btnSaveSync.textContent = 'Syncing...';
    const result = await syncManager.syncNow(6000);
    btnSaveSync.disabled = false;
    btnSaveSync.textContent = 'Save & Sync';

    renderParentWordsTable();
    refreshWelcomeMetadata();

    if (result.ok) {
      showToast(`Connected & synced (${result.words.length} words)!`);
    } else {
      showToast(`URL saved! (${result.error || 'Will sync when online'})`);
    }
  });

  btnCopyShareLink.addEventListener('click', async () => {
    const link = inputShareLink.value;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      showToast('Tablet setup link copied to clipboard!');
    } catch {
      inputShareLink.select();
      document.execCommand('copy');
      showToast('Tablet setup link copied!');
    }
  });

  // Parse weekly textarea lines/commas into structured { word, custom_audio_url } entries
  function parseWeeklyTextarea(rawText) {
    const segments = String(rawText || '')
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const parsed = [];
    const seen = new Set();

    for (const seg of segments) {
      const [wordPart, urlPart] = seg.split('|').map((s) => (s || '').trim());
      const cleanWord = normalizeWord(wordPart);
      if (cleanWord && !seen.has(cleanWord)) {
        seen.add(cleanWord);
        parsed.push({
          word: cleanWord,
          custom_audio_url: urlPart && /^https?:\/\//i.test(urlPart) ? urlPart : ''
        });
      }
    }
    return parsed;
  }

  function updateWeeklyCountBadge() {
    const items = parseWeeklyTextarea(inputWeeklyWords.value);
    const count = items.length;
    weeklyWordCount.textContent =
      count === 0
        ? '0 words'
        : count >= 6 && count <= 10
          ? `${count} words (ideal!)`
          : `${count} word${count === 1 ? '' : 's'}`;
    weeklyWordCount.classList.toggle('is-connected', count >= 6 && count <= 10);
  }

  inputWeeklyWords.addEventListener('input', updateWeeklyCountBadge);

  btnAddWeekly.addEventListener('click', async () => {
    const entries = parseWeeklyTextarea(inputWeeklyWords.value);
    if (entries.length === 0) {
      showToast('Please enter at least 1 word first.');
      inputWeeklyWords.focus();
      return;
    }

    const weekLabel = inputWeekLabel.value.trim() || suggestNextWeekLabel();
    btnAddWeekly.disabled = true;
    btnAddWeekly.textContent = 'Saving...';

    const { addedRecords } = addWeeklyWordList(entries, weekLabel);
    const syncRes = await syncManager.pushWeeklyWordList(weekLabel, addedRecords);

    btnAddWeekly.disabled = false;
    btnAddWeekly.textContent = 'Add & Sync Weekly List';
    inputWeeklyWords.value = '';
    inputWeekLabel.value = suggestNextWeekLabel();
    updateWeeklyCountBadge();
    renderParentWordsTable();
    refreshWelcomeMetadata();

    if (syncRes.synced) {
      showToast(`Added ${addedRecords.length} words for ${weekLabel} & synced to Google Sheets!`);
    } else if (syncRes.queuedOffline) {
      showToast(`Saved ${addedRecords.length} words locally (queued to sync when online).`);
    } else {
      showToast(`Added ${addedRecords.length} words for ${weekLabel}!`);
    }
  });

  function renderParentWordsTable() {
    const words = loadWords();
    const today = getLocalISODate();
    const activeWords = words.filter((w) => w.active !== false);
    const dueWords = activeWords.filter((w) => !w.next_review || w.next_review <= today);
    const masteredWords = activeWords.filter((w) => w.box >= 4);

    if (statTotalWords) statTotalWords.textContent = `${activeWords.length} total`;
    if (statDueWords) statDueWords.textContent = `${dueWords.length} due today`;
    if (statMasteredWords) statMasteredWords.textContent = `${masteredWords.length} Box 4–5`;

    if (!parentWordsTbody) return;
    parentWordsTbody.innerHTML = '';

    // Show newest weeks first, then alphabetical
    const sorted = [...activeWords].sort((a, b) => {
      if (a.week_label !== b.week_label) {
        return b.week_label.localeCompare(a.week_label, undefined, { numeric: true });
      }
      return a.word.localeCompare(b.word);
    });

    for (const w of sorted) {
      const tr = document.createElement('tr');
      const accuracyText =
        w.total_attempts > 0
          ? `${Math.min(100, Math.round(((w.correct_attempts || 0) / w.total_attempts) * 100))}% (${w.correct_attempts || 0}/${w.total_attempts})`
          : 'New';

      const isDue = !w.next_review || w.next_review <= today;
      const reviewDisplay = isDue
        ? '<span class="due-tag">Due today</span>'
        : escapeHtml(w.next_review);

      const stars = '★'.repeat(w.box) + '☆'.repeat(Math.max(0, 5 - w.box));

      tr.innerHTML = `
        <td class="td-word">${escapeHtml(w.word)}</td>
        <td>${escapeHtml(w.week_label)}</td>
        <td><span class="box-pill box-${w.box}">Box ${w.box} ${stars}</span></td>
        <td>${escapeHtml(accuracyText)}</td>
        <td>${reviewDisplay}</td>
        <td>
          <button type="button" class="row-icon-btn btn-preview-word" title="Listen to pronunciation">🔊</button>
          <button type="button" class="row-icon-btn delete-btn btn-remove-word" title="Remove word">✕</button>
        </td>
      `;

      const previewBtn = tr.querySelector('.btn-preview-word');
      previewBtn.addEventListener('click', () => {
        speechEngine.unlockSpeech().then(() => speechEngine.speakWord(w));
      });

      const removeBtn = tr.querySelector('.btn-remove-word');
      removeBtn.addEventListener('click', async () => {
        removeWordFromStore(w.word);
        syncManager.deleteWordRemote(w.word).catch(() => {});
        renderParentWordsTable();
        refreshWelcomeMetadata();
        showToast(`Removed "${w.word}"`);
      });

      parentWordsTbody.appendChild(tr);
    }
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
