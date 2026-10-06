// Holt aktuelle Angebote und schreibt data/offers.json.
// Läuft in der GitHub Action (montags früh) – oder lokal: node scripts/fetch-offers.mjs
//
// Ehrliche Einordnung: Weder Lidl noch Edeka bieten eine offizielle, öffentliche Angebots-API.
//  - Edeka: Die Marktseiten auf edeka.de laden Angebote aus einem JSON-Endpunkt pro Markt.
//    Der ist inoffiziell und kann sich jederzeit ändern. Wir rufen ihn 1× pro Woche auf.
//  - Lidl: Kein stabiler, maschinenlesbarer Endpunkt bekannt (Prospekt ist ein Blätterkatalog).
//    Deshalb hier keine Automatik – Lidl-Angebote bei Bedarf in der App manuell eintragen.
// Bei jedem Fehler bleibt die App funktionsfähig: Sie nutzt dann Richtpreise.
//
// Umgebungsvariablen:
//   EDEKA_MARKET_ID  – Markt-ID des Edeka-Markts (siehe README: „Markt-ID finden“)
//   FIND_MARKET      – z. B. "12163" oder "Schloßstraße": listet passende Märkte und beendet
//   FORCE=1          – Zeitprüfung überspringen (manueller Start)
//   CRON_SCHEDULE    – vom Workflow übergeben, für die Sommer-/Winterzeit-Prüfung

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchIngredient, parseGrams } from '../js/prices.js';
import { shouldRunNow } from './berlin-time.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (privater Wochenplaner; 1 Abruf pro Woche)';

