/**
 * 30+ Kawaii Plushie Collection, Programmatic SVG Sprite Generator & Shelf Persistence
 *
 * Art Style:
 * - Hand-drawn children's book / kawaii illustration with clean dark-brown/black ink outlines (#4A2E1B),
 *   soft watercolor washes, warm cozy lighting, and pastel accents.
 * - White cat ('white-cat-flocon') is the signature mascot across levels.
 * - Each of the 32 plushies supports both 'standard' and 'golden' visual states
 *   (golden gradient shader, animated sparkle aura, and royal crown overlay).
 */

import { getStorage, getActiveProfileId } from './srs.js';

export const PLUSHIE_SHELF_STORAGE_PREFIX = 'hottub_plushie_shelf_v1_';

/**
 * @typedef {'standard' | 'golden'} PlushieVariant
 */

/**
 * @typedef {object} PlushieCatalogItem
 * @property {string} id
 * @property {string} name
 * @property {'cats' | 'woodland' | 'pastries' | 'cozy'} category
 * @property {string} shape
 * @property {string} primaryColor
 * @property {string} secondaryColor
 * @property {string} accentColor
 */

/**
 * @typedef {object} PlushieShelfEntry
 * @property {string} plushieId
 * @property {PlushieVariant} variant
 * @property {string} [word]
 * @property {string} [unlockedAt]
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [shelfTier]
 */

/**
 * Catalog of 32 distinct kawaii plushies across 4 cozy categories.
 * @type {PlushieCatalogItem[]}
 */
