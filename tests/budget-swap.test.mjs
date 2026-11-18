import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildIndex } from '../js/nutrition.js';
import { generatePlan, overallGrade, swapMeal, weekBudget } from '../js/planner.js';
import { DEFAULT_SETTINGS } from '../js/settings.js';

const idx = buildIndex(JSON.parse(fs.readFileSync('data/ingredients.json', 'utf8')));
const recipes = JSON.parse(fs.readFileSync('data/recipes.json', 'utf8')).recipes;
const byId = new Map(recipes.map((r) => [r.id, r]));

test('Budget schrumpft mit den Tagen zu Hause', () => {
  const s = { ...structuredClone(DEFAULT_SETTINGS), budget: 60 };
  assert.equal(weekBudget(s, []), 60);
  assert.ok(weekBudget(s, [3, 4, 5, 6]) <= 32, `${weekBudget(s, [3, 4, 5, 6])} € für 3 Tage`);
  const full = generatePlan({ recipes, idx, settings: s, weekStart: '2026-11-16', seed: 1, candidates: 6 });
  const short = generatePlan({ recipes, idx, settings: s, weekStart: '2026-11-16', seed: 1, candidates: 6, away: [3, 4, 5, 6] });
  assert.ok(short.cost < full.cost * 0.7, `3 Tage ${short.cost.toFixed(2)} € vs. 7 Tage ${full.cost.toFixed(2)} €`);
});

test('Aufwendiges Gericht lässt sich auch gegen ein normales tauschen', () => {
  const s = structuredClone(DEFAULT_SETTINGS);
  const input = { recipes, idx, settings: s, weekStart: '2026-11-16' };
  const p = generatePlan({ ...input, seed: 2, candidates: 4 });
  const cook = p.structure.cooks.find((c) => byId.get(c.recipeId).effort === 3);
  assert.ok(cook, 'kein aufwendiges Gericht im Plan');
  const efforts = new Set();
  for (let i = 0; i < 12; i++) {
    const q = swapMeal(p, cook.portions[0], input);
    efforts.add(byId.get(q.structure.cooks.find((c) => c.portions.includes(cook.portions[0])).recipeId).effort === 3);
  }
  assert.ok(efforts.has(false), 'nur aufwendige Gerichte zur Auswahl');
});

test('Gesamtnote wohlwollend: eine B-Kategorie zieht die Woche nicht runter', () => {
  assert.equal(overallGrade([{ grade: 1 }, { grade: 1 }, { grade: 2 }, { grade: 2 }]), 1);
  assert.equal(overallGrade([{ grade: 3 }, { grade: 3 }]), 3);
});
