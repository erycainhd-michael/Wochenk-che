// Preise & Angebote. Fällt immer still auf Richtpreise zurück.

export const STORES = {
  lidl: { id: 'lidl', name: 'Lidl' },
  edeka: { id: 'edeka', name: 'Edeka No1 Center Schloßstraße' },
};

export function regularPrice(ing, store) {
  if (store === 'edeka') return ing.priceEdeka ?? Math.round(ing.price * 1.15 * 100) / 100;
  return ing.price;
}

function offerValidFor(o, weekStart) {
  if (!weekStart) return true;
  const weekEnd = addDaysIso(weekStart, 6);
  if (o.validTo && o.validTo < weekStart) return false;
  if (o.validFrom && o.validFrom > weekEnd) return false;
  return true;
}

function addDaysIso(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Verbindet Angebote aus offers.json (Action) mit manuell erfassten Angeboten. */
export function mergeOffers(remote, manual) {
  const list = [];
  for (const o of remote?.offers || []) if (o.ingredientId && o.packPrice > 0) list.push({ ...o, source: 'auto' });
  for (const o of manual || []) if (o.ingredientId && o.packPrice > 0) list.push({ ...o, source: 'manuell' });
  return list;
}

/**
 * Erzeugt eine Funktion ingId -> { store, price, regular, offer, offerTitle }.
 * Einkauf standardmäßig im Hauptladen; Wechsel nur, wenn ein Angebot im anderen Laden ≥ 10 % spart.
 */
export function makePriceFn({ idx, settings, offers = [], weekStart }) {
  const subscribed = ['lidl', 'edeka'].filter((s) => settings.stores?.[s]);
  const stores = subscribed.length ? subscribed : ['lidl'];
  const mainStore = stores.includes(settings.mainStore) ? settings.mainStore : stores[0];
  const valid = offers.filter((o) => offerValidFor(o, weekStart) && stores.includes(o.store));
  const cache = new Map();
  return function priceOf(id) {
    if (cache.has(id)) return cache.get(id);
    const ing = idx.get(id);
    let best = null;
    for (const store of stores) {
      const regular = regularPrice(ing, store);
      const offer = valid
        .filter((o) => o.store === store && o.ingredientId === id)
        .sort((a, b) => a.packPrice - b.packPrice)[0];
      const price = offer && offer.packPrice < regular ? offer.packPrice : regular;
      const cand = { store, price, regular, offer: !!(offer && offer.packPrice < regular), offerTitle: offer?.title || '' };
      if (!best) best = cand;
      else {
        const mainCand = best.store === mainStore ? best : cand;
        const other = best.store === mainStore ? cand : best;
        best = other.price <= mainCand.price * 0.9 ? other : mainCand;
      }
    }
    if (!subscribed.length) best = { ...best, store: 'lidl', offer: false };
    cache.set(id, best);
    return best;
  };
}

/** Kosten einer Zutatenliste anteilig (g / Packung × Packungspreis) */
export function itemsCost(items, idx, priceOf) {
  let cost = 0;
  let offerCost = 0;
  for (const { id, g } of items) {
    const ing = idx.get(id);
    if (!ing || ing.staple) continue;
    const pr = priceOf(id);
    const c = (g / ing.pack) * pr.price;
    cost += c;
    if (pr.offer) offerCost += c;
  }
  return { cost, offerShare: cost ? offerCost / cost : 0 };
}

// --- Abgleich Angebotstitel -> Zutat (wird auch von der GitHub Action genutzt) ---

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function matchIngredient(title, ingredients) {
  const t = ' ' + norm(title) + ' ';
  let best = null;
  let bestLen = 0;
  for (const ing of ingredients) {
    for (const kw of ing.kw || []) {
      const k = norm(kw);
      if (k && t.includes(' ' + k) && k.length > bestLen) {
        best = ing;
        bestLen = k.length;
      }
    }
  }
  return best;
}

/** Liest "500 g", "1 kg", "400-g-Packung", "1 l" … und liefert Gramm (Liter ≈ kg). */
export function parseGrams(text) {
  const s = String(text || '').toLowerCase().replace(',', '.');
  const multi = s.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*-?\s*(kg|g|ml|l)\b/);
  if (multi) return Number(multi[1]) * toGrams(Number(multi[2]), multi[3]);
  const m = s.match(/(\d+(?:\.\d+)?)\s*-?\s*(kg|g|ml|l)\b/);
  return m ? toGrams(Number(m[1]), m[2]) : null;
}
const toGrams = (v, u) => (u === 'kg' || u === 'l' ? v * 1000 : v);