export const PLUSHIE_CATALOG = [
  // 1–8: Cute Cats (Led by the signature White Cat from bg-hottub.webp)
  {
    id: 'white-cat-flocon',
    name: 'Flocon the White Cat',
    category: 'cats',
    shape: 'cat-mask',
    primaryColor: '#FFFDF9',
    secondaryColor: '#F5EFE6',
    accentColor: '#F497A9'
  },
  {
    id: 'orange-cat-miel',
    name: 'Miel the Ginger Cat',
    category: 'cats',
    shape: 'cat-towel',
    primaryColor: '#F8B26A',
    secondaryColor: '#E59446',
    accentColor: '#88C478'
  },
  {
    id: 'gray-cat-brume',
    name: 'Brume the Spa Cat',
    category: 'cats',
    shape: 'cat-headband',
    primaryColor: '#A7ABB0',
    secondaryColor: '#8A8E94',
    accentColor: '#FFFDF9'
  },
  {
    id: 'calico-cat-praline',
    name: 'Praline the Calico Cat',
    category: 'cats',
    shape: 'cat',
    primaryColor: '#FFF8EE',
    secondaryColor: '#E89954',
    accentColor: '#7A5A3E'
  },
  {
    id: 'tuxedo-cat-figaro',
    name: 'Figaro the Tuxedo Cat',
    category: 'cats',
    shape: 'cat-bow',
    primaryColor: '#524944',
    secondaryColor: '#FFFDF9',
    accentColor: '#E84A4A'
  },
  {
    id: 'siamese-cat-chai',
    name: 'Chaï the Siamese Cat',
    category: 'cats',
    shape: 'cat',
    primaryColor: '#F7E7CE',
    secondaryColor: '#8C6246',
    accentColor: '#BCE3E8'
  },
  {
    id: 'peach-cat-peche',
    name: 'Pêche the Rosy Kitty',
    category: 'cats',
    shape: 'cat-heart',
    primaryColor: '#FAD4C8',
    secondaryColor: '#F497A9',
    accentColor: '#FFF0A5'
  },
  {
    id: 'lavender-cat-lilas',
    name: 'Lilas the Starry Cat',
    category: 'cats',
    shape: 'cat-star',
    primaryColor: '#E2D4F0',
    secondaryColor: '#C5B0DC',
    accentColor: '#FFF0A5'
  },

  // 9–20: Woodland & Bath Creatures
  {
    id: 'capybara-yuzu',
    name: 'Yuzu the Bath Capybara',
    category: 'woodland',
    shape: 'capybara',
    primaryColor: '#DFC3A4',
    secondaryColor: '#CAA887',
    accentColor: '#FAD246'
  },
  {
    id: 'duckling-caneton',
    name: 'Pompon the Rubber Duck',
    category: 'woodland',
    shape: 'duck',
    primaryColor: '#FAD246',
    secondaryColor: '#F3BF26',
    accentColor: '#F07C4A'
  },
  {
    id: 'fox-renard',
    name: 'Noisette the Little Fox',
    category: 'woodland',
    shape: 'fox',
    primaryColor: '#EB8A52',
    secondaryColor: '#FFF8EE',
    accentColor: '#4A2E1B'
  },
  {
    id: 'owl-hibou',
    name: 'Chouette the Cozy Owl',
    category: 'woodland',
    shape: 'owl',
    primaryColor: '#C89D7C',
    secondaryColor: '#F5E6D3',
    accentColor: '#FAD246'
  },
  {
    id: 'bunny-lapin',
    name: 'illeul the Lop Bunny',
    category: 'woodland',
    shape: 'bunny',
    primaryColor: '#FFF6F0',
    secondaryColor: '#F497A9',
    accentColor: '#BCE3E8'
  },
  {
    id: 'hedgehog-herisson',
    name: 'Châtaigne the Hedgehog',
    category: 'woodland',
    shape: 'hedgehog',
    primaryColor: '#A67553',
    secondaryColor: '#F3DEC8',
    accentColor: '#F497A9'
  },
  {
    id: 'bear-ourson',
    name: 'Brioche the Honey Bear',
    category: 'woodland',
    shape: 'bear',
    primaryColor: '#C99366',
    secondaryColor: '#F5DFC6',
    accentColor: '#FAD246'
  },
  {
    id: 'raccoon-raton',
    name: 'Filou the Raccoon',
    category: 'woodland',
    shape: 'raccoon',
    primaryColor: '#9E9A95',
    secondaryColor: '#5C554E',
    accentColor: '#FFF8EE'
  },
  {
    id: 'deer-faon',
    name: 'Bambi the Spotted Fawn',
    category: 'woodland',
    shape: 'deer',
    primaryColor: '#D99B66',
    secondaryColor: '#FFF6E8',
    accentColor: '#88C478'
  },
  {
    id: 'squirrel-ecureuil',
    name: 'Gland the Red Squirrel',
    category: 'woodland',
    shape: 'squirrel',
    primaryColor: '#D47448',
    secondaryColor: '#F7E3D0',
    accentColor: '#8C583A'
  },
  {
    id: 'frog-grenouille',
    name: 'Menthe the Pond Frog',
    category: 'woodland',
    shape: 'frog',
    primaryColor: '#88C478',
    secondaryColor: '#D9F0CE',
    accentColor: '#F497A9'
  },
  {
    id: 'otter-loutre',
    name: 'Galet the River Otter',
    category: 'woodland',
    shape: 'otter',
    primaryColor: '#9E7356',
    secondaryColor: '#EAD5C3',
    accentColor: '#BCE3E8'
  },

  // 21–26: French Pastries
  {
    id: 'croissant-dore',
    name: 'Croissant au Beurre',
    category: 'pastries',
    shape: 'croissant',
    primaryColor: '#F2B866',
    secondaryColor: '#D9943B',
    accentColor: '#FFF0A5'
  },
  {
    id: 'macaron-framboise',
    name: 'Macaron Framboise',
    category: 'pastries',
    shape: 'macaron',
    primaryColor: '#F497A9',
    secondaryColor: '#FFF5F7',
    accentColor: '#E84A4A'
  },
  {
    id: 'eclair-choco',
    name: 'Éclair au Chocolat',
    category: 'pastries',
    shape: 'eclair',
    primaryColor: '#F0C382',
    secondaryColor: '#6B4226',
    accentColor: '#FFFDF9'
  },
  {
    id: 'brioche-sucre',
    name: 'Brioche Perdue',
    category: 'pastries',
    shape: 'brioche',
    primaryColor: '#EFA954',
    secondaryColor: '#F9DEC0',
    accentColor: '#FFFDF9'
  },
  {
    id: 'tartelette-fraise',
    name: 'Tartelette aux Fraises',
    category: 'pastries',
    shape: 'tart',
    primaryColor: '#E84A4A',
    secondaryColor: '#F2C58A',
    accentColor: '#88C478'
  },
  {
    id: 'crepe-erable',
    name: 'Crêpe au Sirop d’Érable',
    category: 'pastries',
    shape: 'crepe',
    primaryColor: '#F5CE85',
    secondaryColor: '#C8762E',
    accentColor: '#FFF0A5'
  },

  // 27–32: Bath & Cozy Spa Items
  {
    id: 'teapot-camomille',
    name: 'Théière Camomille',
    category: 'cozy',
    shape: 'teapot',
    primaryColor: '#BCE3E8',
    secondaryColor: '#8CC4CE',
    accentColor: '#FFF0A5'
  },
  {
    id: 'candle-vanille',
    name: 'Bougie Douce Vanille',
    category: 'cozy',
    shape: 'candle',
    primaryColor: '#FFF0A5',
    secondaryColor: '#F7D969',
    accentColor: '#F07C4A'
  },
  {
    id: 'slipper-nuage',
    name: 'Pantoufle Nuage',
    category: 'cozy',
    shape: 'slipper',
    primaryColor: '#F497A9',
    secondaryColor: '#FCE0E6',
    accentColor: '#FFFDF9'
  },
  {
    id: 'bath-bomb-lavande',
    name: 'Boule de Bain Effervescente',
    category: 'cozy',
    shape: 'bathbomb',
    primaryColor: '#D3C0EE',
    secondaryColor: '#BCE3E8',
    accentColor: '#FFF0A5'
  },
  {
    id: 'plant-monstera',
    name: 'Petit Pot de Pothos',
    category: 'cozy',
    shape: 'plant',
    primaryColor: '#88C478',
    secondaryColor: '#F497A9',
    accentColor: '#8C583A'
  },
  {
    id: 'towel-roll-spa',
    name: 'Serviette Chaude de Spa',
    category: 'cozy',
    shape: 'towel',
    primaryColor: '#BCE3E8',
    secondaryColor: '#FFFDF9',
    accentColor: '#F497A9'
  }
];

