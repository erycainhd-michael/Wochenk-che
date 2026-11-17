// Ernährungsform, Allergien, Schwangerschaft und Abneigungen: Was darf in den Plan?
// Grundlage sind die Angaben je Zutat in ingredients.json (allergens = EU-14 nach LMIV, animal = tierische Herkunft,
// pregnancy = in der Schwangerschaft meiden). Spuren und Kreuzkontamination sind NICHT erfasst.

export const ALLERGENS = [
  ['gluten', 'Gluten'],
  ['milch', 'Milch / Laktose'],
  ['eier', 'Eier'],
  ['schalenfruechte', 'Nüsse'],
  ['erdnuesse', 'Erdnüsse'],
  ['fisch', 'Fisch'],
  ['krebstiere', 'Krebstiere'],
  ['weichtiere', 'Weichtiere'],
  ['soja', 'Soja'],
  ['sesam', 'Sesam'],
  ['sellerie', 'Sellerie'],
  ['senf', 'Senf'],
  ['sulfite', 'Sulfite'],
  ['lupinen', 'Lupinen'],
];

export const DIETS = [
  ['alles', 'Alles'],
  ['pescetarisch', 'Pescetarisch'],
  ['vegetarisch', 'Vegetarisch'],
  ['vegan', 'Vegan'],
];
const DIET_BLOCK = {
  alles: [],
  pescetarisch: ['fleisch'],
  vegetarisch: ['fleisch', 'fisch'],
  vegan: ['fleisch', 'fisch', 'milch', 'ei', 'honig'],
};

// Ernährungsweisen mit Gewicht 0–3: wie oft solche Hauptgerichte in den Plan kommen.
// 0 = nie, 1 = selten, 2 = normal, 3 = hauptsächlich. Ein Gericht gehört zu allen Klassen seiner Zutaten
// (Paella mit Hähnchen und Garnelen: Geflügel + Fisch), es zählt das kleinste Gewicht.
export const DIET_CLASSES = [
  ['vegan', 'Vegan', 'rein pflanzlich'],
  ['vegetarisch', 'Vegetarisch', 'mit Käse, Milch, Ei'],
  ['fisch', 'Fisch', 'auch Garnelen, Muscheln'],
  ['gefluegel', 'Geflügel', 'Hähnchen, Pute'],
  ['rind', 'Rind & Wild', 'Hack, Gulasch'],
  ['schwein', 'Schwein', 'auch Schinken, Speck, Wurst'],
];
export const DIET_LEVELS = ['nie', 'selten', 'normal', 'oft'];
/** Wie stark ein Gewicht die Auswahl verschiebt (Faktor auf die Wahrscheinlichkeit) */
export const DIET_FACTOR = [0, 0.2, 1, 10];
const MEAT = ['gefluegel', 'rind', 'schwein'];
const PRESETS = {
  alles: {},
  pescetarisch: { gefluegel: 0, rind: 0, schwein: 0 },
  vegetarisch: { fisch: 0, gefluegel: 0, rind: 0, schwein: 0 },
  vegan: { vegan: 3, vegetarisch: 0, fisch: 0, gefluegel: 0, rind: 0, schwein: 0 },
};
/** Gewichte aus den Einstellungen (ältere Einstellungen: aus der Ernährungsform abgeleitet) */
export function dietWeights(settings) {
  const base = Object.fromEntries(DIET_CLASSES.map(([k]) => [k, 2]));
  const preset = PRESETS[settings?.diet] || {};
  const own = settings?.dietWeights || {};
  // Die Ernährungsform sperrt immer: wer vegan eingestellt hat, bekommt nie Fleisch, egal was gespeichert ist
  const w = settings?.dietWeights ? { ...base, ...own } : { ...base, ...preset };
  for (const [k, v] of Object.entries(preset)) if (v === 0) w[k] = 0;
  return w;
}
export const dietPreset = (diet) => ({ ...Object.fromEntries(DIET_CLASSES.map(([k]) => [k, 2])), ...(PRESETS[diet] || {}) });
/** Ernährungsform, die zu den Gewichten passt (für Sperren von Honig, Gelatine & Co. und für die KI) */
export function dietFromWeights(w) {
  if (MEAT.some((k) => w[k] > 0)) return 'alles';
  if (w.fisch > 0) return 'pescetarisch';
  return w.vegetarisch > 0 ? 'vegetarisch' : 'vegan';
}
const MEAT_OF = { bratensauce: 'rind', rinderfond: 'rind', eintopf_erbsen: 'schwein', eintopf_linsen: 'schwein' };
/** Klassen eines Rezepts: vegan | vegetarisch | fisch | gefluegel | rind | schwein (mehrere möglich) */
export function recipeClasses(r, idx, settings = {}) {
  const out = new Set();
  let animalFree = true;
  for (const l of r.ingredients) {
    if (l.opt && !settings[l.opt]) continue;
    const i = idx.get(l.id);
    const an = i?.animal || [];
    if (!an.length) continue;
    animalFree = false;
    if (an.includes('fisch')) out.add('fisch');
    if (an.includes('fleisch')) out.add({ Geflügel: 'gefluegel', Schwein: 'schwein', Rind: 'rind' }[i.protein] || MEAT_OF[l.id] || 'rind');
  }
  if (!out.size) out.add(animalFree ? 'vegan' : 'vegetarisch');
  return out;
}
/** Kleinstes Gewicht über die Klassen des Rezepts (0–3) */
export function recipeDietWeight(r, idx, w, settings) {
  return Math.min(...[...recipeClasses(r, idx, settings)].map((c) => w[c] ?? 2));
}

