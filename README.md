# Cozy Tub Spelling 🫧

A calm, storybook-styled French & English vocabulary and spelling web game built for children on **Smartphones** and **Amazon Fire Tablets (Silk Browser)**, powered by a **Leitner Box Spaced Repetition System (SRS)** and an offline-first **Firebase (Cloud Firestore + Google Authentication)** cloud sync backend.

Works straight out of the box on **GitHub Pages** (100% static HTML5, CSS3, and modular ES6 JavaScript—no build step required), complete with 16 initial French words (**Week 7** & **Week 8**) pre-loaded and ready to seed Firestore automatically on first sign-in.

---

## Initial Vocabulary List

- **Week 7:** `sans`, `suivre`, `savoir`, `sauter`, `semaine`, `serpent`, `sortir`, `soleil`, `souvent`
- **Week 8:** `câlin`, `singe`, `enfin`, `quinze`, `prince`, `loin`, `printemps`

---

## Firebase Cloud Sync & Security Rules (`hot-tub-spelling-0`)

This app connects to the **`hot-tub-spelling-0`** Firebase project configured in [`js/firebase-config.js`](js/firebase-config.js).

### 1. Firebase Authentication (Google Sign-In)
1. In the [Firebase Console](https://console.firebase.google.com/project/hot-tub-spelling-0/authentication/providers), ensure the **Google** sign-in provider is enabled.
2. Under **Authentication → Settings → Authorized domains**, add your GitHub Pages domain (e.g., `<your-username>.github.io`).
3. On a new device (phone or Amazon Fire Tablet), sign in once with an authorized family Google account on the Welcome screen. The session is persisted locally so the child's tablet stays signed in across sessions (including offline play).

### 2. Cloud Firestore Security Rules
In **Firestore Database → Rules**, publish the following rules so only authorized family Google accounts can read or write vocabulary and SRS progress:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isFamilyAuthorized() {
      return request.auth != null
        && request.auth.token.email_verified == true
        && request.auth.token.email in [
          'scher.jonathan@gmail.com',
          'williams.evamary@gmail.com',
          'jonathan.scher.office@gmail.com'
        ];
    }

    match /words/{wordId} {
      allow read, write: if isFamilyAuthorized();
    }

    match /metadata/{docId} {
      allow read, write: if isFamilyAuthorized();
    }
  }
}
```

---

## Hosting on GitHub Pages

1. Push this repository to GitHub.
2. Open **Settings → Pages** in your GitHub repository.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch** (`main` / `/ (root)`) and save.

---

## Key Gameplay & Educational Mechanics

- **Smart Bubble Spawning:** Maintains 5–7 floating lowercase bubbles at a calm pace—every 3rd bubble is guaranteed to be the exact next required letter (`targetWord[currentIndex]`), 30% of remaining bubbles are future letters from the active word, and 70% are plausible distractors (including accented variants like `â`, `é`, `è`, `ê` when accented words exist in the vocabulary).
- **Strict Lowercase & Accent Matching:** Every bubble and letter slot displays lowercase characters, with strict character matching (`a` never validates `â`, and `e` never validates `é` or `è`).
- **Gentle Watermark Scaffolding:** Tapping **Hint** (or making 2 mistakes on the active letter) reveals a faint watermark of the target word inside the empty slots while counting as an error so the word will be practiced again unassisted.
- **Zero-Error Mastery & Leitner Boxes (1–5):** Words with any error or hint are re-queued at the end of the current session until spelled once with zero errors. First-attempt accuracy advances long-term Leitner intervals (`+1d`, `+2d`, `+4d`, `+7d`, `+14d`) or resets to Box 1 (`+1d`).
- **Learner Profiles & Safe Testing Sandbox (`js/srs.js`, `js/sync.js`):**
  - **Shared Curriculum:** Words added or edited in Parent Mode are available to all profiles.
  - **Strict SRS Isolation & Personal Performance Sync:** Leitner box progression (1–5), review due dates, streaks, attempt counts, and personal error weights (`trapHistory` for adaptive distractor generation) are isolated per profile and sync to Cloud Firestore so personal performance stays across sessions and devices.
  - **1-Click Profile Switcher:** Switch between `👧 Zoé` (Primary Learner) and `🧪 Test / Sandbox` directly on the Welcome screen or in the Parent Dashboard.
  - **Zero-Touch Zoé Protection:** Playing in the `Test` profile never touches Zoé's review schedule or stats.
  - **Sandbox Mode by Default:** In `Test` profile, gameplay runs in safe local sandbox mode without writing to Cloud Firestore. If cloud sync is enabled for testing, writes are namespaced under `profiles.test` via `{ merge: true }` without touching root documents.
  - **Local Development Auto-Protection:** When running on `localhost` or `127.0.0.1`, the game automatically defaults to the `Test` profile.
- **3-Tier Amazon Fire Audio Cascade (`js/speech.js`):** Plays high-quality human recordings first (including bundled offline `.mp3` pronunciations in `assets/audio/words/` for all Week 7 & 8 starter words, custom audio URLs, and automatic Firebase Firestore backfill), falls back to cached dictionary `.mp3` audio, and finally falls back to `window.speechSynthesis` prioritizing Canadian French (`fr-CA`, `rate = 0.85`).
