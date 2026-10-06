// Standard-Einstellungen. Werden mit gespeicherten Einstellungen zusammengeführt.

export const DEFAULT_SETTINGS = {
  version: 1,
  goals: { kcal: 2800, protein: 140, carbs: 350, fat: 90 },
  // 0–100 %
  sliders: { simple: 70, dishes: 70, offers: 50, variety: 60 },
  stores: { lidl: true, edeka: true },
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
  dislikes: ['gekochter Kohlrabi', 'gekochte Möhren', 'Sellerie', 'klassische gekochte Bohnen'],
  // Ballaststoffe in g/Tag: Start, Steigerung pro Woche, Obergrenze
  fiber: { start: 28, step: 2, max: 40 },
  psyllium: false,
  proteinPowder: true,
  planHour: 8,
};

export function mergeSettings(saved) {
  const s = structuredClone(DEFAULT_SETTINGS);
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

export function fiberTargetFor(settings, weekNo) {
  const f = settings.fiber;
  return Math.min(f.max, f.start + f.step * Math.max(0, weekNo));
}
