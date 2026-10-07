// Nährwertberechnung: Makros werden immer aus der Zutaten-Datenbank berechnet, nie geschätzt.
import { round } from './util.js';

export function buildIndex(ingredientsData) {
  const map = new Map();
  for (const it of ingredientsData.items) map.set(it.id, it);
  return map;
}

export const emptyMacros = () => ({ kcal: 0, p: 0, c: 0, f: 0, fib: 0, veg: 0 });

export function addMacros(a, b, k = 1) {
  return {
    kcal: a.kcal + b.kcal * k,
    p: a.p + b.p * k,
    c: a.c + b.c * k,
    f: a.f + b.f * k,
    fib: a.fib + b.fib * k,
    veg: a.veg + b.veg * k,
  };
}

export const isVegOrFruit = (ing) => ing.tags?.includes('gemuese') || ing.tags?.includes('obst');

/** Makros für eine Liste {id, g} */
export function itemsMacros(items, idx) {
  const m = emptyMacros();
  for (const { id, g } of items) {
    const ing = idx.get(id);
    if (!ing) continue;
    const k = g / 100;
    m.kcal += ing.kcal * k;
    m.p += ing.p * k;
    m.c += ing.c * k;
    m.f += ing.f * k;
    m.fib += ing.fib * k;
    if (isVegOrFruit(ing)) m.veg += g;
  }
  return m;
}

/** Rundet eine Grammzahl alltagstauglich (ganze Eier, 5-g-Schritte …) */
export function roundAmount(ing, g) {
  if (ing.piece && ing.piece <= 130 && !ing.staple && g >= ing.piece * 0.6) {
    return Math.max(1, Math.round(g / ing.piece)) * ing.piece;
  }
  if (g >= 40) return round(g, 5);
  if (g >= 10) return round(g, 1);
  return Math.round(g * 2) / 2;
}

/** Zutaten eines Rezepts für einen Portionsfaktor */
// Bausteine eines Gerichts, die der Planer getrennt anpassen darf (z. B. mehr Reis, etwas weniger Hähnchen)
const STARCH_CATS = new Set(['Nudeln, Reis & Getreide', 'Brot & Backwaren']);
const STARCH_IDS = new Set(['kartoffeln', 'suesskartoffel', 'gnocchi', 'roesti_tk', 'pizzateig', 'flammkuchenteig']);
/** 's' = Sättigungsbeilage (Kohlenhydrate), 'q' = magere Proteinquelle, 'r' = Rest */
export function partOf(ing) {
  if (!ing || ing.staple || ing.id === 'linsen_rot') return 'r';
  if (STARCH_CATS.has(ing.cat) || STARCH_IDS.has(ing.id)) return 's';
  if (ing.protein && ing.p >= 10 && ing.f <= 12) return 'q';
  return 'r';
}

/** mix = { s, q }: Faktoren für Beilage und Proteinquelle (1 = wie im Rezept) */
export function recipeItems(recipe, factor, settings, idx, mix = null) {
  const out = [];
  for (const line of recipe.ingredients) {
    if (line.opt && !settings?.[line.opt]) continue;
    const ing = idx.get(line.id);
    if (!ing) continue;
    const part = mix ? partOf(ing) : 'r';
    const m = part === 's' ? mix.s : part === 'q' ? mix.q : 1;
    out.push({ id: line.id, g: roundAmount(ing, line.g * factor * m), note: line.note });
  }
  return out;
}

/** Makros eines Rezepts (Faktor 1) getrennt nach Baustein */
export function recipeParts(recipe, idx, settings) {
  const parts = { s: [], q: [], r: [] };
  for (const line of recipe.ingredients) {
    if (line.opt && !settings?.[line.opt]) continue;
    const ing = idx.get(line.id);
    if (!ing) continue;
    parts[partOf(ing)].push({ id: line.id, g: line.g });
  }
  return { s: itemsMacros(parts.s, idx), q: itemsMacros(parts.q, idx), r: itemsMacros(parts.r, idx) };
}

export function recipeMacros(recipe, idx, settings, factor = 1) {
  const items = [];
  for (const line of recipe.ingredients) {
    if (line.opt && !settings?.[line.opt]) continue;
    items.push({ id: line.id, g: line.g * factor });
  }
  return itemsMacros(items, idx);
}

/** Hauptproteinquelle eines Rezepts (Zutat mit den meisten Gramm Protein) */
export function mainProteinCategory(recipe, idx) {
  let best = null;
  let bestP = 0;
  for (const line of recipe.ingredients) {
    const ing = idx.get(line.id);
    if (!ing?.protein) continue;
    const p = (ing.p * line.g) / 100;
    if (p > bestP) {
      bestP = p;
      best = ing.protein;
    }
  }
  return best || 'Sonstiges';
}

export function hasFish(recipe, idx) {
  return recipe.ingredients.some((l) => idx.get(l.id)?.tags?.includes('fisch'));
}

/** Plausibilitätscheck: passen kcal und Makros (4/4/9) zusammen? */
export function plausibility(goals) {
  const fromMacros = goals.protein * 4 + goals.carbs * 4 + goals.fat * 9;
  const diff = fromMacros - goals.kcal;
  const rel = goals.kcal ? diff / goals.kcal : 0;
  let message = '';
  if (Math.abs(rel) > 0.05) {
    const dir = diff > 0 ? 'mehr' : 'weniger';
    const fixCarbs = Math.round((goals.kcal - goals.protein * 4 - goals.fat * 9) / 4);
    message =
      `Deine Makros ergeben ${Math.round(fromMacros)} kcal – das sind ${Math.abs(Math.round(diff))} kcal ${dir} als dein Kalorienziel. ` +
      (fixCarbs > 0
        ? `Passend wären z. B. ${fixCarbs}g Kohlenhydrate bei gleichem Protein und Fett.`
        : 'Bitte Protein oder Fett etwas reduzieren oder das Kalorienziel erhöhen.');
  }
  return { fromMacros: Math.round(fromMacros), diff: Math.round(diff), rel, ok: Math.abs(rel) <= 0.05, message, suggestedCarbs: Math.round((goals.kcal - goals.protein * 4 - goals.fat * 9) / 4) };
}
