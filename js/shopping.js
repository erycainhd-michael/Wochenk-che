// Einkaufsliste: Bedarf aus dem Plan minus Vorrat, auf ganze Packungen gerundet.
// Wahlweise zwei Einkäufe pro Woche: Frisches (Salat, Kräuter, Fisch, Fleisch …) für Donnerstag bis Sonntag
// wird erst beim zweiten Einkauf am Donnerstag gekauft.

/** Tag des zweiten Einkaufs (0 = Montag) und ab wann eine Zutat als „frisch“ gilt (Haltbarkeit in Tagen) */
export const SECOND_TRIP_DAY = 3;
export const FRESH_SHELF = 6;

/**
 * @param plan       fertiger Wochenplan (days[].meals[].items)
 * @param idx        Zutaten-Index
 * @param pantry     { ingId: Gramm } – Reste der Vorwoche
 * @param priceOf    Preisfunktion aus prices.js
 * @param recipesById Map für Gerichtsnamen
 */
export function buildShopping({ plan, idx, pantry = {}, priceOf, recipesById, twice = false }) {
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
        const e = need.get(it.id) || { g: 0, g2: 0, uses: new Set(), useIds: new Map(), useIds1: new Map(), useIds2: new Map() };
        e.g += it.g * people;
        e.uses.add(rname);
        e.useIds.set(rid, rname);
        // Bedarf ab Donnerstag getrennt merken (für den zweiten Einkauf)
        if (day.day >= SECOND_TRIP_DAY) {
          e.g2 += it.g * people;
          e.useIds2.set(rid, rname);
        } else e.useIds1.set(rid, rname);
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
    const pr = priceOf(id);
    const row = (g, have, trip, refs) => {
      const toBuy = g - have;
      // 5 % Toleranz: lieber minimal kleinere Portion als eine ganze Extra-Packung
      const packs = toBuy <= 0 ? 0 : Math.max(1, Math.ceil((toBuy - 0.05 * ing.pack) / ing.pack));
      return {
        id,
        key: trip === 2 ? `${id}@2` : id,
        trip,
        name: ing.name,
        cat: ing.cat,
        store: pr.store,
        need: Math.round(g),
        have: Math.round(Math.min(have, g)),
        packs,
        pack: ing.pack,
        packLabel: ing.packLabel || `${ing.pack} g`,
        piece: ing.piece,
        pieceName: ing.pieceName,
        price: pr.price,
        regular: pr.regular,
        offer: pr.offer && packs > 0,
        offerTitle: pr.offerTitle,
        cost: packs * pr.price,
        uses,
        useRefs: refs,
        note: ing.note,
        elsewhere: !!pr.elsewhere,
      };
    };
    const have = Math.max(0, pantry[id] || 0);
    // Zwei Einkäufe nur für Frisches, das (auch) ab Donnerstag gebraucht wird
    const split = twice && ing.shelf <= FRESH_SHELF && e.g2 > 0;
    const rows = [];
    if (split) {
      const g1 = e.g - e.g2;
      const refs2 = [...e.useIds2].map(([rid, name]) => ({ id: rid, name }));
      const refs1 = [...e.useIds1].map(([rid, name]) => ({ id: rid, name }));
      const r1 = row(g1, have, 1, refs1);
      const left1 = Math.max(0, have + r1.packs * ing.pack - g1);
      if (g1 > 0 && r1.packs > 0) rows.push(r1);
      rows.push(row(e.g2, left1, 2, refs2));
    } else rows.push(row(e.g, have, 1, useRefs));
    const bought = rows.reduce((a, r) => a + r.packs * ing.pack, 0);
    const left = Math.max(0, have + bought - e.g);
    if (left >= 1) leftovers[id] = Math.round(left);
    if (left > 0 && ing.shelf <= 10) wasteEuro += (left / ing.pack) * pr.price;
    else if (left > 0) stockEuro += (Math.min(left, bought) / ing.pack) * pr.price;
    for (const r of rows) {
      total += r.cost;
      r.leftover = r === rows[rows.length - 1] ? Math.round(left) : 0;
      items.push(r);
    }
  }

  // Vorrat, der diese Woche nicht gebraucht wird, bleibt erhalten
  for (const [id, g] of Object.entries(pantry)) {
    if (!need.has(id) && g > 0 && idx.get(id) && !idx.get(id).staple) leftovers[id] = Math.round(g);
  }

  items.sort((a, b) => a.trip - b.trip || a.name.localeCompare(b.name, 'de'));
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
