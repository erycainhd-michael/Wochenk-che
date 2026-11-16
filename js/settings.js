import { clone } from './util.js';

// Standard-Einstellungen. Werden mit gespeicherten Einstellungen zusammengeführt.

export const DEFAULT_SETTINGS = {
  version: 1,
  goals: { kcal: 2800, protein: 140, carbs: 350, fat: 90 },
  // 0–100 %
  sliders: { simple: 70, dishes: 70, offers: 50, variety: 60 },
  stores: { lidl: true, aldi: false, edeka: true, rewe: true, kaufland: true, dm: false, rossmann: false },
  mainStore: 'lidl',
  // Reihenfolge der Läden (per Ziehen in den Einstellungen): oben = Hauptladen. Leer = Hauptladen zuerst
  storeOrder: [],
  budget: 60,
  // Zwei Einkäufe pro Woche (Montag + Donnerstag): Frisches für die zweite Wochenhälfte erst donnerstags
  shopTwice: false,
  // Fertiggerichte – nur bei Angebot oder aus dem Vorrat: meals = Frosta & Co., pizza = Cheat Meal (max. 1×/Woche), soup = Eintopf mit Brot
  readyMeals: { meals: true, pizza: true, soup: true },
  // day: 0 = Montag … 6 = Sonntag; slot: fruehstueck | mittag | abend
  eatOut: [],
  eatOutKcal: 1000,
  eatOutProtein: 35,
  complexPerWeek: 1,
  dislikes: [],
  // Ernährungsform (alles | pescetarisch | vegetarisch | vegan) und Allergien (EU-14, siehe diet.js)
  diet: 'alles',
  allergies: [],
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
export const bmiOf = (kg, cm) => Number(kg) / (Number(cm) / 100) ** 2;
export const UNDERWEIGHT_BMI = 18.5;

/**
 * Darf dieses Ziel gewählt werden? Abnehmen nie bei Untergewicht (BMI unter 18,5) und nie unter 18 Jahren –
 * im Wachstum braucht der Körper Energie, ein Diät-Defizit gehört in ärztliche Begleitung.
 * Liefert null (erlaubt) oder den Grund ('underweight' | 'minor').
 */
export function goalBlocked(p, goal = p?.goal) {
  if (goal !== 'abnehmen' || !p) return null;
  if (p.pregnant) return 'pregnant';
  if (Number(p.age) > 0 && Number(p.age) < 18) return 'minor';
  if (Number(p.weight) > 0 && Number(p.height) > 0 && bmiOf(p.weight, p.height) < UNDERWEIGHT_BMI) return 'underweight';
  return null;
}

export function calcGoals(p) {
  const w = Number(p.weight);
  const h = Number(p.height);
  const a = Number(p.age);
  const bmr = 10 * w + 6.25 * h - 5 * a + (p.sex === 'm' ? 5 : -161);
  const pal = (ACTIVITY.find((x) => x[0] === p.activity) || ACTIVITY[0])[3];
  // Sicherheitsgurt: bei Untergewicht oder unter 18 gibt es kein Defizit – dann gilt „Halten“
  const goal = goalBlocked(p) ? 'halten' : p.goal;
  const [, , adj, perKg] = GOALS.find((x) => x[0] === goal) || GOALS[1];
  // Jugendliche wachsen noch: Mifflin-St Jeor unterschätzt ihren Bedarf (DGE-Richtwerte liegen ca. 10 % höher)
  const growth = a > 0 && a < 18 ? 1.1 : 1;
  // Schwangerschaft: ca. +250 kcal (DGE, ab dem 2. Trimester; im 1. Trimester reicht weniger) – kein Defizit
  const extra = p.pregnant ? 250 : 0;
  const kcal = Math.round((Math.max(bmr * 1.1, bmr * pal + adj) * growth + extra) / 50) * 50;
  const refW = Math.min(w, 27 * (h / 100) ** 2);
  const protein = Math.round((refW * perKg) / 5) * 5;
  const fat = Math.round((kcal * 0.3) / 9 / 5) * 5;
  const carbs = Math.round((kcal - protein * 4 - fat * 9) / 4 / 5) * 5;
  return { kcal, protein, carbs, fat };
}

/**
 * Neues Gewicht (z. B. aus dem Rückblick): Profil aktualisieren und Tagesziele mitziehen. Eigene Anpassungen
 * an den Zielen bleiben erhalten – es wird nur die Differenz der Berechnung (alt → neu) übernommen.
 * switched: 'underweight' (Abnehmen wurde automatisch beendet) · reached: Zielgewicht erreicht (App fragt nach).
 */
export function applyWeighIn(settings, kg) {
  const p = settings.profile;
  if (!p || !(Number(p.height) > 0) || !(Number(p.age) > 0) || !(kg > 0)) return null;
  const next = { ...p, weight: kg };
  let switched = null;
  if (goalBlocked(next)) {
    switched = goalBlocked(next);
    next.goal = 'halten';
  }
  const gw = Number(settings.goalWeight);
  const reached = !switched && gw > 0 && ((next.goal === 'abnehmen' && kg <= gw) || (next.goal === 'aufbauen' && kg >= gw));
  return { profile: next, goals: shiftGoals(settings.goals, calcGoals(p), calcGoals(next)), switched, reached };
}

/** Ziel wechseln (z. B. nach Erreichen des Zielgewichts auf Halten) und eigene Anpassungen behalten */
export function switchGoal(settings, goal) {
  const p = settings.profile;
  const next = { ...p, goal };
  return { profile: next, goals: shiftGoals(settings.goals, calcGoals(p), calcGoals(next)) };
}

function shiftGoals(cur, before, after) {
  const out = {};
  for (const k of ['kcal', 'protein', 'carbs', 'fat']) {
    const step = k === 'kcal' ? 50 : 5;
    out[k] = Math.max(0, Math.round(((cur?.[k] ?? before[k]) + after[k] - before[k]) / step) * step);
  }
  return out;
}
