import { clone } from './util.js';

// Standard-Einstellungen. Werden mit gespeicherten Einstellungen zusammengeführt.

export const DEFAULT_SETTINGS = {
  version: 1,
  goals: { kcal: 2800, protein: 140, carbs: 350, fat: 90 },
  // 0–100 %
  sliders: { simple: 70, dishes: 70, offers: 50, variety: 60 },
  stores: { lidl: true, aldi: false, edeka: true, dm: false, rossmann: false },
  mainStore: 'lidl',
  budget: 60,
  // day: 0 = Montag … 6 = Sonntag; slot: fruehstueck | mittag | abend
  eatOut: [
    { day: 4, slot: 'abend' },
    { day: 5, slot: 'abend' },
  ],
  eatOutKcal: 1000,
  eatOutProtein: 35,
  complexPerWeek: 1,
  dislikes: [],
  // Ballaststoffe: ausgewogenes Tagesziel in g
  fiber: { target: 32 },
  psyllium: false,
  proteinPowder: true,
  // Studi-Modus: besonders günstige, trotzdem ausgewogene Pläne
  studi: false,
  planHour: 8,
  // Name für die Begrüßung in der Wochenübersicht
  name: '',
  sounds: true,
  // Zielgewicht in kg (Dezimalzahl), wird im Rückblick angezeigt
  goalWeight: null,
  // Optional: eigener Claude-API-Schlüssel, um ein Rezept sofort aus einem Titel zu erfinden
  aiKey: '',
};

export function mergeSettings(saved) {
  const s = clone(DEFAULT_SETTINGS);
  if (!saved) return s;
  for (const [k, v] of Object.entries(saved)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) {
      s[k] = { ...s[k], ...v };
    } else if (v !== undefined) {
      s[k] = v;
    }
  }
  return s;
}

export function fiberTargetFor(settings) {
  return settings.fiber?.target || 32;
}
