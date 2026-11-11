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
    'den', 'dem', 'die', 'der', 'und', 'mit', 'zum', 'zur', 'ganze', 'ganzer', 'portion', 'portionen', 'person', 'personen', 'rest', 'teil', 'viel', 'wenig', 'kerne', 'wasser', 'sauce', 'sosse', 'fein', 'feine', 'gefroren', 'gefrorene', 'gefrorenen', 'gemahlen', 'gemahlene', 'geroestet', 'geroestete', 'geroesteten', 'abgerieben', 'abgeriebene',
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
  ghee: ['butterschmalz'],
};
const MEAT = new Set(['Geflügel', 'Schwein', 'Rind']);

// Wörter vor einer Zutat, die nur einen Teil meinen („die Hälfte des Salbeis“, „im restlichen Öl“) – dort keine Gesamtmenge
const PARTIAL = /((rest\w*|uebrig\w*|haelfte|grossteil|teil|etwas|wieder|weiter\w*|noch|einige\w*|ein paar|ein wenig|wenig|mehr|schuss)\s+(?:\S+\s+){0,2}|\b(je|jede\w*|eine\w*|pro)\s+(scheibe|zehe|prise|stueck|handvoll|klecks|spritzer|schuss|tl|el)\s+)$/;
// Gerichtsteile: „Salat“ meint nicht die Salatgurke, „Teig“ nicht das Teigblatt
const DISH = new Set(['salat', 'suppe', 'teig', 'creme', 'masse', 'dressing', 'fuellung', 'marinade', 'gemuese'].map(norm));
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
    const toks = new Set([
      ...name.filter((t, n) => n === 0 || !GENERIC.has(t)),
      ...(i?.kw || []).flatMap(words).filter((t) => !GENERIC.has(t)),
      ...words(note).filter((t) => !GENERIC.has(t)),
      ...(SYNONYMS[it.id] || []),
    ]);
    if (MEAT.has(i?.protein) && ['Fleisch & Fisch', 'Tiefkühl'].includes(i?.cat)) toks.add('fleisch');
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
  if (w.length >= 5 && tok.endsWith(w)) return 3;
  if (w.length >= 5 && tok.startsWith(w) && !DISH.has(w)) return 2;
  if (tok.length >= 5 && w.startsWith(tok) && !NOT_FOOD.test(w)) return 1;
  return 0;
}

/**
 * Fundstellen in allen Schritten eines Rezepts. Ergebnis je Schritt: [{ start, end, idx, first, partial }]
 * idx = Position in items, first = erste Erwähnung im Rezept, partial = nur ein Teil oder Menge steht schon davor.
 * Ein Wort gehört immer zur am besten passenden Zutat – auch wenn die schon erwähnt wurde (so wird „Tomatenmark“ nie zu „Tomaten“).
 */
export function recipeMatches(texts, terms) {
  const seen = new Set();
  return texts.map((text) => {
    const inStep = new Set();
    const hits = [];
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
        const s = Math.max(0, ...t.toks.flatMap((tok) => variants.map((v) => score(v, tok))));
        if (s > bestScore) [best, bestScore] = [t, s];
      }
      if (!best || inStep.has(best.idx)) continue;
      inStep.add(best.idx);
      const before = norm(text.slice(Math.max(0, m.index - 30), m.index));
      const partial = PARTIAL.test(before) || /\d[\d,.½¼¾]*\s*(?:[a-z]{1,14}\s+)?$/.test(before.slice(-18));
      hits.push({ start: m.index, end: m.index + m[0].length, idx: best.idx, first: !seen.has(best.idx), partial });
      seen.add(best.idx);
    }
    return hits;
  });
}

/** Fundstellen in einem einzelnen Text (jede Zutat höchstens einmal) */
export const stepMatches = (text, terms) => recipeMatches([text], terms)[0];
