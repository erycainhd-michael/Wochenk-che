// Übernimmt ein in der App erstelltes Rezept (als GitHub-Issue „Rezept: …“ eingereicht) in die
// gemeinsame Rezeptsammlung, damit es auf allen Geräten erscheint.
//   ISSUE_BODY='…' node scripts/import-recipe-issue.mjs
// Der Issue-Text enthält einen ```json-Block: { "recipes": [...], "ingredients": [...] }.
// Eigene Zutaten (mit Nährwerten) werden in data/ingredients.json ergänzt, Rezepte über add-recipes.mjs geprüft.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const body = process.env.ISSUE_BODY || '';
const m = body.match(/```json\s*([\s\S]*?)```/);
if (!m) {
  console.log('Kein JSON-Block gefunden.');
  process.exit(2);
}
let payload;
try {
  payload = JSON.parse(m[1]);
} catch (err) {
  console.log('JSON ungültig: ' + err.message);
  process.exit(2);
}

// --- Zutaten ergänzen ---------------------------------------------------------
const P = 'data/ingredients.json';
const text = fs.readFileSync(P, 'utf8');
const db = JSON.parse(text);
const have = new Set(db.items.map((i) => i.id));
const n = (v, lo, hi) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x * 10) / 10)) : null;
};
const added = [];
for (const raw of payload.ingredients || []) {
  const id = String(raw.id || '');
  if (!/^[xg]_[a-z0-9_]{1,40}$/.test(id) || have.has(id)) continue;
  const it = {
    id,
    name: String(raw.name || '').trim().slice(0, 60),
    cat: db.categories.includes(raw.cat) ? raw.cat : 'Eigene Zutaten',
    kcal: n(raw.kcal, 0, 950),
    p: n(raw.p, 0, 100),
    c: n(raw.c, 0, 100),
    f: n(raw.f, 0, 100),
    fib: n(raw.fib ?? 0, 0, 100),
    pack: n(raw.pack, 1, 10000) || 250,
    price: n(raw.price, 0.1, 100) || 2,
    shelf: n(raw.shelf, 1, 3650) || 7,
    protein: null,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string').slice(0, 4) : [],
    kw: [],
  };
  if (!it.name || [it.kcal, it.p, it.c, it.f].some((v) => v == null)) continue;
  // Kalorien müssen zu den Makros passen (sonst schlägt die Datenprüfung an) – im Zweifel aus den Makros berechnen
  const calc = it.p * 4 + it.c * 4 + it.f * 9 + it.fib * 2;
  if (it.kcal > 20 && Math.abs(calc - it.kcal) / it.kcal > 0.2) it.kcal = Math.round(calc);
  if (it.cat === 'Eigene Zutaten' && !db.categories.includes('Eigene Zutaten')) db.categories.push('Eigene Zutaten');
  if (raw.piece > 0) it.piece = n(raw.piece, 1, 5000);
  db.items.push(it);
  have.add(id);
  added.push(it);
}
if (added.length) {
  // Datei sonst unverändert lassen: neue Zutaten als eigene Zeilen anhängen
  const fmt = (i) => '    ' + JSON.stringify(i).replace(/,"/g, ', "').replace(/":/g, '": ');
  let out = text.replace(/\n  \]\n\}\s*$/, ',\n' + added.map(fmt).join(',\n') + '\n  ]\n}\n');
  if (!text.includes('"Eigene Zutaten"') && db.categories.includes('Eigene Zutaten')) out = out.replace(/("categories": \[[^\]]*?)\]/, '$1, "Eigene Zutaten"]');
  fs.writeFileSync(P, out);
  console.log(`Zutaten ergänzt: ${added.map((i) => i.name).join(', ')}`);
}

// --- Rezepte über die geprüfte Routine einfügen ------------------------------------
const tmp = 'tmp-recipes.json';
fs.writeFileSync(tmp, JSON.stringify(payload.recipes || []));
try {
  execFileSync('node', ['scripts/add-recipes.mjs', tmp], { stdio: 'inherit', env: { ...process.env, USER_RECIPES: '1' } });
} finally {
  fs.rmSync(tmp, { force: true });
}
