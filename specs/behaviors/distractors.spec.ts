import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createGameState, stepGame, chooseNextBubbleCharOnState } from '../../js/game-core.js';
import { getPlausibleDistractors } from '../../js/srs.js';

/**
 * Helper to count occurrences of each character in a distractor pool.
 */
function countOccurrences(pool: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ch of pool) {
    counts[ch] = (counts[ch] || 0) + 1;
  }
  return counts;
}

describe('Pedagogical French Distractor Matrix (CPG, Silent Letters & Dys/Phonological Rules)', () => {
  describe('1. Contextual Nasal Consonant Rule (n <-> m after a vowel / devant m, b, p)', () => {
    it('heavily weights "n" as the primary distractor when "m" follows a vowel (e.g., "printemps" at index 6)', () => {
      // GIVEN the word "printemps" at index 6 ('m' in "tem-ps", preceded by vowel 'e' and followed by 'p')
      // p(0) r(1) i(2) n(3) t(4) e(5) m(6) p(7) s(8)
      const word = 'printemps';
      const targetIndex = 6;
      const requiredChar = 'm';

      // WHEN generating plausible distractors with positional context (targetIndex = 6)
      const pool = (getPlausibleDistractors as any)(requiredChar, word, [{ word }], targetIndex) as string[];
      const counts = countOccurrences(pool);

      // THEN 'n' is weighted significantly higher than baseline alphabet filler (>= 6 occurrences)
      expect(pool).not.toContain('m');
      expect(counts['n']).toBeGreaterThanOrEqual(6);
      expect(counts['n']).toBeGreaterThan(counts['z'] || 0);
    });

    it('heavily weights "m" as the primary distractor when "n" follows a vowel (e.g., "enfin" at index 1 or "sans" at index 2)', () => {
      // GIVEN the word "enfin" at index 1 ('n' after 'e')
      const word = 'enfin';
      const targetIndex = 1;
      const requiredChar = 'n';

      // WHEN generating plausible distractors at index 1
      const pool = (getPlausibleDistractors as any)(requiredChar, word, [{ word }], targetIndex) as string[];
      const counts = countOccurrences(pool);

      // THEN 'm' is heavily weighted (>= 6 occurrences) to test the nasal n/m distinction
      expect(pool).not.toContain('n');
      expect(counts['m']).toBeGreaterThanOrEqual(6);
      expect(counts['m']).toBeGreaterThan(counts['x'] || 0);
    });
  });

  describe('2. Double Consonant Trap (L[i] === L[i-1])', () => {
    it('heavily weights the next vowel L[i+1] when the target letter is the second letter of a double consonant', () => {
      // GIVEN the word "appeler" at index 2 (the second 'p', where L[1] === 'p' and L[3] === 'e')
      // a(0) p(1) p(2) e(3) l(4) e(5) r(6)
      const word = 'appeler';
      const targetIndex = 2;
      const requiredChar = 'p';

      // WHEN generating plausible distractors at index 2
      const pool = (getPlausibleDistractors as any)(requiredChar, word, [{ word }], targetIndex) as string[];
      const counts = countOccurrences(pool);

      // THEN the following vowel 'e' (L[i+1]) is injected as a high-priority distractor (>= 6 occurrences)
      // to test whether the learner forgets to double the consonant and jumps straight to 'e'
      expect(pool).not.toContain('p');
      expect(counts['e']).toBeGreaterThanOrEqual(6);
      expect(counts['e']).toBeGreaterThan(counts['k'] || 0);
    });

    it('also weights L[i+1] on other double consonants such as "pomme" at index 3 (second "m" before "e")', () => {
      // GIVEN the word "pomme" at index 3 (second 'm', followed by 'e' at index 4)
      const word = 'pomme';
      const targetIndex = 3;
      const requiredChar = 'm';

      // WHEN generating plausible distractors at index 3
      const pool = (getPlausibleDistractors as any)(requiredChar, word, [{ word }], targetIndex) as string[];
      const counts = countOccurrences(pool);

      // THEN 'e' is heavily weighted (>= 6 occurrences)
      expect(pool).not.toContain('m');
      expect(counts['e']).toBeGreaterThanOrEqual(6);
    });
  });

  describe('3. Silent Final Consonants & Final Morphological Letters (i === word.length - 1)', () => {
    it('heavily weights French silent final consonants [t, d, s, x, p, g, c, z, e] when the final letter of a word is a consonant', () => {
      // GIVEN the word "printemps" at its final letter index 8 ('s') and "grand" at index 4 ('d')
      const poolPrintemps = (getPlausibleDistractors as any)('s', 'printemps', [{ word: 'printemps' }], 8) as string[];
      const countsPrintemps = countOccurrences(poolPrintemps);

      const poolGrand = (getPlausibleDistractors as any)('d', 'grand', [{ word: 'grand' }], 4) as string[];
      const countsGrand = countOccurrences(poolGrand);

      // THEN for "printemps" (ending in 's'), final silent traps 't', 'd', 'x', 'p', 'e' are heavily weighted (>= 5 occurrences each)
      expect(poolPrintemps).not.toContain('s');
      for (const trap of ['t', 'd', 'x', 'p', 'e']) {
        expect(countsPrintemps[trap]).toBeGreaterThanOrEqual(5);
      }

      // AND for "grand" (ending in 'd'), 't', 's', 'x', 'p', 'g', 'e' are heavily weighted (>= 5 occurrences each)
      expect(poolGrand).not.toContain('d');
      for (const trap of ['t', 's', 'x', 'p', 'g', 'e']) {
        expect(countsGrand[trap]).toBeGreaterThanOrEqual(5);
      }
    });
  });

  describe('4. Phoneme-Grapheme Matrix (CPG Auditory Traps)', () => {
    it('opposes [s] graphemes ("c", "s", "z", "t", "x", and "ç" when accented) in context such as "prince" or "garçon"', () => {
      // GIVEN "prince" at index 4 ('c' before 'e' making the [s] sound)
      const poolPrince = (getPlausibleDistractors as any)('c', 'prince', [{ word: 'prince' }], 4) as string[];
      const countsPrince = countOccurrences(poolPrince);

      // THEN 's' is a top-weighted phonetic competitor (>= 5 occurrences)
      expect(poolPrince).not.toContain('c');
      expect(countsPrince['s']).toBeGreaterThanOrEqual(5);

      // GIVEN "garçon" at index 3 ('ç' before 'o')
      const poolGarcon = (getPlausibleDistractors as any)('ç', 'garçon', [{ word: 'garçon' }], 3) as string[];
      const countsGarcon = countOccurrences(poolGarcon);

      // THEN 'c' (forgotten cedilla trap) and 's' are heavily weighted (>= 5 occurrences)
      expect(poolGarcon).not.toContain('ç');
      expect(countsGarcon['c']).toBeGreaterThanOrEqual(5);
      expect(countsGarcon['s']).toBeGreaterThanOrEqual(5);
    });

    it('opposes [k] graphemes ("q", "c", "k") in words like "quinze" at index 0 ("q") and triggers the "u"-omission trap at index 1 ("u" after "q")', () => {
      // GIVEN "quinze" at index 0 ('q')
      const poolQ = (getPlausibleDistractors as any)('q', 'quinze', [{ word: 'quinze' }], 0) as string[];
      const countsQ = countOccurrences(poolQ);

      // THEN 'c' and 'k' are heavily weighted (>= 5 occurrences)
      expect(poolQ).not.toContain('q');
      expect(countsQ['c']).toBeGreaterThanOrEqual(5);
      expect(countsQ['k']).toBeGreaterThanOrEqual(5);

      // GIVEN "quinze" at index 1 ('u' after 'q', followed by 'i' at index 2)
      const poolUAfterQ = (getPlausibleDistractors as any)('u', 'quinze', [{ word: 'quinze' }], 1) as string[];
      const countsU = countOccurrences(poolUAfterQ);

      // THEN the next vowel 'i' (L[i+1], testing if the child skips the mandatory 'u' after 'q') is heavily weighted (>= 6 occurrences)
      expect(poolUAfterQ).not.toContain('u');
      expect(countsU['i']).toBeGreaterThanOrEqual(6);
    });

    it('opposes [ʒ] graphemes ("g" vs "j") before e/i/y (e.g., "singe" at index 3) and tests euphonious "e" omission in "mangeons"', () => {
      // GIVEN "singe" at index 3 ('g' before 'e')
      const poolSinge = (getPlausibleDistractors as any)('g', 'singe', [{ word: 'singe' }], 3) as string[];
      const countsSinge = countOccurrences(poolSinge);

      // THEN 'j' is heavily weighted (>= 5 occurrences)
      expect(poolSinge).not.toContain('g');
      expect(countsSinge['j']).toBeGreaterThanOrEqual(5);

      // GIVEN "mangeons" at index 4 (euphonious 'e' after 'g' and before 'o')
      const poolMangeons = (getPlausibleDistractors as any)('e', 'mangeons', [{ word: 'mangeons' }], 4) as string[];
      const countsMangeons = countOccurrences(poolMangeons);

      // THEN 'o' (L[i+1], representing forgetting the 'e' after 'g') and 'j' are heavily weighted (>= 5 occurrences)
      expect(poolMangeons).not.toContain('e');
      expect(countsMangeons['o']).toBeGreaterThanOrEqual(5);
    });

    it('tests mandatory "u" omission after "g" before e/i/ê (e.g., "guêpe" at index 1)', () => {
      // GIVEN "guêpe" at index 1 ('u' between 'g' and 'ê')
      const poolGuepe = (getPlausibleDistractors as any)('u', 'guêpe', [{ word: 'guêpe' }], 1) as string[];
      const countsGuepe = countOccurrences(poolGuepe);

      // THEN 'ê' and 'e' (skipping the 'u' after 'g') are heavily weighted (>= 5 occurrences)
      expect(poolGuepe).not.toContain('u');
      expect(countsGuepe['ê']).toBeGreaterThanOrEqual(5);
      expect(countsGuepe['e']).toBeGreaterThanOrEqual(5);
    });

    it('opposes [o] graphemes ("o", "a", "e", and "ô" when accented) in trigraphs/digraphs like "bateau" or "sauter"', () => {
      // GIVEN "bateau" at index 3 ('e' of "eau") and "sauter" at index 1 ('a' of "au")
      const poolBateau = (getPlausibleDistractors as any)('e', 'bateau', [{ word: 'bateau' }], 3) as string[];
      const countsBateau = countOccurrences(poolBateau);

      // THEN 'o' and 'a' are heavily weighted at the start of "eau" (>= 5 occurrences)
      expect(countsBateau['o']).toBeGreaterThanOrEqual(5);
      expect(countsBateau['a']).toBeGreaterThanOrEqual(5);

      const poolSauter = (getPlausibleDistractors as any)('a', 'sauter', [{ word: 'sauter' }], 1) as string[];
      const countsSauter = countOccurrences(poolSauter);

      // THEN 'o' and 'e' are heavily weighted at the start of "au" (>= 5 occurrences)
      expect(countsSauter['o']).toBeGreaterThanOrEqual(5);
      expect(countsSauter['e']).toBeGreaterThanOrEqual(5);
    });

    it('opposes [f] graphemes ("f" vs "p" from "ph") in words like "enfin" or "éléphant"', () => {
      // GIVEN "enfin" at index 2 ('f') and "éléphant" at index 3 ('p' before 'h')
      const poolEnfin = (getPlausibleDistractors as any)('f', 'enfin', [{ word: 'enfin' }], 2) as string[];
      const countsEnfin = countOccurrences(poolEnfin);

      const poolElephant = (getPlausibleDistractors as any)('p', 'éléphant', [{ word: 'éléphant' }], 3) as string[];
      const countsElephant = countOccurrences(poolElephant);

      // THEN 'p' (start of 'ph') and 'v' (voiced pair) are heavily weighted for 'f', and 'f' is heavily weighted for 'ph'
      expect(countsEnfin['p']).toBeGreaterThanOrEqual(4);
      expect(countsEnfin['v']).toBeGreaterThanOrEqual(4);
      expect(countsElephant['f']).toBeGreaterThanOrEqual(5);
    });

    it('opposes [e]/[ɛ] variants ("e", "é", "è", "ê", "a") when vocabulary contains accents', () => {
      // GIVEN an accented word "élève" at index 0 ('é') and index 2 ('è')
      const vocab = [{ word: 'élève' }, { word: 'fête' }];
      const poolEAcute = (getPlausibleDistractors as any)('é', 'élève', vocab, 0) as string[];
      const countsEAcute = countOccurrences(poolEAcute);

      // THEN 'e', 'è', 'ê', and 'a' (from 'ai') are all heavily weighted (>= 5 occurrences each)
      expect(poolEAcute).not.toContain('é');
      for (const variant of ['e', 'è', 'ê', 'a']) {
        expect(countsEAcute[variant]).toBeGreaterThanOrEqual(5);
      }
    });
  });

  describe('5. Silent H & Intervocalic [z] Traps', () => {
    it('proposes silent "h" against the initial vowel (and initial vowel against initial "h") at index 0', () => {
      // GIVEN "hibou" at index 0 ('h' followed by 'i') and "enfin" at index 0 ('e')
      const poolHibou = (getPlausibleDistractors as any)('h', 'hibou', [{ word: 'hibou' }], 0) as string[];
      const countsHibou = countOccurrences(poolHibou);

      const poolEnfin = (getPlausibleDistractors as any)('e', 'enfin', [{ word: 'enfin' }], 0) as string[];
      const countsEnfin = countOccurrences(poolEnfin);

      // THEN for "hibou" at index 0, 'i' (L[1], omitting silent initial 'h') is heavily weighted (>= 6 occurrences)
      expect(poolHibou).not.toContain('h');
      expect(countsHibou['i']).toBeGreaterThanOrEqual(6);

      // AND for vowel-initial "enfin" at index 0, silent 'h' is included as a weighted trap (>= 4 occurrences)
      expect(poolEnfin).not.toContain('e');
      expect(countsEnfin['h']).toBeGreaterThanOrEqual(4);
    });

    it('opposes intervocalic "s" and "z" (e.g., "maison" at index 3)', () => {
      // GIVEN "maison" at index 3 ('s' between vowels 'i' and 'o', pronounced [z])
      const poolMaison = (getPlausibleDistractors as any)('s', 'maison', [{ word: 'maison' }], 3) as string[];
      const countsMaison = countOccurrences(poolMaison);

      // THEN 'z' (phonetic trap) and 'c' are heavily weighted (>= 5 occurrences)
      expect(poolMaison).not.toContain('s');
      expect(countsMaison['z']).toBeGreaterThanOrEqual(5);
      expect(countsMaison['c']).toBeGreaterThanOrEqual(5);
    });
  });

  describe('6. Phonological Minimal Pairs (Sourde/Sonore) & Visual Symmetries (Dys-)', () => {
    it('weights phonological minimal pairs (p<->b, t<->d, c/k<->g, f<->v, s<->z, j<->g) and visual symmetries (b/d/p/q, m/n/u)', () => {
      // GIVEN a word "bateau" at index 0 ('b') and index 2 ('t')
      const poolB = (getPlausibleDistractors as any)('b', 'bateau', [{ word: 'bateau' }], 0) as string[];
      const countsB = countOccurrences(poolB);

      const poolT = (getPlausibleDistractors as any)('t', 'bateau', [{ word: 'bateau' }], 2) as string[];
      const countsT = countOccurrences(poolT);

      // THEN for 'b', minimal pair 'p' and visual symmetries 'd', 'q' are heavily weighted (>= 4 occurrences)
      for (const sym of ['p', 'd', 'q']) {
        expect(countsB[sym]).toBeGreaterThanOrEqual(4);
      }

      // AND for 't', minimal pair 'd' is heavily weighted (>= 4 occurrences)
      expect(countsT['d']).toBeGreaterThanOrEqual(4);
    });
  });

  describe('7. Integration with Game Core Smart Spawning (chooseNextBubbleCharOnState)', () => {
    it('passes state.currentIndex into getPlausibleDistractors during gameplay so context-sensitive traps spawn in bubbles', () => {
      // GIVEN a game state on word "quinze" advanced to index 1 ('u' after 'q' and before 'i')
      let state = createGameState({
        sessionWords: [{ word: 'quinze' }],
        allVocabWords: [{ word: 'quinze' }],
        seed: 500
      });

      // Tap 'q' (guaranteed at bubble index 2 in initial wave) to advance currentIndex to 1 ('u')
      const qBubble = state.bubbles.find((b) => b.char === 'q')!;
      state = stepGame(state, { type: 'TAP_BUBBLE', bubbleId: qBubble.id });
      expect(state.currentIndex).toBe(1);
      expect(state.targetChars[state.currentIndex]).toBe('u');

      // Clear futureChars effect by testing distractor selection across 90 spawns at index 1
      const spawnedDistractors: string[] = [];
      for (let i = 0; i < 90; i++) {
        const ch = chooseNextBubbleCharOnState(state);
        if (state.spawnCounter % 3 !== 0 && ch !== 'u') {
          spawnedDistractors.push(ch);
        }
      }

      // WHEN counting how often the contextual trap 'i' (skipping 'u' after 'q') appears among spawned non-target bubbles
      const iCount = spawnedDistractors.filter((c) => c === 'i').length;

      // THEN 'i' appears prominently (well above random 1/25 = 4% baseline, >= 12 times out of ~60 non-target spawns)
      expect(iCount).toBeGreaterThanOrEqual(12);
    });

    it('maintains invariant: getPlausibleDistractors with any targetIndex never returns requiredChar and never returns accents when vocab is unaccented', () => {
      // GIVEN arbitrary words, indices, and target characters
      const plainVocab = [{ word: 'printemps' }, { word: 'quinze' }, { word: 'sans' }];

      fc.assert(
        fc.property(
          fc.constantFrom('printemps', 'quinze', 'appeler', 'mangeons', 'bateau', 'hibou', 'maison'),
          fc.integer({ min: 0, max: 10 }),
          (word, rawIdx) => {
            const idx = rawIdx % word.length;
            const reqChar = word[idx];
            const pool = (getPlausibleDistractors as any)(reqChar, word, plainVocab, idx) as string[];

            expect(pool.length).toBeGreaterThan(0);
            expect(pool).not.toContain(reqChar);
            expect(pool.every((ch) => ch.charCodeAt(0) <= 127)).toBe(true);
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
