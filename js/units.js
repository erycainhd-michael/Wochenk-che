// Küchenmengen statt nackter Gramm: „2× Ei“, „3 Zehen Knoblauch“, „1 EL Olivenöl“, „160 ml Milch“.
// Grundlage bleiben Gramm (Planer, Einkauf, Nährwerte) – umgerechnet wird nur für die Anzeige.

// Stückweise Zutaten: Gewicht eines Stücks, Einheit (× = einfach zählen) und Mehrzahl
const PIECES = {
  eier: [60, '×'],
  zitrone: [120, '×'],
  limette: [60, '×'],
  apfel: [180, '×'],
  banane: [120, '×'],
  avocado: [140, '×'],
  paprika: [160, '×'],
  zucchini: [300, '×'],
  gurke: [400, '×'],
  aubergine: [300, '×'],
  suesskartoffel: [400, '×'],
  hokkaido: [1000, '×'],
  honigmelone: [1500, '×'],
  zwiebeln: [100, '×'],
  rote_zwiebel: [80, '×'],
  moehren: [80, '×'],
  tomaten: [90, '×'],
  mandarinen: [70, '×'],
  wraps: [62, '×'],
  cordon_bleu: [90, '×'],
  fischstaebchen: [30, '×'],
  trockenpflaumen: [8, '×'],
  loeffelbiskuits: [6.5, '×'],
  knoblauch: [4, 'Zehe', 'Zehen'],
  fruehlingszwiebeln: [15, 'Stange', 'Stangen'],
  porree: [300, 'Stange', 'Stangen'],
  mozzarella: [125, 'Kugel', 'Kugeln'],
  burrata: [125, 'Kugel', 'Kugeln'],
  vk_brot: [40, 'Scheibe', 'Scheiben'],
  vk_toast: [28, 'Scheibe', 'Scheiben'],
  bacon: [15, 'Scheibe', 'Scheiben'],
  rohschinken: [15, 'Scheibe', 'Scheiben'],
  kochschinken: [25, 'Scheibe', 'Scheiben'],
  blaetterteig: [275, 'Rolle', 'Rollen'],
  flammkuchenteig: [260, 'Rolle', 'Rollen'],
  zwiebelsuppe_pulver: [50, 'Päckchen', 'Päckchen'],
};
// Löffelmengen: Gramm pro EL / TL; max = bis wie viele EL noch in Löffeln angezeigt wird
const SPOONS = {
  olivenoel: [13, 4.5],
  rapsoel: [13, 4.5],
  ghee: [13, 4.5],
  honig: [20, 7],
  zucker: [12, 4],
  backpulver: [10, 4],
  senf: [15, 5],
  tomatenmark: [15, 5],
  sojasauce: [15, 5],
  balsamico: [15, 5],
  erdnussmus: [15, 5],
  pesto: [15, 5],
  curry_paste: [15, 5],
  gemuesebruehe: [15, 5],
  kakao: [8, 3],
  leinsamen: [10, 3.5],
  flohsamenschalen: [10, 3.5],
  sesam: [8, 3],
  kraeuter_tk: [4, 1.5],
  pinienkerne: [9, 3],
  kapern: [10, 4],
  mehl: [10, 3],
  amaretto: [15, 5],
  creme_fraiche: [15, 5],
};
// Flüssiges in ml (1 g ≈ 1 ml)
const LIQUID = new Set(['milch', 'kochsahne', 'sahne', 'weisswein', 'rotwein', 'espresso', 'kokosmilch', 'amaretto', 'sojasauce']);

const FRAC = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
/** 1,5 → „1½“, 0,25 → „¼“ */
export function fracText(n) {
  const whole = Math.floor(n + 1e-9);
  const rest = Math.round((n - whole) * 4) / 4;
  if (rest === 1) return String(whole + 1);
  return (whole ? String(whole) : '') + (FRAC[rest] || (whole ? '' : '0'));
}
const roundTo = (x, step) => Math.round(x / step) * step;
const gramsText = (g) => `${g < 10 ? (Math.round(g * 2) / 2).toLocaleString('de-DE') : Math.round(g)}g`;

/**
 * Menge in Küchensprache. Ergebnis: { n, unit } – unit ist „×“, „Zehen“, „EL“, „TL“, „Prise“, „ml“, „g“ oder „etwas“.
 * `note` kann z. B. „nur das Eigelb“ enthalten.
 */
export function kitchenAmount(id, g, note = '') {
  if (id === 'gewuerze') return { n: '', unit: 'etwas' };
  if (id === 'eier' && /eigelb/i.test(note)) {
    const n = Math.max(1, Math.round(g / 18));
    return { n: String(n), unit: '×' };
  }
  const p = PIECES[id];
  if (p) {
    const [w, one, many = one] = p;
    // große Stücke (Melone, Blätterteig-Rolle …) in Vierteln, Knoblauchzehen ganz, sonst in Halben
    const step = w >= 250 ? 0.25 : id === 'knoblauch' ? 1 : 0.5;
    const n = roundTo(g / w, step);
    if (n >= step) return { n: fracText(n), unit: n > 1 ? many : one };
  }
  const sp = SPOONS[id];
  if (sp) {
    const [el, tl] = sp;
    const nEl = roundTo(g / el, 0.5);
    if (nEl >= 1 && nEl <= 8) return { n: fracText(nEl), unit: 'EL' };
    if (nEl < 1) {
      const nTl = roundTo(g / tl, 0.5);
      if (nTl >= 0.5) return { n: fracText(Math.min(nTl, 2.5)), unit: 'TL' };
      return { n: '1', unit: 'Prise' };
    }
  }
  if (LIQUID.has(id)) return { n: String(g < 50 ? Math.round(g / 5) * 5 || Math.round(g) : Math.round(g / 10) * 10), unit: 'ml' };
  return { n: gramsText(g).slice(0, -1), unit: 'g' };
}

/** Kurzform, z. B. „2×“, „3 Zehen“, „1 EL“, „160 ml“, „110g“, „etwas“ */
export function kitchenText(id, g, note) {
  const { n, unit } = kitchenAmount(id, g, note);
  if (unit === 'etwas') return 'etwas';
  if (unit === '×') return `${n}×`;
  if (unit === 'g') return `${n}g`;
  return `${n} ${unit}`;
}
