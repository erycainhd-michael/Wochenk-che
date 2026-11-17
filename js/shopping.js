// Einkaufsliste: Bedarf aus dem Plan minus Vorrat, auf ganze Packungen gerundet.
// Wahlweise zwei Einkäufe pro Woche (Montag + Donnerstag): Zutaten, die erst ab Donnerstag gebraucht werden, und
// Frisches (Salat, Kräuter, Fisch, Fleisch …) für Donnerstag bis Sonntag kommen auf den zweiten Einkauf.

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

// Gewürze: In den Rezepten steht nur „Gewürze“ mit einer Notiz („Salz, Pfeffer, Paprika edelsüß“). Für die
// Einkaufsliste werden daraus die einzelnen Gewürze – vereinheitlicht und ohne Mengen- oder Hinweistexte.
const SPICE_ALIAS = [
  [/^(paprika|paprikapulver|paprikagewürz)( edelsüß)?$/, 'Paprikapulver edelsüß'],
  [/^(paprika rosenscharf|paprikagewürz scharf|paprika scharf)$/, 'Paprikapulver scharf'],
  [/^(curry|currypulver)$/, 'Currypulver'],
  [/^(chili|chilipulver|chiliflocken|milde chili)$/, 'Chili'],
  [/^(pfeffer|pfeffer geschrotet|pfefferkörner)$/, 'Pfeffer'],
  [/^(lorbeer|lorbeerblatt|lorbeerblätter)$/, 'Lorbeerblätter'],
  [/^(zimt|zimtstange)$/, 'Zimt'],
  [/^gyros-?$/, 'Gyrosgewürz'],
  [/^fondor$/, 'Fondor'],
  [/^(italienische kräuter|kräuter der provence)$/, null], // bleibt wie geschrieben
];
const SPICE_SKIP = /essig|wasser|süßstoff/i;
export function spiceNames(note) {
  const out = [];
  const clean = String(note || '')
    .replace(/\([^)]*\)?/g, ' ') // Klammern („gemahlen“, „oder Zimt“)
    .replace(/fondue-gewürz für alle:.*?fondor.*/i, 'Fondor')
    .replace(/\bdazu\b/gi, ',');
  for (let part of clean.split(/,|;|\/|&|\+|\bund\b/)) {
    if (SPICE_SKIP.test(part)) continue;
    part = part
      .replace(/\b(je|ca\.?|evtl\.?|etwas|viel|knapp|frisch(er|e|es)?|getrocknet(e|er)?|gemahlen(er|e)?)\b/gi, ' ')
      .replace(/[\d½¼¾]+(\s*[–-]\s*\d+)?\s*(prise|tl|el|g|döschen)?\b/gi, ' ')
      .replace(/\bprise\b/gi, ' ')
      .replace(/\b(für alle|nach geschmack|für die .*|fürs .*)$/i, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!part || part.length < 3) continue;
    const low = part.toLowerCase();
    const hit = SPICE_ALIAS.find(([re]) => re.test(low));
    const name = hit?.[1] || part.charAt(0).toUpperCase() + part.slice(1);
    if (!out.includes(name)) out.push(name);
  }
  return out;
}
const SPICE_ORDER = ['Salz', 'Pfeffer'];

export function buildShopping({ plan, idx, pantry = {}, priceOf, recipesById, twice = false }) {
  const need = new Map();
  const spices = new Map(); // Gewürzname → Gerichte
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
        if (it.id === 'gewuerze') {
          const note = recipesById?.get(rid)?.ingredients.find((l) => l.id === 'gewuerze')?.note;
          for (const n of spiceNames(note)) {
            const sp = spices.get(n) || new Map();
            sp.set(rid, rname);
            spices.set(n, sp);
          }
        }
      }
    }
  }

  // Vorrat anlegen (z. B. Frosta im Angebot): wird diese Woche gekauft, aber erst später gegessen
  for (const [id, g] of Object.entries(plan.structure?.stock || {})) {
    if (!g || !idx.get(id)) continue;
    const e = need.get(id) || { g: 0, g2: 0, uses: new Set(), useIds: new Map(), useIds1: new Map(), useIds2: new Map() };
    e.g += g;
    const rid = [...(recipesById?.values() || [])].find((r) => (r.tags || []).includes('fertiggericht') && r.ingredients[0]?.id === id)?.id || id;
    e.uses.add('den Vorrat (Angebot)');
    e.useIds.set(rid + '#vorrat', 'den Vorrat (Angebot)');
    e.useIds1.set(rid + '#vorrat', 'den Vorrat (Angebot)');
    e.stock = (e.stock || 0) + g;
    need.set(id, e);
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
      // statt „Gewürze“: jedes Gewürz einzeln mit den Gerichten, die es brauchen
      if (id === 'gewuerze' && spices.size) {
        const order = (n) => (SPICE_ORDER.includes(n) ? SPICE_ORDER.indexOf(n) : 9);
        for (const [n, refs] of [...spices].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0], 'de'))) {
          staples.push({ id: 'gewuerz:' + n, name: n, spice: true, uses: [...refs.values()], useRefs: [...refs].map(([rid, name]) => ({ id: rid, name })) });
        }
        continue;
      }
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
    // Zwei Einkäufe: Was erst ab Donnerstag gebraucht wird, kommt auf den zweiten Einkauf. Wird eine Zutat in beiden
    // Wochenhälften gebraucht, kauft man Haltbares (z. B. Kartoffeln) gleich am Montag – nur Frisches wird geteilt.
    const g1 = e.g - e.g2;
    const onlyLater = twice && e.g2 > 0 && g1 <= 0;
    const split = twice && !onlyLater && ing.shelf <= FRESH_SHELF && e.g2 > 0;
    const rows = [];
    if (onlyLater) rows.push(row(e.g, have, 2, [...e.useIds2].map(([rid, name]) => ({ id: rid, name }))));
    else if (split) {
      const refs2 = [...e.useIds2].map(([rid, name]) => ({ id: rid, name }));
      const refs1 = [...e.useIds1].map(([rid, name]) => ({ id: rid, name }));
      const r1 = row(g1, have, 1, refs1);
      const left1 = Math.max(0, have + r1.packs * ing.pack - g1);
      if (g1 > 0 && r1.packs > 0) rows.push(r1);
      rows.push(row(e.g2, left1, 2, refs2));
    } else rows.push(row(e.g, have, 1, useRefs));
    const bought = rows.reduce((a, r) => a + r.packs * ing.pack, 0);
    // Vorratskäufe werden diese Woche nicht gegessen – sie bleiben als Rest für die nächsten Wochen
    const left = Math.max(0, have + bought - (e.g - (e.stock || 0)));
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
