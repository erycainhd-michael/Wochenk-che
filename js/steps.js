// Welche Zutat wird in einem Zubereitungsschritt erwähnt? Grundlage für die Mengen im Schritt-Text
// („Jedes Medaillon mit 6 Scheiben Schinken umwickeln“) und die Zutatenliste im Kochmodus.

const norm = (w) =>
  w
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const WORD = /[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ-]*/g;
// in Namen und Hinweisen zählen Wortteile einzeln („Hokkaido-Kürbis“ → „hokkaido“, „kuerbis“)
const PART = /[A-Za-zÀ-ÖØ-öø-ÿ]+/g;

// Wörter aus Namen, Suchwörtern und Hinweisen, die nichts über die Zutat sagen („Champignons in Scheiben“, „Mais (Dose)“) –
// sonst landet z. B. „1 Glas“ Champignons vor „Scheibe Schinken“.
const GENERIC = new Set(
  [
    'scheibe', 'scheiben', 'glas', 'glaeser', 'dose', 'dosen', 'frisch', 'frische', 'frischer', 'frischen', 'abgetropft', 'gehackt', 'gehobelt', 'gerieben', 'gewuerfelt',
    'packung', 'stueck', 'braun', 'braune', 'weiss', 'gelb', 'gruen', 'bund', 'topf', 'beutel', 'natur', 'mild', 'light', 'fettarm', 'pulver', 'instant',
    'kochen', 'oder', 'ohne', 'haut', 'geschaelt', 'tiefkuehl', 'gross', 'grosse', 'grosser', 'klein', 'kleine', 'unbehandelt', 'stange', 'stangen', 'zehe', 'zehen',
    'becher', 'rolle', 'kugel', 'kugeln', 'flasche', 'tuete', 'platte', 'platten', 'wuerfel', 'blatt', 'blaetter', 'saft', 'schale', 'sorte', 'splitter',
    'trocken', 'getrocknet', 'getrocknete', 'roh', 'gegart', 'gekocht', 'verwendet', 'knolle', 'kopf', 'netz', 'stueckig', 'passiert', 'extra', 'nativ',
    'type', 'freiland', 'theke', 'kuehlregal', 'geschnitten', 'rispe', 'bio', 'alternativ', 'auch', 'glatt', 'glatte', 'beilage', 'dazu', 'form', 'alle',
    'nach', 'geschmack', 'evtl', 'gern', 'gerne', 'fuer', 'eine', 'einen', 'einer', 'zwei', 'drei', 'vier', 'halbe', 'halber', 'durchwachsener', 'nur', 'das',
    'den', 'dem', 'die', 'der', 'und', 'mit', 'zum', 'zur', 'ganze', 'ganzer', 'portion', 'portionen', 'person', 'personen', 'rest', 'teil', 'viel', 'wenig', 'kerne', 'wasser', 'sauce', 'sosse', 'streifen', 'ringe', 'ringen', 'feines', 'feiner', 'halbiert', 'geviertelt', 'fein', 'feine', 'gefroren', 'gefrorene', 'gefrorenen', 'gemahlen', 'gemahlene', 'geroestet', 'geroestete', 'geroesteten', 'abgerieben', 'abgeriebene',
    'fluessig', 'fluessigen', 'fluessiger', 'aus', 'von', 'ein', 'bei', 'auf', 'lage', 'knapp', 'scharf', 'schuss', 'prise', 'etwas',
  ].map(norm)
);

// Wie Zutaten in Rezepttexten sonst noch heißen
const SYNONYMS = {
  champignons: ['pilze'],
  champignons_glas: ['pilze'],
  rinderfond: ['fond'],
  eier: ['eigelb', 'eigelbe', 'eiweiss', 'eiweisse', 'eiern'],
  minze: ['minzblaetter', 'minzblatt'],
  zwiebelsuppe_pulver: ['zwiebelsuppen'],
  gouda: ['kaese'],
  parmesan: ['kaese'],
  gruyere: ['kaese'],
  tomatenmark: ['tomatenmark'],
  kochsahne: ['kochcreme'],
  rindergulasch: ['gulasch'],
  wildgulasch: ['gulasch'],
  ghee: ['butterschmalz', 'fett', 'fetts'],
  olivenoel: ['oel', 'oels'],
  rapsoel: ['oel', 'oels'],
};
const MEAT = new Set(['Geflügel', 'Schwein', 'Rind']);

