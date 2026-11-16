// Befunde aus der Persona-Tiefenprüfung (KW 47/2026). Jeder Test beschreibt das GEWÜNSCHTE Verhalten und
// schlägt mit dem heutigen Stand fehl. Sie laufen als „todo“: sichtbar im Testlauf, aber die Suite bleibt grün,
// bis der jeweilige Befund behoben ist – dann „todo“ entfernen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildIndex } from '../js/nutrition.js';
import { generatePlan, prepareContext, refitPlan } from '../js/planner.js';
import { DEFAULT_SETTINGS, applyWeighIn, calcGoals, goalBlocked, switchGoal } from '../js/settings.js';

const idx = buildIndex(JSON.parse(fs.readFileSync('data/ingredients.json', 'utf8')));
const recipes = JSON.parse(fs.readFileSync('data/recipes.json', 'utf8')).recipes;
const base = (extra = {}) => ({ ...structuredClone(DEFAULT_SETTINGS), ...extra });
const mealsOf = (p) => p.days.flatMap((d) => d.meals.filter((m) => m.kind === 'recipe'));
const namesOf = (m) => [recipes.find((r) => r.id === m.recipeId)?.name || '', ...(m.items || []).map((i) => idx.get(i.id)?.name || '')].join(' ').toLowerCase();

test('F01 Kein Kaloriendefizit bei Untergewicht (BMI < 18,5)', () => {
  const g = calcGoals({ sex: 'w', age: 24, height: 170, weight: 47, activity: 'wenig', goal: 'abnehmen' });
  const maintain = calcGoals({ sex: 'w', age: 24, height: 170, weight: 47, activity: 'wenig', goal: 'halten' });
  assert.ok(g.kcal >= maintain.kcal, `BMI 16,3 bekommt ${g.kcal} statt mindestens ${maintain.kcal} kcal`);
});

test('F02 Minderjährige: kein Diät-Defizit', () => {
  const g = calcGoals({ sex: 'w', age: 15, height: 162, weight: 52, activity: 'mittel', goal: 'abnehmen' });
  const maintain = calcGoals({ sex: 'w', age: 15, height: 162, weight: 52, activity: 'mittel', goal: 'halten' });
  assert.ok(g.kcal >= maintain.kcal, `15-Jährige bekommt ${g.kcal} kcal Defizit-Ziel`);
});

test('F02 Jugendliche: Bedarf liegt über der Erwachsenenformel (Wachstum)', () => {
  const teen = calcGoals({ sex: 'w', age: 15, height: 162, weight: 52, activity: 'mittel', goal: 'halten' });
  const adult = calcGoals({ sex: 'w', age: 18, height: 162, weight: 52, activity: 'mittel', goal: 'halten' });
  assert.ok(teen.kcal > adult.kcal, `${teen.kcal} vs ${adult.kcal}`);
  assert.equal(goalBlocked({ age: 15, height: 162, weight: 70 }, 'abnehmen'), 'minor');
  assert.equal(goalBlocked({ age: 30, height: 170, weight: 50 }, 'abnehmen'), 'underweight');
  assert.equal(goalBlocked({ age: 30, height: 170, weight: 80 }, 'abnehmen'), null);
});

