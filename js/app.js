/**
 * Cozy Tub Spelling — Main Application Controller & Parent Dashboard
 */

import { soundEngine } from './audio.js';
import { speechEngine } from './speech.js';
import { authManager } from './auth.js';
import {
  loadWords,
  buildSessionWords,
  recordFirstAttemptSRS,
  addWeeklyWordList,
  removeWordFromStore,
  suggestNextWeekLabel,
  getCurrentWeekLabel,
  setCurrentWeekLabel,
  CURRENT_WEEK_KEY,
  getLocalISODate,
  normalizeWord,
  getProfiles,
  getActiveProfileId,
  getActiveProfile,
  setActiveProfileId,
  updateProfileName,
  resetProfileProgress,
  getProfileStatsSummary,
  getProfileForEmail,
  DEFAULT_PROFILES,
  getGardenStage,
  GARDEN_STAGES,
  getCosmeticStars,
  awardCosmeticStars,
  areAllDueWordsCleared,
  isLocalDev,
  getDefaultStarterWords
} from './srs.js';
import { syncManager } from './sync.js';
import { HotTubGame } from './game.js';

const LOCK_HOLD_DURATION_MS = 2000;
const RING_CIRCUMFERENCE = 120;
const SELECTED_LEVEL_KEY = 'hottub_selected_level_v1';
const SELECTED_MODE_KEY = 'hottub_selected_mode_v1';
const START_POP_DELAY_MS = 400;

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  // DOM References
  const appShell = document.getElementById('app-shell');
  const startOverlay = document.getElementById('start-overlay');
  const startSyncNote = document.getElementById('start-sync-note');
  const btnPlay = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-play'));
  const btnPlayText = document.getElementById('btn-play-text');
  const btnQuickSplash = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-quick-splash'));
  const btnQuickSplashText = document.getElementById('btn-quick-splash-text');
  const btnCompleteQuickSplash = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-complete-quick-splash'));
  const bonusStarsBanner = document.getElementById('bonus-stars-banner');
  const bonusStarsText = document.getElementById('bonus-stars-text');
  const hudStarsPill = document.getElementById('hud-stars-pill');
  const hudStarsCount = document.getElementById('hud-stars-count');

  // New Play Hub & Login Gate DOM References
  const playHubView = document.getElementById('play-hub-view');
  const loginCatDoor = document.getElementById('login-cat-door');
  const btnMyDucks = document.getElementById('btn-my-ducks');
  const levelSelectGroup = document.getElementById('level-select-group');
  const btnLevelPrev = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-level-prev'));
  const btnLevelNext = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-level-next'));
  const levelCarouselDots = document.getElementById('level-carousel-dots');
  const cardLevelBathtub = /** @type {HTMLButtonElement | null} */ (document.getElementById('card-level-bathtub'));
  const cardLevelChest = /** @type {HTMLButtonElement | null} */ (document.getElementById('card-level-chest'));
  const btnMode3 = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-mode-3'));
  const btnMode10 = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-mode-10'));
  const wordsDueBubble = document.getElementById('words-due-bubble');
  const wordsDueCount = document.getElementById('words-due-count');
  const wordsDueSub = document.getElementById('words-due-sub');

  // My Ducks (/progress) Modal DOM References
  const ducksProgressModal = document.getElementById('ducks-progress-modal');
  const btnCloseDucks = document.getElementById('btn-close-ducks');
  const btnDucksBackPlay = document.getElementById('btn-ducks-back-play');
  const btnDucksParent = document.getElementById('btn-ducks-parent');
  const ducksStarsTotal = document.getElementById('ducks-stars-total');
  const ducksBloomingTotal = document.getElementById('ducks-blooming-total');
  const ducksDueTotal = document.getElementById('ducks-due-total');
  const ducksLearnerSubtitle = document.getElementById('ducks-learner-subtitle');
  const ducksWordShelf = document.getElementById('ducks-word-shelf');

  // Learner Profiles DOM References
  const welcomeProfileSelector = document.getElementById('welcome-profile-selector');
  const testModeBanner = document.getElementById('test-mode-banner');
  const hudProfilePill = document.getElementById('hud-profile-pill');

  const parentActiveProfileBadge = document.getElementById('parent-active-profile-badge');
  const colProfileDaughter = document.getElementById('col-profile-daughter');
  const colProfileTest = document.getElementById('col-profile-test');
  const daughterProfileNameLabel = document.getElementById('daughter-profile-name-label');
  const profDaughterWords = document.getElementById('prof-daughter-words');
  const profDaughterDue = document.getElementById('prof-daughter-due');
  const profDaughterMastered = document.getElementById('prof-daughter-mastered');
  const profTestWords = document.getElementById('prof-test-words');
  const profTestDue = document.getElementById('prof-test-due');
  const profTestMastered = document.getElementById('prof-test-mastered');
  const btnSelectProfDaughter = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-select-prof-daughter'));
  const btnSelectProfTest = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-select-prof-test'));
  const btnRenameDaughter = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-rename-daughter'));
  const btnResetDaughterProgress = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-reset-daughter-progress'));
  const btnResetTestProgress = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-reset-test-progress'));
  const chkTestCloudSync = /** @type {HTMLInputElement | null} */ (document.getElementById('chk-test-cloud-sync'));

  // Auth Gate & User Pill on Welcome Screen
  const authGateBox = document.getElementById('auth-gate-box');
  const btnGoogleSignin = document.getElementById('btn-google-signin');
  const authErrorMsg = document.getElementById('auth-error-msg');
  const welcomeUserPill = document.getElementById('welcome-user-pill');
  const welcomeUserAvatar = /** @type {HTMLImageElement | null} */ (document.getElementById('welcome-user-avatar'));
  const welcomeUserLabel = document.getElementById('welcome-user-label');
  const btnWelcomeSignout = document.getElementById('btn-welcome-signout');

  const completeOverlay = document.getElementById('complete-overlay');
  const completeSummaryText = document.getElementById('complete-summary-text');
  const completeWordChips = document.getElementById('complete-word-chips');
  const btnPlayAgain = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-play-again'));

  const btnListen = document.getElementById('btn-listen');
  const btnHint = document.getElementById('btn-hint');

  const btnParentLock = document.getElementById('btn-parent-lock');
  const btnAbandonGame = /** @type {HTMLButtonElement | null} */ (
    document.getElementById('btn-abandon-game') || document.getElementById('btn-abandon')
  );
  const lockHoldRing = document.getElementById('lock-hold-ring');

  const mathGateModal = document.getElementById('math-gate-modal');
  const formMathGate = document.getElementById('form-math-gate');
  const mathQuestionLabel = document.getElementById('math-question-label');
  const inputMathAnswer = /** @type {HTMLInputElement | null} */ (document.getElementById('input-math-answer'));
  const mathGateError = document.getElementById('math-gate-error');
  const btnCancelMath = document.getElementById('btn-cancel-math');

  const parentModal = document.getElementById('parent-modal');
  const btnCloseParent = document.getElementById('btn-close-parent');
  const parentSyncBadge = document.getElementById('parent-sync-badge');

  const parentAuthSignedIn = document.getElementById('parent-auth-signed-in');
  const parentAuthAvatar = /** @type {HTMLImageElement | null} */ (document.getElementById('parent-auth-avatar'));
  const parentAuthName = document.getElementById('parent-auth-name');
  const parentAuthEmail = document.getElementById('parent-auth-email');
  const btnSyncNow = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-sync-now'));
  const btnParentSignout = document.getElementById('btn-parent-signout');
  const parentAuthSignedOut = document.getElementById('parent-auth-signed-out');
  const btnParentSignin = document.getElementById('btn-parent-signin');
  const allowedEmailsChips = document.getElementById('allowed-emails-chips');

  const parentActiveWeekBadge = document.getElementById('parent-active-week-badge');
  const parentWeekSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('parent-week-select'));
  const parentWeekChips = document.getElementById('parent-week-chips');

  const inputWeekLabel = /** @type {HTMLInputElement | null} */ (document.getElementById('input-week-label'));
  const inputWeeklyWords = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('input-weekly-words'));
  const weeklyWordCount = document.getElementById('weekly-word-count');
  const btnAddWeekly = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-add-weekly'));

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

  // --- Play Hub State: Cover-Flow Level Carousel (2 to 10 Levels) and Mode ---
  let selectedLevel = 'bathtub';
  let selectedMode = '10';
  let userExplicitlyChangedModeInSession = false;

  const CAROUSEL_POS_CLASSES = [
    'pos-center',
    'pos-left',
    'pos-right',
    'pos-far-left',
    'pos-far-right',
    'pos-hidden'
  ];

  function getLevelCards() {
    if (!levelSelectGroup) {
      return [cardLevelBathtub, cardLevelChest].filter(Boolean);
    }
    return /** @type {HTMLButtonElement[]} */ (
      Array.from(levelSelectGroup.querySelectorAll('.level-polaroid-card[data-level]'))
    );
  }

  function computeCarouselPositionClass(idx, activeIdx, total) {
    if (idx === activeIdx) return 'pos-center';
    if (total <= 1) return 'pos-center';
    if (total === 2) {
      return activeIdx === 0 ? 'pos-right' : 'pos-left';
    }
    let diff = idx - activeIdx;
    const half = Math.floor(total / 2);
    const negHalf = -Math.floor((total - 1) / 2);
    while (diff > half) diff -= total;
    while (diff < negHalf) diff += total;

    if (diff === -1) return 'pos-left';
    if (diff === 1) return 'pos-right';
    if (diff === -2 && total >= 4) return 'pos-far-left';
    if (diff === 2 && total >= 4) return 'pos-far-right';
    return 'pos-hidden';
  }

  function renderLevelCarouselDots(cards, activeIdx) {
    if (!levelCarouselDots) return;
    levelCarouselDots.innerHTML = '';
    const total = cards.length;
    if (total <= 1) {
      levelCarouselDots.hidden = true;
      return;
    }
    levelCarouselDots.hidden = false;

    cards.forEach((card, idx) => {
      const levelId = card.getAttribute('data-level') || '';
      const labelEl = card.querySelector('.level-card-label');
      const levelTitle = (labelEl && labelEl.textContent) || card.getAttribute('aria-label') || `Level ${idx + 1}`;
      const isSelected = idx === activeIdx;

      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `level-pebble-dot${isSelected ? ' is-active' : ''}`;
      dot.setAttribute('data-level', levelId);
      dot.setAttribute('data-level-index', String(idx));
      dot.setAttribute('aria-label', `Select level ${idx + 1} of ${total}: ${levelTitle}`);
      dot.setAttribute('aria-current', isSelected ? 'true' : 'false');
      dot.title = `${levelTitle} (${idx + 1}/${total})`;
      dot.addEventListener('click', () => {
        applyLevelSelection(levelId, true);
      });
      levelCarouselDots.appendChild(dot);
    });
  }

  function loadInitialLevel() {
    const cards = getLevelCards();
    const validIds = cards.map((c) => c.getAttribute('data-level')).filter(Boolean);
    try {
      const saved = window.localStorage.getItem(SELECTED_LEVEL_KEY);
      if (saved && (validIds.includes(saved) || saved === 'chest' || saved === 'bathtub')) {
        return saved;
      }
    } catch {
      // Ignore storage errors
    }
    return validIds[0] || 'bathtub';
  }

  function applyLevelSelection(level, playAudio = false) {
    const cards = getLevelCards();
    const validIds = cards.map((c) => c.getAttribute('data-level')).filter(Boolean);
    const fallbackId = validIds[0] || 'bathtub';
    selectedLevel = validIds.includes(level) ? level : level === 'chest' ? 'chest' : fallbackId;

    try {
      window.localStorage.setItem(SELECTED_LEVEL_KEY, selectedLevel);
    } catch {
      // Ignore storage errors
    }

    let activeIdx = cards.findIndex((c) => c.getAttribute('data-level') === selectedLevel);
    if (activeIdx < 0) activeIdx = 0;
    const total = cards.length;

    cards.forEach((card, idx) => {
      const isSelected = idx === activeIdx;
      const posClass = computeCarouselPositionClass(idx, activeIdx, total);
      card.classList.toggle('is-selected', isSelected);
      card.setAttribute('aria-checked', isSelected ? 'true' : 'false');
      card.classList.remove(...CAROUSEL_POS_CLASSES);
      card.classList.add(posClass);
      card.setAttribute('data-carousel-pos', posClass);

      const stepCounter = card.querySelector('.level-step-counter');
      if (stepCounter) {
        stepCounter.textContent = `Level ${idx + 1} of ${total}`;
      }
    });

    renderLevelCarouselDots(cards, activeIdx);

    if (appShell) {
      appShell.setAttribute('data-selected-level', selectedLevel);
    }
    if (playAudio) {
      soundEngine.unlockAudio().then(() => {
        if (selectedLevel === 'chest') {
          soundEngine.playLevelSelectChest();
        } else {
          soundEngine.playLevelSelectBathtub();
        }
      });
    }
  }

  function stepCarouselBy(delta) {
    const cards = getLevelCards();
    if (cards.length === 0) return;
    const currentIdx = Math.max(
      0,
      cards.findIndex((c) => c.getAttribute('data-level') === selectedLevel)
    );
    const nextIdx = (currentIdx + delta + cards.length) % cards.length;
    const targetLevel = cards[nextIdx].getAttribute('data-level') || 'bathtub';
    applyLevelSelection(targetLevel, true);
  }

  function applyModeSelection(mode, playAudio = false, isUserAction = false) {
    selectedMode = mode === '10' ? '10' : '3';
    if (isUserAction) {
      userExplicitlyChangedModeInSession = true;
      try {
        window.localStorage.setItem(SELECTED_MODE_KEY, selectedMode);
      } catch {
        // Ignore storage errors
      }
    }
    if (btnMode3) {
      const is3 = selectedMode === '3';
      btnMode3.classList.toggle('is-selected', is3);
      btnMode3.setAttribute('aria-checked', is3 ? 'true' : 'false');
    }
    if (btnMode10) {
      const is10 = selectedMode === '10';
      btnMode10.classList.toggle('is-selected', is10);
      btnMode10.setAttribute('aria-checked', is10 ? 'true' : 'false');
    }
    if (playAudio) {
      soundEngine.unlockAudio().then(() => {
        soundEngine.playModeQuack(selectedMode === '10' ? 10 : 3);
      });
    }
  }
  selectedLevel = loadInitialLevel();
  applyLevelSelection(selectedLevel, false);

  if (levelSelectGroup) {
    levelSelectGroup.addEventListener('click', (ev) => {
      const target = /** @type {HTMLElement | null} */ (ev.target);
      const card = target ? target.closest('.level-polaroid-card[data-level]') : null;
      if (card) {
        const levelId = card.getAttribute('data-level');
        if (levelId) {
          applyLevelSelection(levelId, true);
        }
      }
    });

    levelSelectGroup.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
        ev.preventDefault();
        stepCarouselBy(1);
      } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        stepCarouselBy(-1);
      }
    });

    let swipeStartX = null;
    levelSelectGroup.addEventListener('pointerdown', (ev) => {
      swipeStartX = ev.clientX;
    });
    levelSelectGroup.addEventListener('pointerup', (ev) => {
      if (swipeStartX === null) return;
      const dx = ev.clientX - swipeStartX;
      swipeStartX = null;
      if (Math.abs(dx) >= 36) {
        stepCarouselBy(dx < 0 ? 1 : -1);
      }
    });
  }

  if (btnLevelPrev) {
    btnLevelPrev.addEventListener('click', () => {
      stepCarouselBy(-1);
    });
  }
  if (btnLevelNext) {
    btnLevelNext.addEventListener('click', () => {
      stepCarouselBy(1);
    });
  }

  if (btnMode3) {
    btnMode3.addEventListener('click', () => {
      applyModeSelection('3', true, true);
    });
  }
  if (btnMode10) {
    btnMode10.addEventListener('click', () => {
      applyModeSelection('10', true, true);
    });
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

    onFirstAttemptComplete: (wordStr, firstAttemptErrors, attemptDetails = {}) => {
      const updatedRecord = recordFirstAttemptSRS(wordStr, firstAttemptErrors, attemptDetails);
      if (updatedRecord) {
        syncManager.queueWordUpdate(updatedRecord).catch(() => {});
      }
    },

    onTrapError: (_trapCategory, updatedHistory) => {
      syncManager.queueTrapHistoryUpdate(getActiveProfileId(), updatedHistory).catch(() => {});
    },

    onSessionComplete: (summary) => {
      renderCompletionScreen(summary);
    }
  });

  // @ts-ignore
  if (typeof window !== 'undefined') window.__gameInstance = game;

  // 1. Wire Firebase Auth State & Family Allowlist Gate (State 1: Login Gate vs. State 2: Play Hub)
  let previousSignedInState = Boolean(authManager.getSession() && authManager.getSession().email);
  let hasInitializedAuthRender = false;

  function renderAuthState(session, errorInfo = null) {
    const isSignedIn = Boolean(session && session.email);
    const justSignedIn = hasInitializedAuthRender && !previousSignedInState && isSignedIn;
    previousSignedInState = isSignedIn;
    hasInitializedAuthRender = true;

    if (justSignedIn) {
      soundEngine.unlockAudio().then(() => {
        soundEngine.playCatWakeMeow();
      });
      if (loginCatDoor) {
        loginCatDoor.classList.add('is-door-opening');
        setTimeout(() => {
          loginCatDoor.classList.remove('is-door-opening');
        }, 600);
      }
    }

    if (authGateBox) {
      authGateBox.hidden = isSignedIn;
    }
    if (playHubView) {
      playHubView.hidden = !isSignedIn;
    }
    if (btnPlay) {
      btnPlay.hidden = !isSignedIn;
    }
    if (btnQuickSplash) {
      btnQuickSplash.hidden = !isSignedIn;
    }

    if (authErrorMsg) {
      if (errorInfo && errorInfo.message) {
        authErrorMsg.textContent = errorInfo.message;
        authErrorMsg.hidden = false;
      } else {
        authErrorMsg.hidden = true;
      }
    }

    if (welcomeUserPill) {
      welcomeUserPill.hidden = !isSignedIn;
      if (isSignedIn) {
        if (welcomeUserLabel) {
          welcomeUserLabel.textContent = session.email;
        }
        if (welcomeUserAvatar) {
          if (session.picture) {
            welcomeUserAvatar.src = session.picture;
            welcomeUserAvatar.hidden = false;
          } else {
            welcomeUserAvatar.hidden = true;
          }
        }
      }
    }

    if (parentAuthSignedIn) parentAuthSignedIn.hidden = !isSignedIn;
    if (parentAuthSignedOut) parentAuthSignedOut.hidden = isSignedIn;

    if (isSignedIn) {
      if (parentAuthName) parentAuthName.textContent = session.name || session.email;
      if (parentAuthEmail) parentAuthEmail.textContent = session.email;
      if (parentAuthAvatar) {
        if (session.picture) {
          parentAuthAvatar.src = session.picture;
          parentAuthAvatar.hidden = false;
        } else {
          parentAuthAvatar.hidden = true;
        }
      }
    }

    renderAllowedEmailChips();
    refreshProfileUI();
    refreshWelcomeMetadata();
  }

  function renderAllowedEmailChips() {
    if (!allowedEmailsChips) return;
    allowedEmailsChips.innerHTML = '';

    for (const email of authManager.getDefaultAllowedEmails()) {
      const chip = document.createElement('span');
      chip.className = 'allowed-email-chip is-default';
      chip.textContent = email;
      allowedEmailsChips.appendChild(chip);
    }

    for (const email of authManager.getExtraAllowedEmails()) {
      const chip = document.createElement('span');
      chip.className = 'allowed-email-chip';
      chip.innerHTML = `${escapeHtml(email)} <button type="button" class="chip-remove-btn" title="Remove">✕</button>`;
      const removeBtn = chip.querySelector('.chip-remove-btn');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          authManager.removeExtraAllowedEmail(email);
          renderAllowedEmailChips();
        });
      }
      allowedEmailsChips.appendChild(chip);
    }
  }

  authManager.onAuthChange((session, errorInfo) => {
    renderAuthState(session, errorInfo);
    if (errorInfo && errorInfo.message) {
      showToast(errorInfo.message, 4200);
    } else if (session && session.email) {
      syncManager.syncNow().then(() => {
        refreshWelcomeMetadata();
        if (parentModal && !parentModal.hidden) {
          renderParentWordsTable();
        }
      });
    }
  });

  renderAuthState(authManager.getSession(), null);

  function openPlayHub() {
    soundEngine.unlockAudio().then(() => soundEngine.playCatWakeMeow());
    if (loginCatDoor) loginCatDoor.classList.add('is-door-opening');
    setTimeout(() => {
      if (authGateBox) authGateBox.hidden = true;
      if (playHubView) playHubView.hidden = false;
      if (btnPlay) btnPlay.hidden = false;
      if (loginCatDoor) loginCatDoor.classList.remove('is-door-opening');
    }, 400);
  }

  if (loginCatDoor) {
    loginCatDoor.addEventListener('click', (ev) => {
      if (ev.target && (/** @type {HTMLElement} */ (ev.target).closest('#btn-google-signin'))) {
        return;
      }
      openPlayHub();
    });
  }

  if (btnGoogleSignin) {
    btnGoogleSignin.addEventListener('click', () => {
      soundEngine.unlockAudio().then(() => {
        soundEngine.playCatWakeMeow();
      });
      if (isLocalDev()) {
        openPlayHub();
      }
      authManager.signInWithGoogle();
    });
  }

  if (btnParentSignin) {
    btnParentSignin.addEventListener('click', () => {
      authManager.signInWithGoogle();
    });
  }

  const handleSignOut = async () => {
    await authManager.signOut();
    showToast('Signed out of family Google account.');
    refreshProfileUI();
    refreshWelcomeMetadata();
  };

  if (btnWelcomeSignout) {
    btnWelcomeSignout.addEventListener('click', handleSignOut);
  }
  if (btnParentSignout) {
    btnParentSignout.addEventListener('click', handleSignOut);
  }

  // 2. Wire Sync Status Indicator
  syncManager.onStatusChange((status) => {
    updateParentSyncBadge(status);
  });

  // 3. Wire Speech Speaking Pulse on "Listen Again" Button
  speechEngine.onSpeakingStateChange((isSpeaking) => {
    if (btnListen) {
      btnListen.classList.toggle('is-speaking', isSpeaking);
    }
  });

  // 4. Refresh Welcome Screen Metadata & Learner Profiles
  function getSessionLearnerProfile() {
    const session = authManager.getSession();
    if (session && session.email) {
      return getProfileForEmail(session.email);
    }
    const activeId = getActiveProfileId();
    if (activeId === 'brigitte') {
      return getProfileForEmail('bbouhana@gmail.com');
    }
    if (activeId === 'eric') {
      return getProfileForEmail('scherparis@gmail.com');
    }
    return getProfileForEmail('scher.jonathan@gmail.com');
  }

  function getKidLearnerProfile() {
    const learner = getSessionLearnerProfile();
    if (learner && !learner.isTest) {
      return learner;
    }
    return getProfileForEmail('scher.jonathan@gmail.com');
  }

  function refreshProfileUI() {
    const activeId = getActiveProfileId();
    const profiles = getProfiles();
    const activeProf = getActiveProfile();
    const learnerProf = getSessionLearnerProfile();
    const testProf = profiles.find((p) => p.id === 'test') || DEFAULT_PROFILES[1];
    const welcomeProfiles = [learnerProf, testProf];

    // 1. Welcome Screen Buttons
    if (welcomeProfileSelector) {
      welcomeProfileSelector.innerHTML = '';
      for (const prof of welcomeProfiles) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `profile-btn ${prof.id === activeId ? 'is-active' : ''}`;
        btn.setAttribute('aria-pressed', prof.id === activeId ? 'true' : 'false');
        btn.setAttribute('data-profile-id', prof.id);
        btn.innerHTML = `<span class="profile-avatar" aria-hidden="true">${escapeHtml(prof.avatar)}</span><span>${escapeHtml(prof.name)}</span>`;
        btn.addEventListener('click', () => {
          switchActiveProfile(prof.id);
        });
        welcomeProfileSelector.appendChild(btn);
      }
    }

    if (testModeBanner) {
      testModeBanner.hidden = activeId !== 'test';
      const bannerText = testModeBanner.querySelector('.test-banner-text');
      if (bannerText) {
        bannerText.textContent = `Test Profile Active — ${learnerProf.name}'s progress & schedule are 100% safe!`;
      }
    }

    // 2. HUD Topbar Pill
    if (hudProfilePill) {
      hudProfilePill.hidden = activeId !== 'test';
    }

    // 3. Parent Dashboard Profile Section
    if (parentActiveProfileBadge) {
      parentActiveProfileBadge.textContent = `Active: ${activeProf.name}`;
      parentActiveProfileBadge.classList.toggle('is-connected', activeId === learnerProf.id);
    }

    const learnerStats = getProfileStatsSummary(learnerProf.id);
    const tStats = getProfileStatsSummary('test');

    if (daughterProfileNameLabel) daughterProfileNameLabel.textContent = learnerProf.name;

    if (profDaughterWords) profDaughterWords.textContent = `${learnerStats.totalWords} words`;
    if (profDaughterDue) profDaughterDue.textContent = `${learnerStats.dueWords} due`;
    if (profDaughterMastered) profDaughterMastered.textContent = `${learnerStats.masteredWords} Blooming (Box 4–5)`;

    if (profTestWords) profTestWords.textContent = `${tStats.totalWords} words`;
    if (profTestDue) profTestDue.textContent = `${tStats.dueWords} due`;
    if (profTestMastered) profTestMastered.textContent = `${tStats.masteredWords} Blooming (Box 4–5)`;

    if (colProfileDaughter) colProfileDaughter.classList.toggle('is-current', activeId === learnerProf.id);
    if (colProfileTest) colProfileTest.classList.toggle('is-current', activeId === 'test');

    if (btnSelectProfDaughter) {
      btnSelectProfDaughter.textContent = activeId === learnerProf.id ? 'Active Profile' : 'Switch to ' + learnerProf.name;
      btnSelectProfDaughter.className = activeId === learnerProf.id ? 'primary-pastel-btn is-active' : 'secondary-pastel-btn';
    }
    if (btnSelectProfTest) {
      btnSelectProfTest.textContent = activeId === 'test' ? 'Active Profile' : 'Switch to Test';
      btnSelectProfTest.className = activeId === 'test' ? 'primary-pastel-btn is-active' : 'secondary-pastel-btn';
    }

    if (chkTestCloudSync) {
      chkTestCloudSync.checked = syncManager.isTestProfileSyncEnabled();
    }
  }

  function switchActiveProfile(profileId, showToastNotification = true) {
    setActiveProfileId(profileId);
    const prof = getActiveProfile();
    refreshProfileUI();
    refreshWelcomeMetadata();
    if (parentModal && !parentModal.hidden) {
      renderParentWeekSelector();
      renderParentWordsTable();
    }
    if (showToastNotification) {
      showToast(`Active profile: ${prof.name} ${prof.avatar}`);
    }
  }

  if (hudProfilePill) {
    hudProfilePill.addEventListener('click', () => {
      const learner = getSessionLearnerProfile();
      switchActiveProfile(learner.id);
    });
  }

  if (btnSelectProfDaughter) {
    btnSelectProfDaughter.addEventListener('click', () => {
      const learner = getSessionLearnerProfile();
      switchActiveProfile(learner.id);
    });
  }

  if (btnSelectProfTest) {
    btnSelectProfTest.addEventListener('click', () => {
      switchActiveProfile('test');
    });
  }

  if (btnRenameDaughter) {
    btnRenameDaughter.addEventListener('click', () => {
      const learner = getSessionLearnerProfile();
      const input = window.prompt(`Enter your name for this profile:`, learner.name);
      if (input && input.trim()) {
        updateProfileName(learner.id, input.trim());
        refreshProfileUI();
        refreshWelcomeMetadata();
        showToast(`Profile renamed to "${input.trim()}".`);
      }
    });
  }

  if (btnResetDaughterProgress) {
    btnResetDaughterProgress.addEventListener('click', async () => {
      const learner = getSessionLearnerProfile();
      const confirmed = window.confirm(
        `Reset ${learner.name}'s progress? All words in ${learner.name}'s profile will reset to Box 1 (due today) and 0 attempts.\n\nThis will also sync to Cloud Firestore.`
      );
      if (confirmed) {
        const resetWords = resetProfileProgress(learner.id);
        for (const w of resetWords) {
          syncManager.queueWordUpdate(w, learner.id).catch(() => {});
        }
        syncManager.queueTrapHistoryUpdate(learner.id, {}).catch(() => {});
        if (syncManager.isCloudReady() && navigator.onLine !== false) {
          await syncManager.flushPendingChanges();
        }
        refreshProfileUI();
        if (parentModal && !parentModal.hidden) {
          renderParentWeekSelector();
          renderParentWordsTable();
        }
        showToast(`${learner.name}'s progress has been reset to Box 1.`);
      }
    });
  }

  if (btnResetTestProgress) {
    btnResetTestProgress.addEventListener('click', () => {
      const confirmed = window.confirm(
        'Reset Test Profile progress? All words in the Test profile will reset to Box 1 (due today) and 0 attempts.\n\nZoé’s data will NOT be touched.'
      );
      if (confirmed) {
        resetProfileProgress('test');
        if (syncManager.isTestProfileSyncEnabled()) {
          syncManager.queueTrapHistoryUpdate('test', {}).catch(() => {});
        }
        refreshProfileUI();
        if (parentModal && !parentModal.hidden) {
          renderParentWeekSelector();
          renderParentWordsTable();
        }
        showToast('Test profile progress reset to Box 1.');
      }
    });
  }

  if (chkTestCloudSync) {
    chkTestCloudSync.addEventListener('change', () => {
      syncManager.setTestProfileSyncEnabled(chkTestCloudSync.checked);
      refreshProfileUI();
      showToast(
        chkTestCloudSync.checked
          ? 'Test profile will sync to Firebase under profiles.test'
          : 'Test profile will run offline (sandbox mode only).'
      );
    });
  }

  // --- Parent Dashboard Active Week Selection ---
  function resolveActiveWeekDisplay(activeWords) {
    try {
      const explicitStored = window.localStorage.getItem(CURRENT_WEEK_KEY);
      if (explicitStored && String(explicitStored).trim()) {
        return String(explicitStored).trim();
      }
    } catch {
      // Ignore storage errors
    }
    return getCurrentWeekLabel(activeWords);
  }

  function applyActiveWeek(weekLabel) {
    const clean = String(weekLabel || '').trim();
    if (!clean) return;
    setCurrentWeekLabel(clean);
    soundEngine.unlockAudio().then(() => soundEngine.playUiTap());
    renderParentWeekSelector();
    renderParentWordsTable();
    refreshWelcomeMetadata();
    showToast(`Active week set to ${clean}`);
  }

  let isUpdatingWeekSelect = false;

  function renderParentWeekSelector() {
    const words = loadWords();
    const activeWords = words.filter((w) => w.active !== false);
    const currentWeek = resolveActiveWeekDisplay(activeWords);

    if (parentActiveWeekBadge) {
      parentActiveWeekBadge.textContent = `Active: ${currentWeek}`;
    }

    let maxWeekNum = 8;
    const customWeeks = new Set();
    for (const w of activeWords) {
      const lbl = String(w.week_label || '').trim();
      if (!lbl) continue;
      const m = /^week\s*(\d+)$/i.exec(lbl);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxWeekNum) maxWeekNum = n;
      } else {
        customWeeks.add(lbl);
      }
    }
    const currMatch = /^week\s*(\d+)$/i.exec(String(currentWeek).trim());
    if (currMatch) {
      const n = parseInt(currMatch[1], 10);
      if (n > maxWeekNum) maxWeekNum = n;
    } else if (currentWeek && String(currentWeek).trim()) {
      customWeeks.add(String(currentWeek).trim());
    }

    const allWeeks = [];
    for (let num = 1; num <= maxWeekNum; num++) {
      allWeeks.push(`Week ${num}`);
    }
    for (const cw of customWeeks) {
      if (!allWeeks.includes(cw)) {
        allWeeks.push(cw);
      }
    }

    if (parentWeekSelect) {
      isUpdatingWeekSelect = true;
      parentWeekSelect.innerHTML = '';
      for (const week of allWeeks) {
        const opt = document.createElement('option');
        opt.value = week;
        opt.textContent = week;
        if (week.toLowerCase() === currentWeek.toLowerCase()) {
          opt.selected = true;
        }
        parentWeekSelect.appendChild(opt);
      }
      parentWeekSelect.value = currentWeek;
      isUpdatingWeekSelect = false;
    }

    if (parentWeekChips) {
      parentWeekChips.innerHTML = '';
      for (const week of allWeeks) {
        const isSelected = week.toLowerCase() === currentWeek.toLowerCase();
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `parent-week-chip${isSelected ? ' is-active' : ''}`;
        chip.setAttribute('data-week-label', week);
        chip.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        chip.textContent = week;
        chip.addEventListener('click', () => {
          applyActiveWeek(week);
        });
        parentWeekChips.appendChild(chip);
      }
    }
  }

  if (parentWeekSelect) {
    parentWeekSelect.addEventListener('change', () => {
      if (isUpdatingWeekSelect) return;
      if (parentWeekSelect.value) {
        applyActiveWeek(parentWeekSelect.value);
      }
    });
  }

  // --- Top-Right Progress Link ("My Ducks" -> /progress) ---
  function renderDucksProgressShelf() {
    const kidProf = getKidLearnerProfile();
    const words = loadWords(undefined, undefined, kidProf.id);
    const activeWords = words.filter((w) => w.active !== false);
    const today = getLocalISODate();
    const dueCount = activeWords.filter((w) => !w.next_review || w.next_review <= today).length;
    const bloomingCount = activeWords.filter((w) => w.box >= 4).length;
    const totalStars = getCosmeticStars(kidProf.id);

    if (ducksStarsTotal) ducksStarsTotal.textContent = String(totalStars);
    if (ducksBloomingTotal) ducksBloomingTotal.textContent = String(bloomingCount);
    if (ducksDueTotal) ducksDueTotal.textContent = String(dueCount);
    if (ducksLearnerSubtitle) {
      ducksLearnerSubtitle.textContent = `${kidProf.name}'s duck & word collection (${activeWords.length} words)`;
    }

    if (ducksWordShelf) {
      ducksWordShelf.innerHTML = '';
      for (const w of activeWords) {
        const stage = getGardenStage(w.box || 1);
        const chip = document.createElement('span');
        chip.className = 'word-chip';
        chip.title = `${w.week_label} • Stage ${stage.level}: ${stage.name}`;
        chip.innerHTML = `
          <img src="${stage.icon}" class="chip-stage-img" alt="${stage.name}" />
          <span class="chip-word">${escapeHtml(w.word)}</span>
        `;
        ducksWordShelf.appendChild(chip);
      }
    }
  }

  function openDucksProgressModal(pushRoute = true) {
    if (!ducksProgressModal) return;
    renderDucksProgressShelf();
    ducksProgressModal.hidden = false;
    if (pushRoute && typeof window !== 'undefined' && window.history && window.location.pathname !== '/progress') {
      try {
        window.history.pushState({ view: 'progress' }, '', '/progress');
      } catch {
        // Ignore history errors in sandboxed/file environments
      }
    }
  }

  function closeDucksProgressModal() {
    if (!ducksProgressModal) return;
    ducksProgressModal.hidden = true;
    if (typeof window !== 'undefined' && window.history && window.location.pathname === '/progress') {
      try {
        window.history.pushState({ view: 'hub' }, '', '/');
      } catch {
        // Ignore history errors
      }
    }
  }

  if (btnMyDucks) {
    btnMyDucks.addEventListener('click', (ev) => {
      ev.preventDefault();
      soundEngine.unlockAudio().then(() => soundEngine.playUiTap());
      openDucksProgressModal(true);
    });
  }

  if (btnCloseDucks) {
    btnCloseDucks.addEventListener('click', closeDucksProgressModal);
  }
  if (btnDucksBackPlay) {
    btnDucksBackPlay.addEventListener('click', closeDucksProgressModal);
  }
  if (btnDucksParent) {
    btnDucksParent.addEventListener('click', () => {
      closeDucksProgressModal();
      openMathGate();
    });
  }
  if (ducksProgressModal) {
    ducksProgressModal.addEventListener('click', (ev) => {
      if (ev.target === ducksProgressModal) {
        closeDucksProgressModal();
      }
    });
  }

  function refreshWelcomeMetadata() {
    const kidProf = getKidLearnerProfile();
    const words = loadWords(undefined, undefined, kidProf.id);
    const activeWords = words.filter((w) => w.active !== false);
    const today = getLocalISODate();
    const dueCount = activeWords.filter((w) => !w.next_review || w.next_review <= today).length;

    // Mode Toggle Default:
    // Defaults to Duck Mound (10 Words) unless the user saved a preference in localStorage.
    if (!userExplicitlyChangedModeInSession) {
      let savedMode = null;
      try {
        savedMode = window.localStorage.getItem(SELECTED_MODE_KEY);
      } catch {
        // Ignore
      }
      if (savedMode === '10' || savedMode === '3') {
        applyModeSelection(savedMode, false, false);
      } else {
        applyModeSelection('10', false, false);
      }
    }

    // Floating Iridescent Soap Bubble Badge ("Words Due Today")
    if (wordsDueBubble && wordsDueCount && wordsDueSub) {
      wordsDueBubble.hidden = false;
      if (dueCount > 0) {
        wordsDueBubble.classList.remove('is-all-done');
        wordsDueCount.textContent = String(dueCount);
        wordsDueSub.textContent = 'to pop!';
        wordsDueBubble.setAttribute('aria-label', `${dueCount} bubbles ready to pop!`);
      } else {
        wordsDueBubble.classList.add('is-all-done');
        wordsDueCount.textContent = '⭐';
        wordsDueSub.textContent = 'All done! Free play!';
        wordsDueBubble.setAttribute('aria-label', 'All done! Free play!');
      }
    }

    const isAuthed = authManager.isAuthenticated();
    if (startSyncNote) {
      const syncText = isAuthed
        ? navigator.onLine === false
          ? 'Offline mode (will sync when online)'
          : 'Firebase Cloud Sync active'
        : 'Sign in with Google to enable Firebase Sync';
      startSyncNote.textContent = `${activeWords.length} words (${dueCount} due today) • ${syncText}`;
    }

    const totalStars = getCosmeticStars(kidProf.id);

    if (btnQuickSplashText) {
      if (dueCount === 0) {
        btnQuickSplashText.textContent = 'Quick Splash (0 due ⭐)';
        if (btnQuickSplash) {
          btnQuickSplash.title = 'All due words for today are cleared! Extra practice available in Full Practice mode.';
        }
      } else {
        const splashCount = Math.min(3, dueCount);
        btnQuickSplashText.textContent = `Quick Splash (${splashCount} Word${splashCount === 1 ? '' : 's'})`;
        if (btnQuickSplash) {
          btnQuickSplash.title = `3-word micro-session for low-energy days (${splashCount} due word${splashCount === 1 ? '' : 's'} ready)`;
        }
      }
    }

    if (hudStarsPill && hudStarsCount) {
      if (totalStars > 0) {
        hudStarsPill.hidden = false;
        hudStarsCount.textContent = String(totalStars);
      } else {
        hudStarsPill.hidden = true;
      }
    }
  }

  // Ensure Zoé's profile is initialized
  function checkAndApplyZoeReset() {
    updateProfileName('daughter', 'Zoé');
  }
  checkAndApplyZoeReset();
  refreshProfileUI();
  refreshWelcomeMetadata();
  renderParentWeekSelector();

  if (typeof window !== 'undefined' && window.location && window.location.pathname === '/progress') {
    if (authManager.isAuthenticated()) {
      openDucksProgressModal(false);
    }
  }

  // Idle Ambient Feedback: Faint, slow bubble pop every 10 seconds while on the Play Hub
  setInterval(() => {
    if (
      startOverlay &&
      !startOverlay.hidden &&
      authManager.isAuthenticated() &&
      soundEngine.unlocked
    ) {
      soundEngine.playFaintAmbientBubble();
    }
  }, 10000);

  // 6. Session Start ("PLAY !" & "Play Again" Buttons with Double-Tap Prevention & 400ms Bubble-Pop)
  let isLaunchingSession = false;

  async function launchNewSession(triggerBtn, labelEl, options = {}) {
    if (isLaunchingSession) return;
    isLaunchingSession = true;

    if (triggerBtn) {
      triggerBtn.disabled = true;
      if (triggerBtn === btnPlay) {
        triggerBtn.classList.add('is-popping-start');
      }
    }

    const useQuickMode =
      options.quickSplash !== undefined ? Boolean(options.quickSplash) : selectedMode === '3';

    // 1. Web Audio & Speech unlock within user gesture
    try {
      await Promise.all([
        soundEngine.unlockAudio().catch(() => {}),
        speechEngine.unlockSpeech().catch(() => {})
      ]);
    } catch (_) {}

    if (triggerBtn === btnPlay) {
      try {
        soundEngine.playStartHarpGlissando();
      } catch (_) {}
    } else {
      try {
        soundEngine.playBubblePop(2);
      } catch (_) {}
    }

    // 2. Non-blocking cloud sync in background if signed in and online
    if (authManager.isAuthenticated() && syncManager.isCloudReady() && navigator.onLine !== false) {
      syncManager.syncNow(2000).catch(() => {});
    }

    // 3. 400ms bubble pop animation
    await new Promise((resolve) => setTimeout(resolve, START_POP_DELAY_MS));

    // 4. Build session word list
    const allWords = loadWords();
    let sessionWords = useQuickMode
      ? buildSessionWords(allWords, 3, 3, { ...options, quickSplash: true })
      : buildSessionWords(allWords, 8, 10, { ...options, quickSplash: false });

    // Fallbacks: if all due words are cleared ("All done! Free play!"), or if list is empty,
    // seamlessly provide words from allWords or starter words so the child is NEVER blocked!
    if (!sessionWords || sessionWords.length === 0) {
      sessionWords = buildSessionWords(allWords, 3, 3, { ...options, quickSplash: false }).slice(0, useQuickMode ? 3 : 8);
    }
    if (!sessionWords || sessionWords.length === 0) {
      sessionWords = allWords.slice(0, useQuickMode ? 3 : 8);
    }
    if (!sessionWords || sessionWords.length === 0) {
      sessionWords = getDefaultStarterWords().slice(0, useQuickMode ? 3 : 8);
    }

    // 5. Hide overlays and transition straight into the level
    if (startOverlay) {
      startOverlay.hidden = true;
      startOverlay.classList.remove('is-active');
    }
    if (completeOverlay) {
      completeOverlay.hidden = true;
      completeOverlay.classList.remove('is-active');
    }

    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.classList.remove('is-popping-start');
    }
    isLaunchingSession = false;

    refreshWelcomeMetadata();
    game.startSession(sessionWords, allWords && allWords.length > 0 ? allWords : getDefaultStarterWords());
  }

  if (btnPlay) {
    // Double-Tap Prevention: disable immediately while the 400ms bubble-pop plays
    btnPlay.addEventListener('pointerdown', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      if (isLaunchingSession) return;
      launchNewSession(btnPlay, btnPlayText);
    });
    btnPlay.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (isLaunchingSession) return;
      launchNewSession(btnPlay, btnPlayText);
    });
  }
  if (btnQuickSplash) {
    btnQuickSplash.addEventListener('click', () =>
      launchNewSession(btnQuickSplash, btnQuickSplashText, { quickSplash: true })
    );
  }
  if (btnPlayAgain) {
    btnPlayAgain.addEventListener('click', () => launchNewSession(btnPlayAgain, null));
  }
  if (btnCompleteQuickSplash) {
    btnCompleteQuickSplash.addEventListener('click', () =>
      launchNewSession(btnCompleteQuickSplash, null, { quickSplash: true })
    );
  }

  // Designer preview shortcut (e.g. for headless testing & screenshots)
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('preview')) {
    const isQuick = new URLSearchParams(window.location.search).has('quick');
    const allWords = loadWords();
    const sessionWords = buildSessionWords(allWords, 8, 10, { quickSplash: isQuick });
    if (startOverlay) {
      startOverlay.hidden = true;
      startOverlay.classList.remove('is-active');
    }
    game.startSession(sessionWords, allWords);
  }

  // 7. Gameplay HUD Buttons ("Listen Again", "Hint" & "Abandon Game")
  if (btnListen) {
    btnListen.addEventListener('click', () => {
      soundEngine.playUiTap();
      game.replayCurrentWord();
    });
  }

  if (btnHint) {
    btnHint.addEventListener('click', () => {
      game.useHintButton();
    });
  }

  function abandonGame() {
    soundEngine.unlockAudio().then(() => {
      soundEngine.playUiTap();
    }).catch(() => {});

    if (speechEngine && typeof speechEngine.stopSpeaking === 'function') {
      speechEngine.stopSpeaking();
    }

    if (game) {
      if (typeof game.abandonSession === 'function') {
        game.abandonSession();
      } else {
        game.stop();
      }
    }

    if (completeOverlay) {
      completeOverlay.hidden = true;
      completeOverlay.classList.remove('is-active');
    }

    if (startOverlay) {
      startOverlay.hidden = false;
      startOverlay.classList.add('is-active');
    }

    refreshWelcomeMetadata();
    refreshProfileUI();
  }

  if (btnAbandonGame) {
    btnAbandonGame.addEventListener('click', () => {
      abandonGame();
    });
  }

  // @ts-ignore
  if (typeof window !== 'undefined') {
    // @ts-ignore
    window.__abandonGame = abandonGame;
  }

  // 8. Session Completion Screen
  function renderCompletionScreen(summary) {
    if (!completeOverlay) return;
    const activeProf = getActiveProfile();
    const today = getLocalISODate();
    const allWords = loadWords();
    const allWordsByKey = new Map(allWords.map((w) => [w.word, w]));

    const dueCount = allWords.filter(
      (w) => w.active !== false && (!w.next_review || w.next_review <= today)
    ).length;

    if (completeSummaryText) {
      completeSummaryText.textContent =
        summary.firstTryPerfect === summary.totalWords
          ? `Spotless! All ${summary.totalWords} words spelled with zero errors on the first try!`
          : `All ${summary.totalWords} words mastered! (${summary.firstTryPerfect} spotless on first try)`;
    }

    // Balance Quick Splash by awarding bonus cosmetic stars when all due words for the day reach zero
    if (dueCount === 0) {
      const updatedStars = awardCosmeticStars(1, activeProf.id);
      if (bonusStarsBanner) {
        bonusStarsBanner.hidden = false;
        if (bonusStarsText) {
          bonusStarsText.textContent = `Bonus Star Awarded! ⭐ All due words for today reached zero! (Total Stars: ${updatedStars})`;
        }
      }
    } else {
      if (bonusStarsBanner) {
        bonusStarsBanner.hidden = true;
      }
    }

    if (btnCompleteQuickSplash) {
      if (dueCount > 0) {
        const splashCount = Math.min(3, dueCount);
        btnCompleteQuickSplash.hidden = false;
        const textSpan = btnCompleteQuickSplash.querySelector('span:last-child');
        if (textSpan) {
          textSpan.textContent = `Quick Splash (${splashCount} Word${splashCount === 1 ? '' : 's'})`;
        }
      } else {
        btnCompleteQuickSplash.hidden = true;
      }
    }

    if (completeWordChips) {
      completeWordChips.innerHTML = '';
      for (const item of summary.results) {
        const rec = allWordsByKey.get(item.word);
        const boxNum = rec ? rec.box : 1;
        const stage = getGardenStage(boxNum);
        const chip = document.createElement('span');
        chip.className = `word-chip${item.masteredFirstTry ? '' : ' practiced'}`;
        chip.title = `Stage ${stage.level}: ${stage.name}`;
        chip.innerHTML = `
          <img src="${stage.icon}" class="chip-stage-img" alt="${stage.name}" />
          <span class="chip-word">${escapeHtml(item.word)}</span>
        `;
        completeWordChips.appendChild(chip);
      }
    }

    refreshWelcomeMetadata();
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
    inputWeekLabel.value = suggestNextWeekLabel();
    refreshProfileUI();
    renderAuthState(authManager.getSession(), null);
    updateParentSyncBadge({
      connected: authManager.isAuthenticated() && navigator.onLine !== false,
      message: authManager.isAuthenticated()
        ? navigator.onLine !== false
          ? 'Firebase Connected'
          : 'Offline (Cached)'
        : 'Sign-In Required'
    });
    renderParentWeekSelector();
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
    const isAuthed = authManager.isAuthenticated();
    parentSyncBadge.classList.toggle('is-connected', Boolean(isAuthed && status && status.connected !== false));
    if (status && status.message) {
      parentSyncBadge.textContent = status.message;
    } else {
      parentSyncBadge.textContent = isAuthed ? 'Firebase Connected' : 'Sign-In Required';
    }
  }

  if (btnSyncNow) {
    btnSyncNow.addEventListener('click', async () => {
      btnSyncNow.disabled = true;
      btnSyncNow.textContent = 'Syncing...';
      const result = await syncManager.syncNow(6000);
      btnSyncNow.disabled = false;
      btnSyncNow.textContent = 'Sync Now';

      renderParentWeekSelector();
      renderParentWordsTable();
      refreshWelcomeMetadata();

      if (result.ok) {
        showToast(`Synced with Firebase (${result.words.length} words)!`);
      } else {
        showToast(result.error || 'Could not reach Firebase — using local words.');
      }
    });
  }

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
    renderParentWeekSelector();
    renderParentWordsTable();
    refreshWelcomeMetadata();

    if (syncRes.synced) {
      showToast(`Added ${addedRecords.length} words for ${weekLabel} & synced to Firebase!`);
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
    if (statMasteredWords) statMasteredWords.textContent = `${masteredWords.length} Blooming (Box 4–5)`;

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

      const stage = getGardenStage(w.box);

      tr.innerHTML = `
        <td class="td-word">${escapeHtml(w.word)}</td>
        <td>${escapeHtml(w.week_label)}</td>
        <td class="td-stage">
          <img
            src="${stage.icon}"
            class="pill-stage-img"
            alt="${stage.name}"
            title="Stage ${stage.level}: ${stage.name} (${stage.intervalLabel})"
          />
        </td>
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