// Wörter vor einer Zutat, die nur einen Teil meinen. Bruchteile rechnet Mise selbst aus („die Hälfte des Salbeis“),
// unbestimmte Angaben („etwas Butter“) brauchen eine Angabe im Rezept (step.amt), sonst steht keine Menge davor.
const FRACTIONS = [
  [/(zwei|2)\s*drittel\w*\s+(?:[^\s,;.:]+\s+){0,2}$/, 2 / 3],
  [/(drei|3)\s*viertel\w*\s+(?:[^\s,;.:]+\s+){0,2}$/, 3 / 4],
  [/haelfte\s+(?:[^\s,;.:]+\s+){0,2}$/, 1 / 2],
  [/drittel\w*\s+(?:[^\s,;.:]+\s+){0,2}$/, 1 / 3],
  [/viertel\w*\s+(?:[^\s,;.:]+\s+){0,2}$/, 1 / 4],
];
const REST = /\b(rest\w*|uebrig\w*)\s+(?:[^\s,;.:]+\s+){0,2}$/;
const VAGUE = /\b(etwas|grossteil|teil|wieder|weitere\w*|noch|einige\w*|ein paar|wenig|mehr|schuss|klecks|spritzer)\s+(?:[^\s,;.:]+\s+){0,2}$|\b(je|jede\w*|eine\w*|pro)\s+(scheibe|zehe|prise|stueck|handvoll|klecks|spritzer|schuss|tl|el)\s+$/;
const NUMBER_RE = /\d[\d,.½¼¾⅓]*\s*((?:[a-z]{1,14}\s+){0,2})$/;
// Zahl direkt vor der Zutat („2 EL Zucker“, „6 TL flüssigen Honig“) – aber nicht „die letzten 3 Minuten den Brokkoli“
const NUMBER = { test: (s) => { const m = s.match(NUMBER_RE); return !!m && !/\b(min\w*|std|stunde\w*|grad|cm|mm|den|die|der|das|dem|des|portion\w*|teile?|mal)\b/.test(m[1]); } };
// „einer halben Zitrone“: wörtliche Mengenangabe im Text
const LITERAL = /\b(eine[nmrs]?\s+halbe\w*|die\s+halbe\w*|halbe\w*)\s+$/;

// Gerichtsteile: „Salat“ meint nicht die Salatgurke, „Teig“ nicht das Teigblatt
const DISH = new Set(['salat', 'suppe', 'teig', 'creme', 'masse', 'dressing', 'fuellung', 'marinade', 'gemuese', 'pizza', 'risotto', 'braten', 'bratensatz'].map(norm));
// Gerät oder Sud statt Zutat: „Kartoffelpresse“, „Nudelwasser“, „Paprikapulver“
const NOT_FOOD = /(pulver|gewuerz|presse|wasser|tuch|papier|form|stellen|kerne|topf|pfanne)$/;