/**
 * Looks up a plushie catalog definition by ID, falling back to the white cat mascot.
 * @param {string} plushieId
 * @returns {PlushieCatalogItem}
 */
export function getPlushieById(plushieId) {
  return PLUSHIE_CATALOG.find((p) => p.id === plushieId) || PLUSHIE_CATALOG[0];
}

/**
 * Renders a kawaii children's book watercolor SVG sprite for a plushie in either 'standard' or 'golden' state.
 * @param {string} plushieId
 * @param {PlushieVariant} [variant='standard']
 * @returns {string}
 */
export function renderPlushieSvg(plushieId, variant = 'standard') {
  const item = getPlushieById(plushieId);
  const isGolden = variant === 'golden';
  const stroke = isGolden ? '#5C3A10' : '#4A2E1B';
  const primary = isGolden ? `url(#golden-plushie-grad-${item.id})` : item.primaryColor;
  const secondary = isGolden ? '#FFE885' : item.secondaryColor;
  const accent = isGolden ? '#F5A623' : item.accentColor;

  const goldenDefs = isGolden
    ? `<defs>
        <linearGradient id="golden-plushie-grad-${item.id}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FFF7C2" />
          <stop offset="45%" stop-color="#FAD246" />
          <stop offset="100%" stop-color="#E59A18" />
        </linearGradient>
        <radialGradient id="golden-aura-${item.id}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#FFF0A5" stop-opacity="0.85" />
          <stop offset="70%" stop-color="#FAD246" stop-opacity="0.35" />
          <stop offset="100%" stop-color="#FAD246" stop-opacity="0" />
        </radialGradient>
      </defs>
      <circle class="golden-plushie-aura" cx="48" cy="52" r="44" fill="url(#golden-aura-${item.id})" />`
    : '';

  let bodyArt = '';

  if (item.category === 'cats') {
    const accessory =
      item.shape === 'cat-mask'
        ? `<rect x="26" y="25" width="44" height="14" rx="7" fill="${accent}" stroke="${stroke}" stroke-width="2.2" />
           <path d="M33 32 Q38 35 43 32 M53 32 Q58 35 63 32" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" />`
        : item.shape === 'cat-towel'
        ? `<ellipse cx="48" cy="24" rx="22" ry="11" fill="${accent}" stroke="${stroke}" stroke-width="2.2" />
           <path d="M30 24 Q48 18 66 24" fill="none" stroke="${stroke}" stroke-width="1.8" />`
        : item.shape === 'cat-headband'
        ? `<path d="M25 32 Q48 24 71 32" fill="none" stroke="${accent}" stroke-width="6" stroke-linecap="round" />
           <path d="M25 32 Q48 24 71 32" fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linecap="round" />`
        : `<circle cx="48" cy="70" r="6" fill="${accent}" stroke="${stroke}" stroke-width="2" />`;

    bodyArt = `
      <!-- Cat Plushie Body & Ears -->
      <ellipse cx="48" cy="66" rx="26" ry="20" fill="${primary}" stroke="${stroke}" stroke-width="2.6" />
      <polygon points="24,42 20,18 38,30" fill="${primary}" stroke="${stroke}" stroke-width="2.6" stroke-linejoin="round" />
      <polygon points="72,42 76,18 58,30" fill="${primary}" stroke="${stroke}" stroke-width="2.6" stroke-linejoin="round" />
      <polygon points="25,38 23,23 35,31" fill="#F497A9" opacity="0.75" />
      <polygon points="71,38 73,23 61,31" fill="#F497A9" opacity="0.75" />
      <circle cx="48" cy="46" r="23" fill="${primary}" stroke="${stroke}" stroke-width="2.6" />
      ${accessory}
      <!-- Cute Paws -->
      <ellipse cx="35" cy="82" rx="7" ry="5" fill="${secondary}" stroke="${stroke}" stroke-width="2.2" />
      <ellipse cx="61" cy="82" rx="7" ry="5" fill="${secondary}" stroke="${stroke}" stroke-width="2.2" />
      <!-- Whiskers -->
      <path d="M18 47 L28 49 M18 53 L28 52 M78 47 L68 49 M78 53 L68 52" stroke="${stroke}" stroke-width="2" stroke-linecap="round" />
    `;
  } else if (item.shape === 'bunny') {
    bodyArt = `
      <ellipse cx="36" cy="22" rx="7" ry="16" fill="${primary}" stroke="${stroke}" stroke-width="2.6" />
      <ellipse cx="60" cy="22" rx="7" ry="16" fill="${primary}" stroke="${stroke}" stroke-width="2.6" />
      <ellipse cx="36" cy="23" rx="3.5" ry="10" fill="${secondary}" />
      <ellipse cx="60" cy="23" rx="3.5" ry="10" fill="${secondary}" />
      <ellipse cx="48" cy="60" rx="26" ry="25" fill="${primary}" stroke="${stroke}" stroke-width="2.6" />
      <circle cx="48" cy="47" r="21" fill="${primary}" stroke="${stroke}" stroke-width="2.6" />
    `;
  } else if (item.shape === 'duck') {
    bodyArt = `
      <ellipse cx="48" cy="65" rx="27" ry="19" fill="${primary}" stroke="${stroke}" stroke-width="2.6" />
      <circle cx="48" cy="42" r="19" fill="${primary}" stroke="${stroke}" stroke-width="2.6" />
      <ellipse cx="48" cy="50" rx="8" ry="4.5" fill="${accent}" stroke="${stroke}" stroke-width="2.2" />
    `;
  } else if (item.category === 'pastries') {
    bodyArt = `
      <path d="M20 58 C18 36, 34 26, 48 26 C62 26, 78 36, 76 58 C75 74, 62 82, 48 82 C34 82, 21 74, 20 58 Z" fill="${primary}" stroke="${stroke}" stroke-width="2.6" />
      <path d="M26 46 Q48 36 70 46" fill="none" stroke="${secondary}" stroke-width="5" stroke-linecap="round" />
      <circle cx="48" cy="28" r="6" fill="${accent}" stroke="${stroke}" stroke-width="2.2" />
    `;
  } else {
    bodyArt = `
      <circle cx="30" cy="30" r="9" fill="${secondary}" stroke="${stroke}" stroke-width="2.4" />
      <circle cx="66" cy="30" r="9" fill="${secondary}" stroke="${stroke}" stroke-width="2.4" />
      <ellipse cx="48" cy="58" rx="27" ry="26" fill="${primary}" stroke="${stroke}" stroke-width="2.6" />
      <ellipse cx="48" cy="65" rx="16" ry="12" fill="${secondary}" opacity="0.85" />
    `;
  }

  const kawaiiFace = `
    <!-- Kawaii Eyes, Nose & Watercolor Blush -->
    <circle cx="38" cy="46" r="3.1" fill="#2C1B10" />
    <circle cx="39" cy="44.8" r="1.1" fill="#FFFFFF" />
    <circle cx="58" cy="46" r="3.1" fill="#2C1B10" />
    <circle cx="59" cy="44.8" r="1.1" fill="#FFFFFF" />
    <ellipse cx="32" cy="52" rx="4.8" ry="2.6" fill="#F497A9" opacity="0.68" />
    <ellipse cx="64" cy="52" rx="4.8" ry="2.6" fill="#F497A9" opacity="0.68" />
    <path d="M44 51 Q48 55 52 51" fill="none" stroke="#2C1B10" stroke-width="2.2" stroke-linecap="round" />
  `;

  const goldenCrownAndSparkles = isGolden
    ? `<!-- Golden Crown & Animated Sparkle Overlay -->
      <g class="golden-crown-overlay">
        <polygon points="35,20 40,8 48,16 56,8 61,20" fill="#FAD246" stroke="#5C3A10" stroke-width="2.2" stroke-linejoin="round" />
        <circle cx="48" cy="11" r="2.2" fill="#E84A4A" />
      </g>
      <g class="golden-sparkles" fill="#FFF7C2" stroke="#D48806" stroke-width="1.2">
        <path d="M14 24 L16 18 L18 24 L24 26 L18 28 L16 34 L14 28 L8 26 Z" />
        <path d="M80 20 L81.5 15 L83 20 L88 21.5 L83 23 L81.5 28 L80 23 L75 21.5 Z" />
        <circle cx="18" cy="74" r="3" />
        <circle cx="82" cy="70" r="2.5" />
      </g>`
    : '';

  return `<svg class="plushie-svg is-${variant}" data-plushie-id="${item.id}" data-variant="${variant}" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${item.name} (${variant})">${goldenDefs}${bodyArt}${kawaiiFace}${goldenCrownAndSparkles}</svg>`;
}

