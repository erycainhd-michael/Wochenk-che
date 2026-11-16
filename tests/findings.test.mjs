// Befunde aus der Persona-Tiefenprüfung (KW 47/2026). Jeder Test beschreibt das GEWÜNSCHTE Verhalten und
// schlägt mit dem heutigen Stand fehl. Sie laufen als „todo“: sichtbar im Testlauf, aber die Suite bleibt grün,
// bis der jeweilige Befund behoben ist – dann „todo“ entfernen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildIndex } from '../js/nutrition.js';
import { generatePlan, prepareContext, refitPlan } from '../js/planner.js';
import { DEFAULT_SETTINGS, calcGoals } from '../js/settings.js';

const idx = buildIndex(JSON.parse(fs.readFileSync('data/ingredients.json', 'utf8')));
const recipes = JSON.parse(fs.readFileSync('data/recipes.json', 'utf8')).recipes;
const base = (extra = {}) => ({ ...structuredClone(DEFAULT_SETTINGS), ...extra });
const mealsOf = (p) => p.days.flatMap((d) => d.meals.filter((m) => m.kind === 'recipe'));
const namesOf = (m) => [recipes.find((r) => r.id === m.recipeId)?.name || '', ...(m.items || []).map((i) => idx.get(i.id)?.name || '')].join(' ').toLowerCase();

test('F01 Kein Kaloriendefizit bei Untergewicht (BMI < 18,5)', { todo: 'Befund F01' }, () => {
  const g = calcGoals({ sex: 'w', age: 24, height: 170, weight: 47, activity: 'wenig', goal: 'abnehmen' });
  const maintain = calcGoals({ sex: 'w', age: 24, height: 170, weight: 47, activity: 'wenig', goal: 'halten' });
  assert.ok(g.kcal >= maintain.kcal, `BMI 16,3 bekommt ${g.kcal} statt mindestens ${maintain.kcal} kcal`);
});

test('F02 Minderjährige: kein Diät-Defizit', { todo: 'Befund F02' }, () => {
  const g = calcGoals({ sex: 'w', age: 15, height: 162, weight: 52, activity: 'mittel', goal: 'abnehmen' });
  const maintain = calcGoals({ sex: 'w', age: 15, height: 162, weight: 52, activity: 'mittel', goal: 'halten' });
  assert.ok(g.kcal >= maintain.kcal, `15-Jährige bekommt ${g.kcal} kcal Defizit-Ziel`);
});

test('F04 Allergie „Nüsse“ schließt Mandeln, Walnüsse und Erdnuss aus', { todo: 'Befund F04' }, () => {
  const p = generatePlan({ recipes, idx, settings: base({ dislikes: ['Nüsse'] }), weekStart: '2026-11-16', seed: 6, candidates: 6 });
  const hits = mealsOf(p).filter((m) => /mandel|walnu|erdnu|haselnu|cashew|pinienkern|pesto/.test(namesOf(m)));
  assert.equal(hits.length, 0, hits.map((m) => m.recipeId).join(', '));
});

test('F05 Abneigung „Ei“ trifft nur Eier, nicht Reis/Weißwein', { todo: 'Befund F05' }, () => {
  const all = prepareContext({ recipes, idx, settings: base(), weekStart: '2026-11-16' }).mains.length;
  const noEgg = prepareContext({ recipes, idx, settings: base({ dislikes: ['Ei'] }), weekStart: '2026-11-16' }).mains.length;
  assert.ok(noEgg >= all * 0.7, `nur noch ${noEgg} von ${all} Hauptgerichten`);
});

test('F07 Schwangerschaft: kein Räucherlachs, Rohschinken, Leber', { todo: 'Befund F07 – Einstellung fehlt' }, () => {
  // alles, was der Planer überhaupt einplanen darf (Hauptgerichte, Frühstück, Snacks)
  const ctx = prepareContext({ recipes, idx, settings: base({ pregnant: true }), weekStart: '2026-11-16' });
  const pool = [...ctx.mains, ...ctx.breakfasts, ...ctx.addons, ...ctx.snacks];
  const risky = pool.filter((r) => r.ingredients.some((l) => /räucherlachs|rohschinken|serrano|parma|leber/i.test(idx.get(l.id)?.name || '')));
  assert.equal(risky.length, 0, risky.map((r) => r.id).join(', '));
});

test('F08 Ärztlich gesenktes Protein-Ziel wird eingehalten (±15 %)', { todo: 'Befund F08' }, () => {
  const prof = { sex: 'w', age: 67, height: 160, weight: 72, activity: 'wenig', goal: 'halten' };
  const s = base({ profile: prof, goals: { ...calcGoals(prof), protein: 58 } });
  const p = generatePlan({ recipes, idx, settings: s, weekStart: '2026-11-16', seed: 3, candidates: 8 });
  for (const d of p.days) assert.ok(d.totals.p <= 58 * 1.15, `${d.name}: ${Math.round(d.totals.p)} g`);
});

test('F10 Mitesser: Budget-Hinweis wird nach dem Hinzufügen neu bewertet', { todo: 'Befund F10' }, () => {
  const s = base({ budget: 60 });
  const input = { recipes, idx, settings: s, weekStart: '2026-11-16' };
  const p = generatePlan({ ...input, seed: 2, candidates: 6 });
  const people = Object.fromEntries(p.structure.cooks.flatMap((c) => c.portions).filter((k) => k.endsWith('abend')).map((k) => [k, 4]));
  const q = refitPlan({ ...p, structure: { ...p.structure, people } }, input);
  assert.ok(q.cost <= 60 || q.budgetInfo, `${q.cost.toFixed(2)} € ohne Budget-Hinweis`);
});

test('F13 Auswärts-Abend passt zum Tagesziel (nicht pauschal 1.000 kcal)', { todo: 'Befund F13' }, () => {
  const prof = { sex: 'w', age: 37, height: 160, weight: 57, activity: 'wenig', goal: 'abnehmen' };
  const s = base({ profile: prof, goals: calcGoals(prof), eatOut: [{ day: 2, slot: 'abend' }] });
  const p = generatePlan({ recipes, idx, settings: s, weekStart: '2026-11-16', seed: 4, candidates: 6 });
  const d = p.days[2];
  assert.ok(d.totals.kcal <= d.goalKcal * 1.08, `${Math.round(d.totals.kcal)} kcal bei Ziel ${d.goalKcal}`);
});
