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
  if (rx.rules.length) {
    const texts = [r.name, ...(r.contains || []), ...lines.map((l) => idx.get(l.id)?.name || '')];
    for (const rule of rx.rules) if (texts.some((t) => textHits(t, rule))) return rule.term;
  }
  return null;
}