/**
 * Selects a plushie from the 30+ catalog and determines its tiered variant ('golden' for attempt === 1, 'standard' for attempt > 1).
 *
 * @param {PlushieShelfEntry[]} shelf
 * @param {number} attempt
 * @param {() => number} [prng=Math.random]
 * @param {string | null} [preferredPlushieId=null]
 * @returns {{ plushieId: string, variant: PlushieVariant }}
 */
export function selectPlushieForReward(shelf = [], attempt = 1, prng = Math.random, preferredPlushieId = null) {
  /** @type {PlushieVariant} */
  const variant = attempt === 1 ? 'golden' : 'standard';

  if (preferredPlushieId && PLUSHIE_CATALOG.some((p) => p.id === preferredPlushieId)) {
    return { plushieId: preferredPlushieId, variant };
  }

  const safeShelf = Array.isArray(shelf) ? shelf : [];
  const byId = new Map(safeShelf.map((entry) => [entry.plushieId, entry]));

  // 1. Prefer plushies not yet on the shelf
  const uncollected = PLUSHIE_CATALOG.filter((p) => !byId.has(p.id));
  if (uncollected.length > 0) {
    const picked = uncollected[Math.floor(prng() * uncollected.length)];
    return { plushieId: picked.id, variant };
  }

  // 2. If all 32 are on the shelf, prefer upgrading a 'standard' plushie to 'golden'
  const standardOnShelf = PLUSHIE_CATALOG.filter((p) => {
    const existing = byId.get(p.id);
    return existing && existing.variant === 'standard';
  });
  if (standardOnShelf.length > 0) {
    const picked = standardOnShelf[Math.floor(prng() * standardOnShelf.length)];
    return { plushieId: picked.id, variant };
  }

  // 3. Fallback to any catalog plushie
  const fallback = PLUSHIE_CATALOG[Math.floor(prng() * PLUSHIE_CATALOG.length)];
  return { plushieId: fallback.id, variant };
}

