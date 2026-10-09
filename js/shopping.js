// Einkaufsliste: Bedarf aus dem Plan minus Vorrat, auf ganze Packungen gerundet.

/**
 * @param plan       fertiger Wochenplan (days[].meals[].items)
 * @param idx        Zutaten-Index
 * @param pantry     { ingId: Gramm } – Reste der Vorwoche
 * @param priceOf    Preisfunktion aus prices.js
 * @param recipesById Map für Gerichtsnamen
 */
export function buildShopping({ plan, idx, pantry = {}, priceOf, recipesById }) {
  const need = new Map();
  const bakedCakes = new Set();
  for (const day of plan.days) {
    for (const meal of day.meals) {
      if (!meal.items) continue;
      // für mehrere Personen entsprechend mehr einkaufen
      let people = meal.people || 1;
      let items = meal.items;
      // Kuchen: einmal die ganze Form (Rezeptmenge) einkaufen – reicht für Samstag und Sonntag
      const cakeRecipe = (meal.cake || meal.sunday) && recipesById?.get(meal.recipeId);
      if (cakeRecipe?.serves > 1) {
        if (bakedCakes.has(meal.recipeId)) continue;
        bakedCakes.add(meal.recipeId);
        items = cakeRecipe.ingredients.map((l) => ({ id: l.id, g: l.g * cakeRecipe.serves }));
        people = 1;
      }
      for (const it of items) {
        const rid = it.addon || meal.recipeId;
        const rname = recipesById?.get(rid)?.name || rid;
        const e = need.get(it.id) || { g: 0, uses: new Set(), useIds: new Map() };
        e.g += it.g * people;
        e.uses.add(rname);
        e.useIds.set(rid, rname);
        need.set(it.id, e);
      }
    }
  }

  const items = [];
  const staples = [];
  const leftovers = {};
  let total = 0;
  let wasteEuro = 0;
  let stockEuro = 0; // Wert haltbarer Reste, die in den Folgewochen verbraucht werden

  for (const [id, e] of need) {
    const ing = idx.get(id);
    if (!ing) continue;
    const uses = [...e.uses];
    const useRefs = [...e.useIds].map(([rid, name]) => ({ id: rid, name }));
    if (ing.staple) {
      staples.push({ id, name: ing.name, g: Math.round(e.g), uses, useRefs });
      continue;
    }
    const have = Math.max(0, pantry[id] || 0);
    const toBuy = e.g - have;
    // 5 % Toleranz: lieber minimal kleinere Portion als eine ganze Extra-Packung
    const packs = toBuy <= 0 ? 0 : Math.max(1, Math.ceil((toBuy - 0.05 * ing.pack) / ing.pack));
    const pr = priceOf(id);
    const cost = packs * pr.price;
    const left = Math.max(0, have + packs * ing.pack - e.g);
    if (left >= 1) leftovers[id] = Math.round(left);
    if (left > 0 && ing.shelf <= 10) wasteEuro += (left / ing.pack) * pr.price;
    else if (left > 0) stockEuro += (Math.min(left, packs * ing.pack) / ing.pack) * pr.price;
    total += cost;
    items.push({
      id,
      name: ing.name,
      cat: ing.cat,
      store: pr.store,
      need: Math.round(e.g),
      have: Math.round(Math.min(have, e.g)),
      packs,
      pack: ing.pack,
      packLabel: ing.packLabel || `${ing.pack} g`,
      piece: ing.piece,
      pieceName: ing.pieceName,
      price: pr.price,
      regular: pr.regular,
      offer: pr.offer && packs > 0,
      offerTitle: pr.offerTitle,
      cost,
      leftover: Math.round(left),
      uses,
      useRefs,
      note: ing.note,
      elsewhere: !!pr.elsewhere,
    });
  }

  // Vorrat, der diese Woche nicht gebraucht wird, bleibt erhalten
  for (const [id, g] of Object.entries(pantry)) {
    if (!need.has(id) && g > 0 && idx.get(id) && !idx.get(id).staple) leftovers[id] = Math.round(g);
  }

  items.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return { items, staples, total, leftovers, wasteEuro, stockEuro, effective: total - stockEuro };
}

const PLURAL = { Ei: 'Eier', Banane: 'Bananen', Apfel: 'Äpfel', Wrap: 'Wraps', Limette: 'Limetten', Zitrone: 'Zitronen', Avocado: 'Avocados', Gurke: 'Gurken', Kürbis: 'Kürbisse' };
const pieceWord = (name = 'Stück', n) => (n === 1 ? name : PLURAL[name] || name);

/** Menge menschenlesbar, z. B. "2 × 500 g" oder "3 Paprika" */
export function packText(item) {
  if (item.piece && item.pack === item.piece) {
    return `${item.packs} ${pieceWord(item.pieceName, item.packs)}`;
  }
  return `${item.packs} × ${item.packLabel}`;
}

/** Zutatenmenge, z. B. "120 g (2 Eier)" oder "110 g" */
export function amountText(ing, g) {
  const grams = `${g < 10 ? (Math.round(g * 2) / 2).toLocaleString('de-DE') : Math.round(g)}g`;
  if (ing.piece && !ing.staple && g >= ing.piece * 0.6) {
    const step = ing.piece <= 130 ? 2 : 4;
    const n = Math.round((g / ing.piece) * step) / step;
    return `${grams} (${ing.piece > 130 ? '≈ ' : ''}${n.toLocaleString('de-DE')} ${pieceWord(ing.pieceName, n)})`;
  }
  return grams;
}
