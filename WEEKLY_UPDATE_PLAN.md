# Plan d'ajout hebdomadaire des mots (Semaine 10 & semaines suivantes)

Ce document décrit la procédure réutilisable pour ajouter une nouvelle semaine de vocabulaire (`Week N`) à **Cozy Tub Spelling** tout en définissant la nouvelle semaine par défaut, en ajoutant les fichiers audio `.mp3` et en préservant intégralement les statistiques existantes.

> **Skill associé :** [`.agent/skills/weekly-curriculum-update/SKILL.md`](.agent/skills/weekly-curriculum-update/SKILL.md)

---

## 1. Garantir la préservation des statistiques existantes

L'architecture actuelle (`js/srs.js` et `js/sync.js`) possède un mécanisme de mise à niveau non destructif qu'il faut maintenir à chaque ajout hebdomadaire :

1. **Stockage local (`loadWords` dans `js/srs.js`) :**
   - Charge d'abord les mots existants de `localStorage['hottub_srs_words_v2']` en conservant intactes toutes les statistiques de Zoé (`box`, `next_review`, `streak`, `total_attempts`, `correct_attempts`, `trapHistory`).
   - Parcourt `getDefaultStarterWords()` et ajoute **uniquement** les nouveaux mots absents (`!seen.has(defRec.word)`) avec un état initial (`box: 1`, `streak: 0`, `total_attempts: 0`).
   - Met automatiquement à jour la semaine active vers la semaine numérique la plus élevée (`Week N`).
2. **Synchronisation Cloud Firestore (`mergeWordsFromCloud` dans `js/srs.js` & `_backfillMissingDefaultWords` dans `js/sync.js`) :**
   - Lors de la connexion à Firestore, seuls les mots de `getDefaultStarterWords()` absents de `remoteWordSet` sont envoyés via `batch.set(..., { merge: true })`.
   - Aucun document existant dans la collection `words` n'est réinitialisé, et `metadata/app_state.current_week_label` passe à `'Week N'` via `{ merge: true }` sans toucher aux profils ni à `trapHistory`.

---

## 2. Étapes de réalisation pour chaque nouvelle semaine (`Week N`)

### Étape 1 — Fichiers audio (`assets/audio/words/`)
1. Placer un fichier `.mp3` par mot de la semaine dans `assets/audio/words/<mot>.mp3` (format MP3 48 kHz, mono, 192 kbps).
2. Enregistrer chaque mot dans `DEFAULT_WORD_AUDIO_MAP` dans `js/srs.js` :
   ```javascript
   '<mot>': 'assets/audio/words/<mot>.mp3'
   ```

### Étape 2 — Ajout des mots et passage à `Week N` par défaut (`js/srs.js` & `js/sync.js`)
1. Dans `js/srs.js` :
   - Ajouter le tableau `weekNWords` dans `getDefaultStarterWords` avec `week_label: 'Week N'`.
   - Mettre à jour la valeur par défaut `'Week N-1'` → `'Week N'` dans :
     - `normalizeWordRecord`
     - `loadWords`
     - `getCurrentWeekLabel`
     - `mergeWordsFromCloud`
2. Dans `js/sync.js` :
   - Mettre à jour `'Week N-1'` → `'Week N'` dans `_seedInitialWords` et `_backfillMissingDefaultWords`.

### Étape 3 — Interface & Documentation (`index.html`, `README.md`, `SPEC_AUDIT.md`)
1. Dans `index.html` :
   - Mettre à jour le compteur `#start-sync-note` avec le nouveau nombre total de mots.
   - Mettre à jour le badge `#parent-active-week-badge` : `Active: Week N`.
   - Mettre à jour les placeholders `#input-week-label` (`Week N+1`) et `#input-weekly-words` (mots de la `Week N`).
2. Dans `README.md` et `SPEC_AUDIT.md` :
   - Documenter la liste de la `Week N` et la nouvelle semaine par défaut `Week N`.

### Étape 4 — Mise à jour des tests (`/specs`) & Vérification
1. Conformément à la règle 4 de `.antigravityrules`, demander confirmation avant de modifier les assertions dans `/specs` :
   - `specs/behaviors/srs.spec.ts`
   - `specs/behaviors/profiles.spec.ts`
   - `specs/behaviors/gamification-stars.spec.ts`
2. Exécuter la validation complète :
   ```bash
   npx tsc --noEmit && npx vitest run
   ```
3. Commit et push vers GitHub (`git push`) pour publier les mots et les fichiers audio.