/** Suchbegriffe je Zutat. lookup(id) liefert den Datenbank-Eintrag (name, kw, protein, cat); der Hinweis im Rezept zählt mit. */
export function stepTerms(items, lookup) {
  return items.map((it, idx) => {
    const i = lookup(it.id);
    const words = (s) => (String(s || '').replace(/\(.*?\)/g, ' ').match(PART) || []).map(norm).filter((t) => t.length >= 3);
    const name = words(i?.name);
    // Hinweise wie „2 EL für den Kaffee“ oder „zum Bestäuben“ beschreiben nicht die Zutat selbst
    const note = String(it.note || '').replace(/\b(f(ü|u)rs?|zum|zur|als)\s+\S+(\s+\S+)?/gi, ' ');
    // Gewicht je Suchbegriff: Name und einzelne Suchwörter 0, Teil eines Suchbegriffs aus mehreren Wörtern −0,5
    // („Sahne“ aus „saure Sahne“), Hinweis im Rezept −1 – bei Gleichstand gewinnt so die eigentliche Zutat
    const toks = new Map();
    const add = (t, wgt) => {
      if (!toks.has(t) || toks.get(t) < wgt) toks.set(t, wgt);
    };
    name.forEach((t, n) => (n === 0 || !GENERIC.has(t)) && add(t, 0));
    for (const k of i?.kw || []) {
      const ws = words(k).filter((t) => !GENERIC.has(t));
      ws.forEach((t) => add(t, ws.length > 1 ? -0.5 : 0));
    }
    // aus dem Hinweis nur das erste aussagekräftige Wort („Schalotten“, „Marsala, alternativ Rotwein“, „oder Pecorino“)
    words(note.split(/[,;(]/)[0]).filter((t) => !GENERIC.has(t)).slice(0, 1).forEach((t) => add(t, -1));
    (SYNONYMS[it.id] || []).forEach((t) => add(t, 0));
    if (MEAT.has(i?.protein) && ['Fleisch & Fisch', 'Tiefkühl'].includes(i?.cat)) add('fleisch', 0);
    return { idx, id: it.id, toks: [...toks] };
  });
}

/** Wie gut passt ein Wort aus dem Schritt zu einem Suchbegriff? 0 = gar nicht */
function score(w, tok) {
  if (w === tok) return 5;
  // kurze Wörter („Rum“) nur, wenn sie genau passen
  if (w.length < 4 || tok.length < 4) return 0;
  // Mehrzahl/Beugung: „Zwiebel“ → „zwiebeln“, „Kartoffeln“ → „kartoffel“, „Salbeis“ → „salbei“
  if (Math.abs(tok.length - w.length) <= 2 && w.length >= 4 && (tok.startsWith(w.slice(0, Math.max(4, w.length - 2))) || w.startsWith(tok.slice(0, Math.max(4, tok.length - 2))))) return 4;
  // zusammengesetzte Wörter: Das letzte Wortteil bestimmt, was es ist („Schinken“ → „Parmaschinken“, „Salat“ → „Eisbergsalat“),
  // ein vorderes Wortteil passt nur schwächer („Speck“ → „Speckwürfel“, aber nie „Salat“ → „Salatgurke“)
  if (w.length >= 4 && tok.endsWith(w)) return 3;
  if (w.length >= 5 && tok.startsWith(w) && !DISH.has(w)) return 2;
  if (tok.length >= 5 && w.startsWith(tok) && !NOT_FOOD.test(w) && ![...DISH].some((d) => w.endsWith(d))) return 1;
  return 0;
}

/**
 * Fundstellen in allen Schritten eines Rezepts. Ergebnis je Schritt: [{ start, end, idx, frac, kind }]
 * idx = Position in items; frac = Anteil an der Gesamtmenge, der an dieser Stelle gemeint ist (null = keine Menge anzeigen).
 * kind: 'full' (ganze Menge) | 'part' (Hälfte, Drittel …) | 'rest' | 'share' (etwas … und der Rest: gleichmäßig verteilt) |
 *       'same' (dieselbe Portion wie zuletzt) | 'amt' (aus dem Rezept, step.amt) | 'number' (Menge steht wörtlich im Text) |
 *       'vague' (unklar) | 'repeat' (weitere Erwähnung im selben Schritt).
 * amts: je Schritt das Feld step.amt – { zutatId: Anteil } oder { zutatId: [Anteil 1. Erwähnung, 2. Erwähnung] }.
 * Ein Wort gehört immer zur am besten passenden Zutat – auch wenn die schon erwähnt wurde (so wird „Tomatenmark“ nie zu „Tomaten“).
 */
export function recipeMatches(texts, terms, amts = []) {
  // 1. Fundstellen mit Art der Angabe sammeln
  const all = texts.map((text, n) => {
    const count = new Map();
    const hits = [];
    const amt = amts[n] || {};
    for (const m of String(text).matchAll(WORD)) {
      const w = norm(m[0]).replace(/-$/, '');
      if (w.length < 3 || GENERIC.has(w)) continue;
      // Bindestrich-Wörter: der letzte Teil bestimmt, was es ist („Fondue-Gewürz“ ist ein Gewürz);
      // ist der nichtssagend („Zwiebelsuppen-Pulver“), zählt der erste
      const parts = w.split('-').filter(Boolean);
      const head = parts[parts.length - 1];
      const variants = parts.length < 2 ? [w] : GENERIC.has(head) ? [w, parts[0]] : [w, head];
      let best = null;
      let bestScore = 0;
      for (const t of terms) {
        const sc = Math.max(0, ...t.toks.flatMap(([tok, wgt]) => variants.map((v) => (score(v, tok) ? score(v, tok) + wgt : 0))));
        if (sc > bestScore) [best, bestScore] = [t, sc];
      }
      if (!best) continue;
      // „saure Sahne“, „Miracel Whip“: das zweite Wort gehört noch zur selben Zutat
      const prev = hits[hits.length - 1];
      if (prev && /^\s*$/.test(text.slice(prev.end, m.index))) {
        const pt = terms[prev.idx];
        if (pt.toks.some(([tok]) => variants.some((v) => score(v, tok) >= 4))) {
          prev.end = m.index + m[0].length;
          continue;
        }
      }
      const k = count.get(best.idx) || 0;
      count.set(best.idx, k + 1);
      const before = norm(text.slice(Math.max(0, m.index - 30), m.index));
      const given = amt[best.id];
      const h = { start: m.index, end: m.index + m[0].length, idx: best.idx, frac: null, kind: 'full' };
      if (given !== undefined && (Array.isArray(given) ? k < given.length : k === 0)) [h.kind, h.frac] = ['amt', Array.isArray(given) ? given[k] : given];
      else if (NUMBER.test(before.slice(-26)) || LITERAL.test(before)) h.kind = 'number';
      else if (REST.test(before)) h.kind = 'rest';
      else if (FRACTIONS.some(([re]) => re.test(before))) [h.kind, h.frac] = ['part', FRACTIONS.find(([re]) => re.test(before))[1]];
      else if (VAGUE.test(before)) [h.kind, h.most] = ['vague', /grossteil/.test(before)];
      else if (k > 0) h.kind = 'repeat';
      hits.push(h);
    }
    return hits;
  });
  // 2. Je Zutat die Anteile ausrechnen
  const byIdx = new Map();
  for (const h of all.flat()) {
    if (h.kind === 'repeat') continue;
    if (!byIdx.has(h.idx)) byIdx.set(h.idx, []);
    byIdx.get(h.idx).push(h);
  }
  for (const seq of byIdx.values()) {
    const fixed = seq.filter((h) => h.kind === 'amt' || h.kind === 'part').reduce((a, h) => a + h.frac, 0);
    const vague = seq.filter((h) => h.kind === 'vague');
    const rests = seq.filter((h) => h.kind === 'rest');
    const consuming = seq.filter((h) => h.kind !== 'full' && h.kind !== 'number');
    // nur einmal erwähnt („einen Klecks Skyr“, „mit etwas Butter servieren“): das ist alles
    const single = consuming.length === 1 && ['vague', 'rest'].includes(consuming[0].kind) && !seq.some((h) => h.kind === 'number');
    if (single) [consuming[0].kind, consuming[0].frac] = ['full', 1];
    // „etwas Butterschmalz … wieder etwas … restliches Butterschmalz“: gleichmäßig verteilen, „Großteil“ = ¾
    else if (vague.length && rests.length && !seq.some((h) => h.kind === 'number')) {
      const open = Math.max(0, 1 - fixed);
      const most = vague.filter((h) => h.most);
      const mostShare = most.length ? (0.75 * open) / most.length : 0;
      const other = vague.length - most.length + rests.length;
      const share = other ? (open - mostShare * most.length) / other : 0;
      for (const h of vague) [h.kind, h.frac] = ['share', h.most ? mostShare : share];
      for (const h of rests) [h.kind, h.frac] = ['share', share];
    }
    // Reihenfolge abarbeiten: „rest“ = was noch übrig ist; ohne Zusatz nach Teilmengen = der Rest bzw. dieselbe Portion wie zuletzt
    let used = 0;
    let last = null;
    for (const h of seq) {
      if (h.kind === 'rest') {
        h.frac = used > 0 && used < 0.999 ? 1 - used : null;
        if (h.frac === null) h.kind = 'vague';
      } else if (h.kind === 'full' && used > 0) [h.kind, h.frac] = used < 0.999 ? ['rest', 1 - used] : ['same', last];
      else if (h.kind === 'full') h.frac = 1;
      if (['amt', 'part', 'rest', 'share'].includes(h.kind) && h.frac !== null) {
        used += h.frac;
        last = h.frac;
      }
    }
  }
  for (const h of all.flat()) if (h.frac !== null && h.frac <= 0) h.frac = null;
  return all;
}

/** Fundstellen in einem einzelnen Text */
export const stepMatches = (text, terms, amt) => recipeMatches([text], terms, [amt])[0];
