// Nährwerte für eigene Zutaten finden, ohne sie abzutippen:
//  • Suche in Open Food Facts (freie, weltweite Produktdatenbank, über 3 Mio. Produkte)
//  • Barcode scannen (Kamera) → Produkt in Open Food Facts nachschlagen
// Grundlebensmittel wie Gurke oder Kohl kommen aus data/foods.json (ohne Internet).

const OFF = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_de,generic_name_de,brands,nutriments,product_quantity,product_quantity_unit,quantity,categories_tags';

async function getJSON(url, ms = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Fehler ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// Kategorie der Einkaufsliste aus den Open-Food-Facts-Kategorien ableiten
const CAT_MAP = [
  [/frozen/, 'Tiefkühl'],
  [/meats|poultr|fishes|seafood|sausages/, 'Fleisch & Fisch'],
  [/dairies|cheeses|yogurts|milks|eggs|tofu/, 'Kühlregal'],
  [/fruits|vegetables/, 'Obst & Gemüse'],
  [/breads|bakery/, 'Brot & Backwaren'],
  [/pastas|rices|cereals|grains|legumes|flours/, 'Nudeln, Reis & Getreide'],
  [/nuts|seeds|dried-fruits/, 'Nüsse & Samen'],
  [/canned|sauces|spreads|jams/, 'Konserven & Gläser'],
  [/sweets|chocolates|biscuits|snacks|sugars|baking/, 'Süßes & Backen'],
  [/oils|condiments|spices|vinegars/, 'Vorrat: Öle & Gewürze'],
];
// grobe Richtpreise pro kg, wenn nichts bekannt ist (lässt sich in der App ändern)
const EURO_PER_KG = { 'Obst & Gemüse': 3, 'Kühlregal': 5, 'Fleisch & Fisch': 12, 'Tiefkühl': 4.5, 'Brot & Backwaren': 3.5, 'Nudeln, Reis & Getreide': 2.5, 'Nüsse & Samen': 12, 'Konserven & Gläser': 4, 'Süßes & Backen': 8, 'Vorrat: Öle & Gewürze': 6, 'Eigene Zutaten': 6 };

const n1 = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : null);

/** Open-Food-Facts-Produkt → unser Zutaten-Format (pro 100 g) oder null, wenn Nährwerte fehlen */
export function fromOFF(p) {
  if (!p) return null;
  const nu = p.nutriments || {};
  let kcal = n1(nu['energy-kcal_100g']);
  if (kcal == null && nu.energy_100g != null) kcal = n1(nu.energy_100g / 4.184);
  const c = n1(nu.carbohydrates_100g);
  const pr = n1(nu.proteins_100g);
  const f = n1(nu.fat_100g);
  if (kcal == null || pr == null || c == null || f == null) return null;
  const tags = (p.categories_tags || []).join(' ');
  const cat = CAT_MAP.find(([re]) => re.test(tags))?.[1] || 'Eigene Zutaten';
  let pack = Number(p.product_quantity) || 0;
  if (!pack) {
    const m = String(p.quantity || '').replace(',', '.').match(/([\d.]+)\s*(kg|g|ml|l)\b/i);
    if (m) pack = Number(m[1]) * (/^k|^l$/i.test(m[2]) ? 1000 : 1);
  }
  pack = Math.round(pack) || 250;
  const brand = String(Array.isArray(p.brands) ? p.brands[0] || '' : p.brands || '').split(',')[0].trim();
  const name = String(p.product_name_de || p.product_name || p.generic_name_de || '').trim();
  return {
    code: p.code,
    name: name || 'Produkt ' + (p.code || ''),
    brand,
    kcal,
    c,
    p: pr,
    f,
    fib: n1(nu.fiber_100g) ?? 0,
    pack,
    price: Math.max(0.49, Math.round((pack / 1000) * (EURO_PER_KG[cat] || 6) * 10) / 10 - 0.01),
    priceEst: true,
    cat,
    shelf: cat === 'Obst & Gemüse' || cat === 'Fleisch & Fisch' ? 5 : cat === 'Kühlregal' ? 14 : 180,
    source: 'Open Food Facts',
  };
}