/**
 * Inserts a newly earned plushie onto the shelf OR upgrades an existing plushie from 'standard' to 'golden'
 * in-place without creating duplicate plushieId entries. Never downgrades 'golden' to 'standard'.
 *
 * @param {PlushieShelfEntry[]} currentShelf
 * @param {{ plushieId: string, variant: PlushieVariant }} reward
 * @param {{ word?: string, x?: number, y?: number, shelfTier?: number }} [meta={}]
 * @returns {{ shelf: PlushieShelfEntry[], upgraded: boolean, added: boolean, entry: PlushieShelfEntry }}
 */
export function upsertPlushieOnShelf(currentShelf, reward, meta = {}) {
  const list = Array.isArray(currentShelf) ? currentShelf.map((item) => ({ ...item })) : [];
  const plushieId = String(reward && reward.plushieId ? reward.plushieId : PLUSHIE_CATALOG[0].id);
  /** @type {PlushieVariant} */
  const incomingVariant = reward && reward.variant === 'golden' ? 'golden' : 'standard';

  const existingIdx = list.findIndex((item) => item.plushieId === plushieId);

  if (existingIdx !== -1) {
    const existing = list[existingIdx];
    const upgraded = existing.variant === 'standard' && incomingVariant === 'golden';
    /** @type {PlushieVariant} */
    const finalVariant = existing.variant === 'golden' || incomingVariant === 'golden' ? 'golden' : 'standard';

    const updatedEntry = {
      ...existing,
      variant: finalVariant,
      word: meta.word !== undefined ? meta.word : existing.word,
      x: typeof meta.x === 'number' && Number.isFinite(meta.x) ? meta.x : existing.x,
      y: typeof meta.y === 'number' && Number.isFinite(meta.y) ? meta.y : existing.y,
      shelfTier: typeof meta.shelfTier === 'number' ? meta.shelfTier : existing.shelfTier
    };
    list[existingIdx] = updatedEntry;
    return {
      shelf: list,
      upgraded,
      added: false,
      entry: updatedEntry
    };
  }

  /** @type {PlushieShelfEntry} */
  const newEntry = {
    plushieId,
    variant: incomingVariant,
    ...(meta.word !== undefined ? { word: meta.word } : {}),
    ...(typeof meta.x === 'number' && Number.isFinite(meta.x) ? { x: meta.x } : {}),
    ...(typeof meta.y === 'number' && Number.isFinite(meta.y) ? { y: meta.y } : {}),
    ...(typeof meta.shelfTier === 'number' ? { shelfTier: meta.shelfTier } : {})
  };
  list.push(newEntry);

  return {
    shelf: list,
    upgraded: false,
    added: true,
    entry: newEntry
  };
}

