// Feedback -> Rezeptgewichtung. Nichts wird verboten: Gewichte sinken höchstens bis 0,15.

/**
 * history: [{ weekStart, recipes: { [id]: { rating: 1|-1|0, again, tooComplex, note } }, week: {...} }]
 * Neuere Wochen zählen stärker (Halbwertszeit ca. 6 Wochen).
 */
export function recipeWeights(history = []) {
  const weights = {};
  const tooComplex = {};
  const sorted = [...history].sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
  sorted.forEach((week, i) => {
    const decay = Math.pow(0.5, i / 6);
    for (const [id, fb] of Object.entries(week.recipes || {})) {
      let delta = 0;
      if (fb.rating === 1) delta += 0.35;
      if (fb.rating === -1) delta -= 0.45;
      if (fb.again) delta += 0.4;
      weights[id] = (weights[id] || 0) + delta * decay;
      if (fb.tooComplex) tooComplex[id] = (tooComplex[id] || 0) + decay;
      if (fb.dishes) tooComplex[id] = (tooComplex[id] || 0) + 0.6 * decay;
    }
  });
  const out = {};
  for (const id of new Set([...Object.keys(weights), ...Object.keys(tooComplex)])) {
    out[id] = {
      weight: Math.min(3, Math.max(0.15, 1 + (weights[id] || 0))),
      tooComplex: tooComplex[id] || 0,
    };
  }
  return out;
}

/** Hinweise aus dem Wochen-Feedback (Sättigung, Energie, Gewicht) – nur Vorschläge, keine automatischen Änderungen */
export function weekHints(history = [], goals) {
  const hints = [];
  const sorted = [...history].filter((w) => w.week).sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
  const last = sorted[sorted.length - 1]?.week;
  if (last) {
    if (last.satiety && last.satiety <= 2)
      hints.push('Du warst letzte Woche eher hungrig. Mehr Volumen hilft: z. B. eine extra Portion Gemüse, Kartoffeln oder ein Skyr-Snack. Ggf. Kalorienziel um 100–200 kcal erhöhen.');
    if (last.energy && last.energy <= 2)
      hints.push('Wenig Energie? Achte auf Kohlenhydrate rund ums Training und regelmäßige Mahlzeiten – Snacks wie Banane mit Erdnussmus passen gut.');
  }
  const weights = sorted.filter((w) => w.week?.weight > 0).map((w) => ({ w: w.week.weight, d: w.weekStart }));
  if (weights.length >= 3) {
    const recent = weights.slice(-3);
    const change = recent[2].w - recent[0].w;
    if (change <= 0.1)
      hints.push(`Dein Gewicht ist in den letzten Wochen etwa gleich geblieben (${recent[0].w} → ${recent[2].w} kg). Für Muskelaufbau kannst du das Kalorienziel um ca. 150 kcal anheben (aktuell ${goals?.kcal} kcal).`);
    else if (change > 1.2)
      hints.push(`Du hast in drei Wochen ${change.toFixed(1).replace('.', ',')} kg zugenommen – etwas schneller als für Muskelaufbau nötig. Optional: Kalorienziel um ca. 100–150 kcal senken.`);
  }
  return hints;
}