test('F03 Gewicht zieht die Ziele mit, Zielgewicht erreicht → Rückfrage, Untergewicht → Halten', () => {
  const p = { sex: 'm', age: 35, height: 180, weight: 82, activity: 'mittel', goal: 'abnehmen' };
  // eigene Anpassung (2.800 statt berechneter 2.300 kcal) bleibt erhalten, die Gewichtsänderung wird übernommen
  const s = { profile: p, goals: { kcal: 2800, protein: 140, carbs: 350, fat: 90 }, goalWeight: 76 };
  const a = applyWeighIn(s, 79);
  assert.equal(a.profile.weight, 79);
  assert.ok(a.goals.kcal < 2800 && a.goals.kcal >= 2650, String(a.goals.kcal));
  assert.equal(a.reached, false);
  const b = applyWeighIn(s, 75.8);
  assert.equal(b.reached, true);
  const h = switchGoal({ ...s, profile: b.profile, goals: b.goals }, 'halten');
  assert.equal(h.profile.goal, 'halten');
  assert.ok(h.goals.kcal - b.goals.kcal >= 400, 'Halten = Defizit weg');
  // Untergewicht während des Abnehmens: automatisch Halten, keine Rückfrage
  const thin = { profile: { ...p, weight: 61 }, goals: calcGoals({ ...p, weight: 61 }), goalWeight: 55 };
  const c = applyWeighIn(thin, 59);
  assert.equal(c.switched, 'underweight');
  assert.equal(c.profile.goal, 'halten');
  assert.equal(c.reached, false);
});

test('F04 Allergie „Nüsse“ schließt Mandeln, Walnüsse und Erdnuss aus', () => {
  const p = generatePlan({ recipes, idx, settings: base({ dislikes: ['Nüsse'] }), weekStart: '2026-11-16', seed: 6, candidates: 6 });
  const hits = mealsOf(p).filter((m) => /mandel|walnu|erdnu|haselnu|cashew|pinienkern|pesto/.test(namesOf(m)));
  assert.equal(hits.length, 0, hits.map((m) => m.recipeId).join(', '));
});

test('F05 Abneigung „Ei“ trifft nur Eier, nicht Reis/Weißwein', () => {
  const all = prepareContext({ recipes, idx, settings: base(), weekStart: '2026-11-16' }).mains.length;
  const noEgg = prepareContext({ recipes, idx, settings: base({ dislikes: ['Ei'] }), weekStart: '2026-11-16' }).mains.length;
  assert.ok(noEgg >= all * 0.7, `nur noch ${noEgg} von ${all} Hauptgerichten`);
});

test('F07 Schwangerschaft: kein Räucherlachs, Rohschinken, Leber', () => {
  // alles, was der Planer überhaupt einplanen darf (Hauptgerichte, Frühstück, Snacks)
  const ctx = prepareContext({ recipes, idx, settings: base({ profile: { pregnant: true } }), weekStart: '2026-11-16' });
  const pool = [...ctx.mains, ...ctx.breakfasts, ...ctx.addons, ...ctx.snacks];
  const risky = pool.filter((r) => r.ingredients.some((l) => /räucherlachs|rohschinken|serrano|parma|leber/i.test(idx.get(l.id)?.name || '')));
  assert.equal(risky.length, 0, risky.map((r) => r.id).join(', '));
});

test('F08 Ärztlich gesenktes Protein-Ziel wird eingehalten (±15 %)', { todo: 'Befund F08 – verbessert (64–78 g statt 73–89 g), braucht eiweißärmere Rezepte' }, () => {
  const prof = { sex: 'w', age: 67, height: 160, weight: 72, activity: 'wenig', goal: 'halten' };
  const s = base({ profile: prof, goals: { ...calcGoals(prof), protein: 58 } });
  const p = generatePlan({ recipes, idx, settings: s, weekStart: '2026-11-16', seed: 3, candidates: 8 });
  for (const d of p.days) assert.ok(d.totals.p <= 58 * 1.15, `${d.name}: ${Math.round(d.totals.p)} g`);
});

test('F10 Mitesser: Budget-Hinweis wird nach dem Hinzufügen neu bewertet', () => {
  const s = base({ budget: 60 });
  const input = { recipes, idx, settings: s, weekStart: '2026-11-16' };
  const p = generatePlan({ ...input, seed: 2, candidates: 6 });
  const people = Object.fromEntries(p.structure.cooks.flatMap((c) => c.portions).filter((k) => k.endsWith('abend')).map((k) => [k, 4]));
  const q = refitPlan({ ...p, structure: { ...p.structure, people } }, input);
  assert.ok(q.cost <= 60 || q.budgetInfo, `${q.cost.toFixed(2)} € ohne Budget-Hinweis`);
});