/** Freitextsuche, z. B. „Skyr“ oder „Kidneybohnen“ – liefert Produkte mit vollständigen Nährwerten */
export async function searchProducts(q) {
  const term = encodeURIComponent(q.trim());
  let list = [];
  try {
    const d = await getJSON(`${OFF}/cgi/search.pl?search_terms=${term}&search_simple=1&action=process&json=1&page_size=24&lc=de&cc=de&sort_by=unique_scans_n&fields=${FIELDS}`);
    list = d.products || [];
  } catch (err) {
    // Ausweichen auf die neue Suche
    const d = await getJSON(`https://search.openfoodfacts.org/search?q=${term}&langs=de&page_size=24&fields=${FIELDS}`).catch(() => {
      throw err;
    });
    list = d.hits || [];
  }
  const seen = new Set();
  return list
    .map(fromOFF)
    .filter((x) => x && !seen.has(x.name + x.brand) && seen.add(x.name + x.brand))
    .slice(0, 12);
}

/** Produkt zum Barcode (EAN) */
export async function lookupBarcode(code) {
  const d = await getJSON(`${OFF}/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`);
  if (d.status === 0 || !d.product) return null;
  return fromOFF({ ...d.product, code });
}

// --- Barcode-Scanner -----------------------------------------------------------

let zxingLoad = null;
function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  zxingLoad ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'js/vendor/zxing.min.js';
    s.onload = () => resolve(window.ZXing);
    s.onerror = () => {
      zxingLoad = null;
      reject(new Error('Scanner konnte nicht geladen werden'));
    };
    document.head.appendChild(s);
  });
  return zxingLoad;
}

/**
 * Öffnet die Kamera als Vollbild und liefert den ersten erkannten Barcode (EAN/UPC).
 * null = abgebrochen. Nutzt die eingebaute Erkennung des Browsers, sonst ZXing (iPhone).
 */
export function scanBarcode() {
  return new Promise((resolve, reject) => {
    const ov = document.createElement('div');
    ov.className = 'scanner';
    ov.innerHTML = `<video playsinline muted autoplay></video><div class="scan-frame"><i></i></div>
      <p class="scan-hint">Barcode in den Rahmen halten</p><button class="btn pill scan-close">Abbrechen</button>`;
    document.body.appendChild(ov);
    const video = ov.querySelector('video');
    let stream = null;
    let stop = false;
    let reader = null;
    const finish = (code, err) => {
      if (stop) return;
      stop = true;
      try {
        reader?.reset?.();
      } catch {
        /* egal */
      }
      stream?.getTracks().forEach((t) => t.stop());
      ov.classList.add('out');
      setTimeout(() => ov.remove(), 250);
      if (err) reject(err);
      else resolve(code);
    };
    ov.querySelector('.scan-close').addEventListener('click', () => finish(null));
    const constraints = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
    (async () => {
      try {
        if ('BarcodeDetector' in window) {
          const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          video.srcObject = stream;
          await video.play();
          const tick = async () => {
            if (stop) return;
            try {
              const codes = await det.detect(video);
              if (codes[0]?.rawValue) return finish(codes[0].rawValue);
            } catch {
              /* nächster Versuch */
            }
            setTimeout(tick, 120);
          };
          tick();
          return;
        }
        const ZX = await loadZXing();
        const hints = new Map();
        hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8, ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E]);
        reader = new ZX.BrowserMultiFormatReader(hints, 150);
        await reader.decodeFromConstraints(constraints, video, (res) => {
          if (res && !stop) finish(res.getText());
        });
        stream = video.srcObject;
      } catch (err) {
        const msg = err?.name === 'NotAllowedError' ? 'Kein Kamerazugriff – bitte in den iPhone-Einstellungen erlauben.' : err?.message || 'Kamera nicht verfügbar';
        finish(null, new Error(msg));
      }
    })();
  });
}
