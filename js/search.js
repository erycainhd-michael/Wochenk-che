// Fehlertolerante Rezeptsuche: findet „Carbonra“, „Lasange“ oder „hänchen curry“.
// Jedes Suchwort muss irgendwo passen (Name, Zutaten, Tags, Küche) – Treffer im Namen zählen mehr.

export const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[éèê]/g, 'e')
    .replace(/[àâ]/g, 'a')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Tippfehler-Abstand (Damerau-Levenshtein, mit Abbruch ab `max`) */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** Wie gut passt ein Suchwort zu einem Wort? 0 = gar nicht, 1 = perfekt */
function wordScore(q, w) {
  if (w === q) return 1;
  if (w.startsWith(q)) return 0.9;
  if (q.length >= 3 && w.includes(q)) return 0.75;
  if (q.length < 4) return 0;
  const max = q.length <= 5 ? 1 : 2;
  // ganzes Wort mit Tippfehler, oder Wortanfang mit Tippfehler („carbonra“ → „carbonara“)
  if (distance(q, w, max) <= max) return 0.7;
  if (w.length > q.length && distance(q, w.slice(0, q.length), max) <= max) return 0.6;
  // zusammengesetzte Wörter: „rotwein“ in „rotweinsauce“, „lachs“ in „raeucherlachs“
  for (let i = 1; i + q.length <= w.length; i++) if (distance(q, w.slice(i, i + q.length), 1) <= 1) return 0.5;
  return 0;
}

/**
 * Bewertet ein Rezept für eine Suchanfrage. Ergebnis 0 = kein Treffer, sonst je höher desto besser.
 * fields: [{ text, weight }]
 */
export function searchScore(query, fields) {
  const qs = normalize(query).split(' ').filter(Boolean);
  if (!qs.length) return 1;
  const words = fields.map((f) => ({ words: normalize(f.text).split(' ').filter(Boolean), weight: f.weight }));
  let total = 0;
  for (const q of qs) {
    let best = 0;
    for (const f of words) for (const w of f.words) best = Math.max(best, wordScore(q, w) * f.weight);
    if (!best) return 0;
    total += best;
  }
  return total;
}
