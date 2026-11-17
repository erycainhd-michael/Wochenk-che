import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildIndex } from '../js/nutrition.js';
import { generatePlan } from '../js/planner.js';
import { buildShopping, spiceNames } from '../js/shopping.js';
import { DEFAULT_SETTINGS } from '../js/settings.js';

test('Gewürz-Notizen werden zu einzelnen, einheitlichen Gewürzen', () => {
  assert.deepEqual(spiceNames('Salz, Pfeffer, Paprika edelsüß'), ['Salz', 'Pfeffer', 'Paprikapulver edelsüß']);
  assert.deepEqual(spiceNames('½ TL Salz für alle'), ['Salz']);
  assert.deepEqual(spiceNames('Ras el-Hanout (oder Zimt, Koriander)'), ['Ras el-Hanout']);
  assert.deepEqual(spiceNames('Essig fürs Pochierwasser'), []);
  assert.deepEqual(spiceNames('Muskat nach Geschmack; dazu Salz'), ['Muskat', 'Salz']);
});

test('Einkaufsliste nennt die Gewürze einzeln statt „Gewürze“', () => {
  const idx = buildIndex(JSON.parse(fs.readFileSync('data/ingredients.json', 'utf8')));
  const recipes = JSON.parse(fs.readFileSync('data/recipes.json', 'utf8')).recipes;
  const plan = generatePlan({ recipes, idx, settings: structuredClone(DEFAULT_SETTINGS), weekStart: '2026-11-16', seed: 1, candidates: 4 });
  const sh = buildShopping({ plan, idx, priceOf: (id) => ({ price: idx.get(id)?.price || 1, pack: idx.get(id)?.pack || 100 }), recipesById: new Map(recipes.map((r) => [r.id, r])) });
  assert.ok(!sh.staples.some((s) => s.id === 'gewuerze'), 'Sammelposten „Gewürze“ ist noch da');
  const sp = sh.staples.filter((s) => s.spice);
  assert.ok(sp.length >= 2, `nur ${sp.length} Gewürze`);
  assert.equal(sp[0].name, 'Salz');
  for (const s of sp) assert.ok(s.useRefs.length >= 1, `${s.name} ohne Gericht`);
});