/**
 * Loads the persisted plushie shelf for a learner profile.
 * @param {string} [profileId]
 * @param {import('./srs.js').StorageLike} [customStorage]
 * @returns {PlushieShelfEntry[]}
 */
export function loadPlushieShelf(profileId, customStorage) {
  const store = getStorage(customStorage);
  const pid = profileId || getActiveProfileId(store);
  try {
    const raw = store.getItem(`${PLUSHIE_SHELF_STORAGE_PREFIX}${pid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    /** @type {PlushieShelfEntry[]} */
    const deduped = [];
    for (const item of parsed) {
      if (item && typeof item.plushieId === 'string') {
        const res = upsertPlushieOnShelf(
          deduped,
          {
            plushieId: item.plushieId,
            variant: item.variant === 'golden' ? 'golden' : 'standard'
          },
          {
            word: item.word,
            x: item.x,
            y: item.y,
            shelfTier: item.shelfTier
          }
        );
        deduped.length = 0;
        deduped.push(...res.shelf);
      }
    }
    return deduped;
  } catch {
    return [];
  }
}

/**
 * Saves the plushie shelf for a learner profile.
 * @param {PlushieShelfEntry[]} shelf
 * @param {string} [profileId]
 * @param {import('./srs.js').StorageLike} [customStorage]
 */
export function savePlushieShelf(shelf, profileId, customStorage) {
  const store = getStorage(customStorage);
  const pid = profileId || getActiveProfileId(store);
  try {
    store.setItem(`${PLUSHIE_SHELF_STORAGE_PREFIX}${pid}`, JSON.stringify(shelf || []));
  } catch {
    // Ignore storage quota errors
  }
}