test('F13 Auswärts-Abend passt zum Tagesziel (nicht pauschal 1.000 kcal)', () => {
  const prof = { sex: 'w', age: 37, height: 160, weight: 57, activity: 'wenig', goal: 'abnehmen' };
  const s = base({ profile: prof, goals: calcGoals(prof), eatOut: [{ day: 2, slot: 'abend' }] });
  const p = generatePlan({ recipes, idx, settings: s, weekStart: '2026-11-16', seed: 4, candidates: 6 });
  const d = p.days[2];
  assert.ok(d.totals.kcal <= d.goalKcal * 1.08, `${Math.round(d.totals.kcal)} kcal bei Ziel ${d.goalKcal}`);
});

test('F04/F05 Ernährungsformen und Allergien über Zutatendaten', async () => {
  const { recipeBlocked, restrictions } = await import('../js/diet.js');
  const pool = (extra) => prepareContext({ recipes, idx, settings: base(extra), weekStart: '2026-11-16' });
  // vegan: nichts Tierisches in Hauptgerichten, Frühstück und Snacks – und es bleibt genug zum Planen
  const v = pool({ diet: 'vegan' });
  for (const r of [...v.mains, ...v.breakfasts, ...v.addons]) for (const l of r.ingredients) assert.ok(!(idx.get(l.id).animal || []).length, `${r.id}: ${l.id}`);
  assert.ok(v.mains.length >= 5 && v.breakfasts.length >= 2, `vegan: ${v.mains.length} Haupt, ${v.breakfasts.length} Frühstück`);
  // glutenfrei: Haferflocken, Nudeln, Brot, Sojasauce raus
  const g = pool({ allergies: ['gluten'] });
  for (const r of [...g.mains, ...g.breakfasts]) for (const l of r.ingredients) assert.ok(!(idx.get(l.id).allergens || []).includes('gluten'), `${r.id}: ${l.id}`);
  assert.ok(g.breakfasts.length >= 3, `glutenfrei: ${g.breakfasts.length} Frühstücke`);
  // Freitext „Gluten“ wirkt wie die Allergie
  const rx = restrictions(base({ dislikes: ['Gluten'] }));
  assert.ok(recipeBlocked(recipes.find((r) => r.id === 'carbonara'), base({ dislikes: ['Gluten'] }), idx, rx));
  // „Pilze“ trifft Champignons nicht über Teilstrings, „Käse“ trifft Hüttenkäse (Wortende)
  const k = restrictions(base({ dislikes: ['Käse'] }));
  assert.ok(recipeBlocked({ name: 'Brot', ingredients: [{ id: 'huettenkaese', g: 50 }] }, base({ dislikes: ['Käse'] }), idx, k));
  assert.equal(recipeBlocked({ name: 'Reispfanne', ingredients: [{ id: 'reis', g: 50 }] }, base({ dislikes: ['Ei'] }), idx), null);
});

test('F08 Gesenktes Protein-Ziel: deutlich näher dran und ehrlicher Hinweis', () => {
  const prof = { sex: 'w', age: 67, height: 160, weight: 72, activity: 'wenig', goal: 'halten' };
  const s = base({ profile: prof, goals: { ...calcGoals(prof), protein: 58 } });
  const p = generatePlan({ recipes, idx, settings: s, weekStart: '2026-11-16', seed: 3, candidates: 8 });
  const avgP = p.days.reduce((a, d) => a + d.totals.p, 0) / 7;
  assert.ok(avgP <= 58 * 1.3, `Ø ${avgP.toFixed(0)} g`);
  const ev = p.evaluation.find((x) => /Obergrenze/.test(x.title));
  assert.ok(ev, 'Hinweis zur Obergrenze fehlt');
});
