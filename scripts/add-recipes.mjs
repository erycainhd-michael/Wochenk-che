// Fügt neue Rezepte (z. B. von der wöchentlichen Claude-Routine) geprüft in data/recipes.json ein.
//   node scripts/add-recipes.mjs neue-rezepte.json
// Die Datei enthält ein Array von Rezepten im Format von data/recipes.json (Mengen für 1 Portion).
// Ungültige Rezepte (unbekannte Zutat, zu wenig Protein, zu lang …) werden übersprungen und gemeldet.
import fs from 'node:fs';
import { buildIndex, recipeMacros } from '../js/nutrition.js';
import { shortName } from '../js/util.js';
import { stepTools } from '../js/tools.js';

const file = process.argv[2];
if (!file) {
  console.error('Aufruf: node scripts/add-recipes.mjs <datei.json>');
  process.exit(1);
}
const ingData = JSON.parse(fs.readFileSync('data/ingredients.json', 'utf8'));
const db = JSON.parse(fs.readFileSync('data/recipes.json', 'utf8'));
const idx = buildIndex(ingData);
let incoming = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(incoming)) incoming = incoming.recipes || [];

const slug = (s) =>
  s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
const names = new Set(db.recipes.map((r) => r.name.toLowerCase().trim()));
const ids = new Set(db.recipes.map((r) => r.id));
const today = new Date().toISOString().slice(0, 10);
// Aus der App eingereichte Rezepte (von dir, Familie …): keine Protein-/Zeit-Vorgaben, ID bleibt erhalten
const USER = !!process.env.USER_RECIPES;
const added = [];
const skipped = [];

for (const raw of incoming) {
  const name = String(raw.name || '').trim();
  // snack = „Kaffee & Kuchen“ am Sonntag statt Mittagessen
  const type = ['breakfast', 'snack'].includes(raw.type) ? raw.type : 'main';
  const problems = [];
  if (!name) problems.push('kein Name');
  if (names.has(name.toLowerCase())) problems.push('gibt es schon');
  const ingredients = (raw.ingredients || []).map((l) => ({ id: l.id, g: Math.round(Number(l.g)), ...(l.note ? { note: String(l.note) } : {}) }));
  const unknown = ingredients.filter((l) => !idx.has(l.id)).map((l) => l.id);
  if (unknown.length) problems.push('unbekannte Zutaten: ' + unknown.join(', '));
  if (ingredients.some((l) => !(l.g > 0))) problems.push('Menge fehlt');
  const steps = (raw.steps || [])
    .filter((s) => String(s.t || '').trim())
    .map((s) => ({ t: String(s.t).trim(), ...(Number(s.timer) > 0 ? { timer: Math.round(Number(s.timer)), label: String(s.label || 'Timer') } : {}), ...(Array.isArray(s.tools) && s.tools.length ? { tools: s.tools.map(String).slice(0, 6) } : {}) }));
  // Geschirr je Schritt: angegeben oder aus dem Text erkannt; Abwasch = Anzahl der Teile
  if (!steps.some((s) => s.tools)) stepTools({ steps }).forEach((t, i) => t.length && (steps[i].tools = t));
  const toolCount = steps.reduce((a, s) => a + (s.tools?.length || 0), 0);
  if (!steps.length) problems.push('keine Anleitung');
  const effort = [1, 2, 3].includes(Number(raw.effort)) ? Number(raw.effort) : 1;
  const time = Math.round(Number(raw.time) || 0);
  if (!(time > 0)) problems.push('keine Zeit');
  if (!USER && type === 'main' && effort < 3 && time > 35) problems.push(`${time} Min. zu lang`);
  const recipe = {
    id: '',
    name,
    short: raw.short ? String(raw.short).slice(0, 24) : shortName(name),
    type,
    time,
    dishes: toolCount || Math.max(0, Math.min(8, Math.round(Number(raw.dishes) || 1))),
    effort,
    mealPrep: !!raw.mealPrep,
    tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 6).map(String) : [],
    protein: String(raw.protein || ''),
    ingredients,
    steps,
    ...(raw.tip ? { tip: String(raw.tip) } : {}),
    ...(Array.isArray(raw.season) ? { season: raw.season } : {}),
    source: USER ? 'nutzer' : 'routine',
    addedAt: today,
  };
  if (!unknown.length && !USER) {
    const m = recipeMacros(recipe, idx, {}, 1);
    const minP = type === 'main' ? 30 : type === 'snack' ? 20 : 25;
    if (m.p < minP) problems.push(`nur ${Math.round(m.p)} g Protein`);
    if (m.kcal < (type === 'snack' ? 300 : 400) || m.kcal > 1200) problems.push(`${Math.round(m.kcal)} kcal pro Portion`);
  }
  if (problems.length) {
    skipped.push(`${name || '(ohne Name)'}: ${problems.join('; ')}`);
    continue;
  }
  // Eingereichte Rezepte behalten ihre ID aus der App (dann wird die Kopie auf dem Gerät ersetzt)
  let id = USER && /^u_[a-z0-9]{3,20}$/.test(String(raw.id || '')) && !ids.has(raw.id) ? raw.id : slug(name) || 'rezept';
  while (ids.has(id)) id += '_2';
  recipe.id = id;
  ids.add(id);
  names.add(name.toLowerCase());
  db.recipes.push(recipe);
  added.push(name);
}

const out =
  '{\n  "_info": ' + JSON.stringify(db._info) + ',\n  "recipes": [\n' + db.recipes.map((r) => '    ' + JSON.stringify(r)).join(',\n') + '\n  ]\n}\n';
fs.writeFileSync('data/recipes.json', out);
console.log(`Hinzugefügt (${added.length}): ${added.join(' | ') || '–'}`);
if (skipped.length) console.log(`Übersprungen (${skipped.length}):\n  ${skipped.join('\n  ')}`);
process.exit(added.length ? 0 : 2);