// Freitext-Abneigungen, die eigentlich eine Allergie oder Ernährungsform meinen
const ALIASES = [
  [/^(nuss|nüsse|nüssen|schalenfr)/, ['schalenfruechte', 'erdnuesse'], []],
  [/^erdnu/, ['erdnuesse'], []],
  [/^(gluten|weizen|zöliak)/, ['gluten'], []],
  [/^(laktose|lactose|milch)/, ['milch'], []],
  [/^(ei|eier)$/, ['eier'], []],
  [/^fisch$/, ['fisch'], ['fisch']],
  [/^(meeresfr|garnele|shrimp|krebs|krabbe)/, ['krebstiere', 'weichtiere'], []],
  [/^muschel/, ['weichtiere'], []],
  [/^soja/, ['soja'], []],
  [/^sesam/, ['sesam'], []],
  [/^senf/, ['senf'], []],
  [/^sellerie/, ['sellerie'], []],
  [/^sulfit/, ['sulfite'], []],
  [/^lupin/, ['lupinen'], []],
  [/^fleisch$/, [], ['fleisch']],
  [/^honig$/, [], ['honig']],
];

const low = (s) => String(s || '').toLowerCase().trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Eine Abneigung als Regel: Allergene/Herkunft (bei bekannten Begriffen) und/oder Textsuche */
export function dislikeRule(term) {
  const t = low(term);
  for (const [re, allergens, animal] of ALIASES) if (re.test(t)) return { term: t, allergens, animal, alias: true };
  return { term: t, allergens: [], animal: [], alias: false };
}

/**
 * Trifft eine Abneigung diesen Text? Ganze Wörter, Wortanfang („Pilz“ → „Pilze“) und – ohne Alias – auch das
 * Wortende („Käse“ → „Hüttenkäse“). Nie mitten im Wort: „Ei“ trifft nicht „Reis“ oder „Schwein“.
 */
export function textHits(text, rule) {
  if (!rule.term) return false;
  const t = low(text);
  const w = '[a-zäöüß]';
  const start = new RegExp(`(^|[^a-zäöüß])${esc(rule.term)}`);
  if (start.test(t)) return true;
  if (rule.alias || rule.term.length < 4) return false;
  return new RegExp(`${esc(rule.term)}(?!${w})`).test(t);
}

/** Alles, was für diese Einstellungen gesperrt ist */
export function restrictions(settings) {
  const rules = (settings.dislikes || []).map(dislikeRule).filter((r) => r.term);
  return {
    allergens: new Set([...(settings.allergies || []), ...rules.flatMap((r) => r.allergens)]),
    animal: new Set([...(DIET_BLOCK[settings.diet] || []), ...rules.flatMap((r) => r.animal)]),
    pregnant: !!settings.profile?.pregnant,
    rules,
    weights: dietWeights(settings),
  };
}

/**
 * Darf das Rezept in den Plan? Liefert null (ja) oder einen kurzen Grund.
 * `rx` = restrictions(settings) – einmal berechnen, für viele Rezepte nutzen.
 */
export function recipeBlocked(r, settings, idx, rx = restrictions(settings)) {
  if (rx.pregnant && r.pregnancy) return 'Schwangerschaft';
  const lines = r.ingredients.filter((l) => !l.opt || settings[l.opt]);
  for (const l of lines) {
    const ing = idx.get(l.id);
    if (!ing) continue;
    const a = (ing.allergens || []).find((x) => rx.allergens.has(x));
    if (a) return ALLERGENS.find((x) => x[0] === a)?.[1] || a;
    const an = (ing.animal || []).find((x) => rx.animal.has(x));
    if (an) return settings.diet && settings.diet !== 'alles' ? DIETS.find((x) => x[0] === settings.diet)[1] : an;
    if (rx.pregnant && ing.pregnancy) return 'Schwangerschaft';
  }
  // Ernährungsweise auf „nie“: Fleisch- und Fischklassen gelten überall, vegan/vegetarisch nur für Hauptgerichte
  // (sonst verschwände mit „Vegetarisch: nie“ jedes Frühstück mit Joghurt)
  const w = rx.weights || dietWeights(settings);
  for (const c of recipeClasses(r, idx, settings)) {
    if (w[c] === 0 && (r.type === 'main' || !['vegan', 'vegetarisch'].includes(c))) return `${DIET_CLASSES.find((x) => x[0] === c)[1]}: nie`;
  }
  if (rx.rules.length) {
    const texts = [r.name, ...(r.contains || []), ...lines.map((l) => idx.get(l.id)?.name || '')];
    for (const rule of rx.rules) if (texts.some((t) => textHits(t, rule))) return rule.term;
  }
  return null;
}
