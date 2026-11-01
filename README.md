# Cozy Tub Spelling 🫧

A calm, storybook-styled English vocabulary and spelling web game built for children on **Smartphones** and **Amazon Fire Tablets (Silk Browser)**, powered by a **Leitner Box Spaced Repetition System (SRS)** and an offline-first **Google Sheets** cloud sync backend.

Works straight out of the box on **GitHub Pages** (100% static HTML5, CSS3, and modular ES6 JavaScript—no build step required), complete with 8 starter English words pre-loaded for immediate play.

---

## 4-Step Google Sheets Sync Setup

Connect your game to a private Google Spreadsheet so weekly word lists and SRS progress stay synced between a parent's phone and a child's Amazon Fire Tablet:

### Step 1: Create the Google Sheet
1. Go to [Google Sheets](https://sheets.new) and create a new spreadsheet.
2. Rename the first tab at the bottom to **`Words`** (note: `Code.gs` will also auto-create this tab and header row for you if missing).
3. Add these exact column headers in Row 1 (`A1:H1`):
   `word` | `week_label` | `active` | `box` | `next_review` | `streak` | `total_attempts` | `custom_audio_url`

### Step 2: Paste `Code.gs`
1. In your Google Sheet, click **Extensions → Apps Script**.
2. Delete any default starter code in `Code.gs`, copy the entire contents of [`google-apps-script/Code.gs`](google-apps-script/Code.gs), paste it in, and click **Save** (💾).

### Step 3: Deploy as a Web App ("Anyone" Access)
1. In the Apps Script editor, click **Deploy → New deployment** (top right).
2. Click the gear icon ⚙️ next to *Select type* and choose **Web app**.
3. Set:
   - **Execute as:** `Me`
   - **Who has access:** `Anyone` *(required so the static GitHub Pages game can read/write JSON via CORS without OAuth popups on a child's tablet)*
4. Click **Deploy**, authorize script permissions when prompted, and copy the resulting **Web app URL** (`https://script.google.com/macros/s/.../exec`).

### Step 4: Link to the Game (& Auto-Configure Fire Tablet)
1. Open the game on your phone or computer and **hold the discreet lock icon** 🔒 in the top-right corner for **2 seconds** (or tap it once and solve the quick Parent Math Check).
2. Paste your **Web app URL** into **1. Google Sheets Cloud Sync** and tap **Save & Sync**.
3. Scan the generated **QR Code** or open the `?syncUrl=...` **One-Tap Setup Link** once on your child's Amazon Fire Tablet—the tablet will automatically save the sync URL and pull your word list!

---

## Hosting on GitHub Pages

1. Push this repository to GitHub.
2. Open **Settings → Pages** in your GitHub repository.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch** (`main` / `/ (root)`) and save.

---

## Key Gameplay & Educational Mechanics

- **Smart Bubble Spawning:** Maintains 5–7 floating lowercase bubbles at a calm pace—every 3rd bubble is guaranteed to be the exact next required letter (`targetWord[currentIndex]`), 30% of remaining bubbles are future letters from the active word, and 70% are plausible distractors (including accented variants when accented words exist in the vocabulary).
- **Strict Lowercase & Accent Matching:** Every bubble and letter slot displays lowercase characters, with strict character matching (`e` never validates `é` or `è`).
- **Gentle Watermark Scaffolding:** Tapping **Hint** (or making 2 mistakes on the active letter) reveals a faint watermark of the target word inside the empty slots while counting as an error so the word will be practiced again unassisted.
- **Zero-Error Mastery & Leitner Boxes (1–5):** Words with any error or hint are re-queued at the end of the current session until spelled once with zero errors. First-attempt accuracy advances long-term Leitner intervals (`+1d`, `+2d`, `+4d`, `+7d`, `+14d`) or resets to Box 1 (`+1d`).
- **3-Tier Amazon Fire Audio Cascade (`js/speech.js`):** Plays custom audio URLs first, falls back to cached human `.mp3` pronunciations from `dictionaryapi.dev`, and finally falls back to `window.speechSynthesis` (`en-US`, `rate = 0.85`).
