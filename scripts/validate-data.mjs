// Prüft die Datenbanken: Zutaten vorhanden, Pflichtfelder, Makros plausibel. node scripts/validate-data.mjs
import fs from 'node:fs';
import { buildIndex, recipeMacros } from '../js/nutrition.js';

const ing = JSON.parse(fs.readFileSync('data/ingredients.json', 'utf8'));
const rec = JSON.parse(fs.readFileSync('data/recipes.json', 'utf8')).recipes;
const idx = buildIndex(ing);
const errors = [];
const ids = new Set();

for (const i of ing.items) {
  if (ids.has(i.id)) errors.push(`Zutat doppelt: ${i.id}`);
  ids.add(i.id);
  for (const f of ['name', 'cat', 'kcal', 'p', 'c', 'f', 'fib', 'pack', 'price', 'shelf']) if (i[f] === undefined) errors.push(`${i.id}: Feld ${f} fehlt`);
  if (!ing.categories.includes(i.cat)) errors.push(`${i.id}: unbekannte Kategorie ${i.cat}`);
  const calc = i.p * 4 + i.c * 4 + i.f * 9 + i.fib * 2;
  if (i.kcal > 20 && Math.abs(calc - i.kcal) / i.kcal > 0.2) errors.push(`${i.id}: kcal ${i.kcal} passt nicht zu Makros (≈ ${Math.round(calc)})`);
}

const rids = new Set();
const counts = { main: 0, breakfast: 0, snack: 0 };
for (const r of rec) {
  if (rids.has(r.id)) errors.push(`Rezept doppelt: ${r.id}`);
  rids.add(r.id);
  counts[r.type] = (counts[r.type] || 0) + 1;
  for (const f of ['name', 'type', 'time', 'dishes', 'effort', 'tags', 'protein', 'ingredients', 'steps']) if (r[f] === undefined) errors.push(`${r.id}: Feld ${f} fehlt`);
  for (const l of r.ingredients) if (!idx.has(l.id)) errors.push(`${r.id}: Zutat ${l.id} fehlt in der Datenbank`);
  for (const s of r.steps) if (s.timer !== undefined && !(s.timer > 0)) errors.push(`${r.id}: ungültiger Timer`);
  const m = recipeMacros(r, idx, {}, 1);
  // Eingereichte Rezepte (source „nutzer“) haben keine Protein-/Zeit-Vorgaben
  if (r.source !== 'nutzer' && r.type !== 'snack' && r.type !== 'addon' && m.p < 25) errors.push(`${r.id}: nur ${Math.round(m.p)} g Protein pro Portion`);
  if (r.source !== 'nutzer' && r.type === 'main' && r.effort < 3 && r.time > 35) errors.push(`${r.id}: ${r.time} Min. – zu lang für ein schnelles Gericht`);
}
if (counts.main < 30) errors.push(`Nur ${counts.main} Hauptgerichte (mind. 30)`);

console.log(`${ing.items.length} Zutaten, ${rec.length} Rezepte (${counts.main} Hauptgerichte, ${counts.breakfast} Frühstück, ${counts.snack} Snacks)`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('Alles in Ordnung ✓');