async function getJSON(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const first = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');
const toNum = (v) => {
  if (typeof v === 'number') return v;
  const m = String(v ?? '').replace(',', '.').match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : NaN;
};
const toDate = (v) => {
  if (!v) return null;
  const d = typeof v === 'number' ? new Date(v > 1e12 ? v : v * 1000) : new Date(v);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
};

/** Wandelt beliebige Angebotsobjekte defensiv in { title, price, unitText, validFrom, validTo } um. */
export function normalizeEdeka(json) {
  const list = first(json?.offers, json?.docs, json?.items, json?.data?.offers, Array.isArray(json) ? json : null) || [];
  return list
    .map((o) => ({
      // Edeka liefert u. a. { titel, preis, beschreibung, basicPrice, gueltig_bis } (Stand 10/2026)
      title: String(first(o.titel, o.title, o.name, o.headline, o.productName, '')).trim(),
      description: String(first(o.beschreibung, o.subtitle, o.descriptiion, o.description, '')),
      price: toNum(first(o.preis, o.price?.rawValue, o.price?.value, o.price?.amount, o.price, o.priceValue)),
      regular: toNum(first(o.price?.oldPrice, o.oldPrice, o.regularPrice, o.strikePrice)),
      unitText: [first(o.unit, o.price?.unit, ''), first(o.beschreibung, o.descriptiion, o.description, o.subtitle, ''), first(o.basicPrice, '')].filter(Boolean).join(', '),
      validFrom: toDate(first(o.gueltig_von, o.validFrom, o.from, o.startDate, json?.gueltig_von, json?.validFrom)),
      validTo: toDate(first(o.gueltig_bis, o.validTill, o.validTo, o.to, o.endDate, json?.gueltig_bis, json?.validTill)),
    }))
    .filter((o) => o.title && o.price > 0);
}

/** Ordnet Angebote den Zutaten zu und rechnet den Preis auf die Packungsgröße der Zutaten-DB um. */
export function mapOffers(raw, store, ingredients) {
  const out = [];
  for (const o of raw) {
    // Erst nur der Titel (z. B. „Hähnchenbrustfilet“); die Beschreibung hilft nur bei der Menge
    const ing = matchIngredient(o.title, ingredients);
    let packPrice = null;
    if (ing) {
      const grams = parseGrams(o.unitText) || parseGrams(o.title);
      if (grams && grams > 0 && Math.abs(grams - ing.pack) / ing.pack > 0.1) packPrice = Math.round((o.price / grams) * ing.pack * 100) / 100;
      else packPrice = o.price;
      // Plausibilitätsprüfung: offensichtliche Fehlzuordnungen verwerfen
      if (packPrice > ing.price * 2.5 || packPrice < ing.price * 0.25) packPrice = null;
    }
    out.push({ store, title: o.title, price: o.price, unit: o.unitText, validFrom: o.validFrom, validTo: o.validTo, ingredientId: packPrice ? ing.id : null, packPrice });
  }
  return out;
}

async function fetchEdeka(marketId) {
  const urls = [
    `https://www.edeka.de/api/offers?limit=999&marketId=${encodeURIComponent(marketId)}`,
    `https://www.edeka.de/eh/service/eh/offers?marketId=${encodeURIComponent(marketId)}&limit=999&rows=999&size=999`,
    `https://www.edeka.de/eh/service/eh/offers?marketId=${encodeURIComponent(marketId)}`,
  ];
  let lastErr;
  for (const u of urls) {
    try {
      const json = await getJSON(u);
      const raw = normalizeEdeka(json);
      console.log(`${u.split('?')[0]}: ${raw.length} Angebote${json?.anzahl ? ` (laut Edeka insgesamt ${json.anzahl})` : ''}`);
      if (raw.length) return raw;
      // Diagnose: Struktur der Antwort ausgeben (öffentliche Angebotsdaten)
      console.log('Antwort von', u.split('?')[0], '– Schlüssel:', Object.keys(json || {}).join(', '));
      console.log(JSON.stringify(json).slice(0, 1500));
      lastErr = new Error('keine Angebote in der Antwort');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function findMarket(q) {
  const json = await getJSON(`https://www.edeka.de/api/marketsearch/markets?searchstring=${encodeURIComponent(q)}`);
  const markets = first(json?.markets, json?.docs, json) || [];
  for (const m of markets) console.log(`${first(m.id, m.marketId)}  ${first(m.name, m.title)}  ${first(m.contact?.address?.street, m.street, '')} ${first(m.contact?.address?.city?.zipCode, m.zip, '')}`);
  if (!markets.length) console.log('Keine Märkte gefunden.');
}

async function main() {
  if (process.env.FIND_MARKET) return findMarket(process.env.FIND_MARKET);
  if (!process.env.FORCE && !shouldRunNow(process.env.CRON_SCHEDULE)) {
    console.log('Nicht die richtige Berliner Uhrzeit für diesen Cron-Eintrag (Sommer-/Winterzeit) – übersprungen.');
    return;
  }
  const ingredients = JSON.parse(fs.readFileSync(path.join(root, 'data/ingredients.json'), 'utf8')).items;
  const file = path.join(root, 'data/offers.json');
  const result = { updated: new Date().toISOString(), sources: {}, offers: [] };

  const marketId = process.env.EDEKA_MARKET_ID;
  if (!marketId) {
    result.sources.edeka = { ok: false, message: 'keine Markt-ID hinterlegt' };
  } else {
    try {
      const mapped = mapOffers(await fetchEdeka(marketId), 'edeka', ingredients);
      result.offers.push(...mapped);
      result.sources.edeka = { ok: true, count: mapped.length, matched: mapped.filter((o) => o.ingredientId).length };
      for (const o of mapped.filter((x) => x.ingredientId)) console.log(`Angebot: ${o.title} → ${o.ingredientId} (${o.price} €, umgerechnet ${o.packPrice} €)`);
    } catch (e) {
      result.sources.edeka = { ok: false, message: `nicht erreichbar (${e.message})` };
    }
  }
  result.sources.lidl = { ok: false, message: 'keine automatische Quelle – bitte manuell eintragen' };

  // Nie eine funktionierende Datei durch eine leere ersetzen: Bei komplettem Fehlschlag alte Angebote behalten,
  // sofern sie noch gültig sind.
  if (!result.offers.length && fs.existsSync(file)) {
    try {
      const old = JSON.parse(fs.readFileSync(file, 'utf8'));
      const today = new Date().toISOString().slice(0, 10);
      result.offers = (old.offers || []).filter((o) => !o.validTo || o.validTo >= today);
    } catch {
      /* ignorieren */
    }
  }
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
  console.log('offers.json geschrieben:', JSON.stringify(result.sources));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    // Niemals mit Fehler abbrechen – die App kommt auch ohne Angebote aus.
    console.error('Angebote konnten nicht geladen werden:', e.message);
  });
}
