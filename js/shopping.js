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
  for (const day of plan.days) {
    for (const meal of day.meals) {
      if (!meal.items) continue;
      const rname = recipesById?.get(meal.recipeId)?.name || meal.recipeId;
      for (const it of meal.items) {
        const e = need.get(it.id) || { g: 0, uses: new Set() };
        e.g += it.g;
        e.uses.add(rname);
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
    if (ing.staple) {
      staples.push({ id, name: ing.name, g: Math.round(e.g), uses });
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
      note: ing.note,
    });
  }

  // Vorrat, der diese Woche nicht gebraucht wird, bleibt erhalten
  for (const [id, g] of Object.entries(pantry)) {
    if (!need.has(id) && g > 0 && idx.get(id) && !idx.get(id).staple) leftovers[id] = Math.round(g);
  }

  items.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return { items, staples, total, leftovers, wasteEuro, stockEuro, effective: total - stockEuro };
}

/** Menge menschenlesbar, z. B. "2 × 500 g" oder "3 Paprika" */
export function packText(item) {
  if (item.piece && item.pack === item.piece) {
    return `${item.packs} ${item.pieceName || 'Stück'}`;
  }
  return `${item.packs} × ${item.packLabel}`;
}

export function amountText(ing, g) {
  if (ing.piece && ing.piece <= 130 && g >= ing.piece * 0.6 && !ing.staple) {
    const n = Math.round((g / ing.piece) * 2) / 2;
    return `${n.toLocaleString('de-DE')} ${ing.pieceName || 'Stück'} (${Math.round(g)} g)`;
  }
  if (ing.piece && ing.piece > 130 && g >= ing.piece * 0.9) {
    const n = Math.round((g / ing.piece) * 4) / 4;
    return `${Math.round(g)} g (≈ ${n.toLocaleString('de-DE')} ${ing.pieceName || 'Stück'})`;
  }
  return `${g < 10 ? (Math.round(g * 2) / 2).toLocaleString('de-DE') : Math.round(g)} g`;
}
