import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildIndex } from '../js/nutrition.js';
import { generatePlan } from '../js/planner.js';
import { DEFAULT_SETTINGS } from '../js/settings.js';
import { dietFromWeights, dietWeights, recipeBlocked, recipeClasses } from '../js/diet.js';

const idx = buildIndex(JSON.parse(fs.readFileSync('data/ingredients.json', 'utf8')));
const recipes = JSON.parse(fs.readFileSync('data/recipes.json', 'utf8')).recipes;
const byId = new Map(recipes.map((r) => [r.id, r]));
const mainsOf = (dw, budget = 90) => {
  const cnt = {};
  for (const seed of [1, 2, 3, 4]) {
    const s = { ...structuredClone(DEFAULT_SETTINGS), dietWeights: dw, budget };
    const p = generatePlan({ recipes, idx, settings: s, weekStart: '2026-11-16', seed, candidates: 6 });
    for (const c of p.cooks) {
      const r = byId.get(c.recipeId);
      if (r.type === 'main') for (const k of recipeClasses(r, idx)) cnt[k] = (cnt[k] || 0) + 1;
    }
  }
  return cnt;
};

test('Klassen: Paella mit Hähnchen und Garnelen zählt zu Geflügel und Fisch', () => {
  const r = { ingredients: [{ id: 'haehnchenbrust', g: 100 }, { id: 'garnelen', g: 50 }, { id: 'reis', g: 80 }] };
  assert.deepEqual([...recipeClasses(r, idx)].sort(), ['fisch', 'gefluegel']);
  assert.deepEqual([...recipeClasses({ ingredients: [{ id: 'tofu', g: 100 }] }, idx)], ['vegan']);
});

test('Ernährungsform ohne eigene Gewichte: Vegan = vegan oft, Tierisches nie', () => {
  const w = dietWeights({ diet: 'vegan' });
  assert.equal(w.vegan, 3);
  assert.equal(w.schwein, 0);
  assert.equal(dietFromWeights({ vegan: 2, vegetarisch: 2, fisch: 1, gefluegel: 0, rind: 0, schwein: 0 }), 'pescetarisch');
});

test('„nie“ sperrt die Klasse, Frühstück mit Joghurt bleibt bei „Vegetarisch: nie“', () => {
  const s = { ...structuredClone(DEFAULT_SETTINGS), dietWeights: { schwein: 0, vegetarisch: 0 } };
  assert.ok(recipeBlocked(byId.get('carbonara'), s, idx));
  const bf = recipes.find((r) => r.type === 'breakfast' && recipeClasses(r, idx).has('vegetarisch'));
  assert.equal(recipeBlocked(bf, s, idx), null);
  const cnt = mainsOf({ schwein: 0 });
  assert.equal(cnt.schwein || 0, 0);
});

test('„oft“ macht eine Ernährungsweise zur Hauptsache', () => {
  const normal = mainsOf({});
  const vegan = mainsOf({ vegan: 3 });
  const fish = mainsOf({ fisch: 3 });
  assert.ok((vegan.vegan || 0) >= 2 * (normal.vegan || 0), `vegan ${vegan.vegan} vs ${normal.vegan}`);
  assert.ok((fish.fisch || 0) >= 2 * Math.max(1, normal.fisch || 0), `fisch ${fish.fisch} vs ${normal.fisch}`);
});
