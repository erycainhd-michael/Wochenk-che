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
  eatOut: [],
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
  // Angaben aus der Einführung (Geschlecht, Alter, Größe, Gewicht, Aktivität, Ziel)
  profile: null,
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

// --- Tagesziele aus der Einführung ---------------------------------------------

export const ACTIVITY = [
  ['wenig', 'Wenig', 'Büro, viel Sitzen', 1.4],
  ['mittel', 'Mittel', 'Viel auf den Beinen', 1.55],
  ['viel', 'Viel', 'Körperliche Arbeit', 1.75],
];
export const GOALS = [
  ['abnehmen', 'Abnehmen', -450, 1.5],
  ['halten', 'Halten', 0, 1.2],
  ['aufbauen', 'Aufbauen', 300, 1.8],
];

/**
 * Tagesziele aus den Angaben: Grundumsatz nach Mifflin-St Jeor × Alltagsaktivität (Sport kommt
 * später tageweise dazu), ± Ziel. Protein pro kg (bei hohem Gewicht auf BMI 27 begrenzt),
 * Fett 30 % der Kalorien, der Rest Kohlenhydrate.
 */
export function calcGoals(p) {
  const w = Number(p.weight);
  const h = Number(p.height);
  const a = Number(p.age);
  const bmr = 10 * w + 6.25 * h - 5 * a + (p.sex === 'm' ? 5 : -161);
  const pal = (ACTIVITY.find((x) => x[0] === p.activity) || ACTIVITY[0])[3];
  const [, , adj, perKg] = GOALS.find((x) => x[0] === p.goal) || GOALS[1];
  const kcal = Math.round(Math.max(bmr * 1.1, bmr * pal + adj) / 50) * 50;
  const refW = Math.min(w, 27 * (h / 100) ** 2);
  const protein = Math.round((refW * perKg) / 5) * 5;
  const fat = Math.round((kcal * 0.3) / 9 / 5) * 5;
  const carbs = Math.round((kcal - protein * 4 - fat * 9) / 4 / 5) * 5;
  return { kcal, protein, carbs, fat };
}
