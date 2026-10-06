import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildIndex, plausibility } from '../js/nutrition.js';
import { generatePlan, swapMeal } from '../js/planner.js';
import { DEFAULT_SETTINGS } from '../js/settings.js';
import { makePriceFn, matchIngredient, parseGrams } from '../js/prices.js';
import { recipeWeights } from '../js/feedback.js';
import { mondayOf, berlinNow } from '../js/util.js';
import { shouldRunNow } from '../scripts/berlin-time.mjs';
import { mapOffers, normalizeEdeka } from '../scripts/fetch-offers.mjs';

const ingData = JSON.parse(fs.readFileSync('data/ingredients.json', 'utf8'));
const recipes = JSON.parse(fs.readFileSync('data/recipes.json', 'utf8')).recipes;
const idx = buildIndex(ingData);
const settings = () => structuredClone(DEFAULT_SETTINGS);
const plan = generatePlan({ recipes, idx, settings: settings(), weekStart: '2026-10-05', seed: 7 });

test('Kalorien: mindestens 6 von 7 Tagen im Bereich ±5 %', () => {
  const g = DEFAULT_SETTINGS.goals.kcal;
  const ok = plan.days.filter((d) => Math.abs(d.totals.kcal - g) / g <= 0.05).length;
  assert.ok(ok >= 6, `nur ${ok} Tage im Ziel`);
});

test('Protein: Tagesziel erreicht und jede Hauptmahlzeit mit Proteinquelle', () => {
  for (const d of plan.days) assert.ok(d.totals.p >= DEFAULT_SETTINGS.goals.protein * 0.95, `${d.name}: ${d.totals.p} g`);
  for (const d of plan.days)
    for (const m of d.meals.filter((x) => x.kind === 'recipe' && x.slot !== 'snack')) assert.ok(m.macros.p >= 20, `${m.recipeId} hat ${m.macros.p} g`);
});

test('Auswärtsessen sind eingeplant und ersetzen Mahlzeiten', () => {
  const eat = plan.days.flatMap((d) => d.meals.filter((m) => m.kind === 'eatout'));
  assert.equal(eat.length, DEFAULT_SETTINGS.eatOut.length);
  assert.ok(plan.days[4].meals.some((m) => m.slot === 'abend' && m.kind === 'eatout'));
});

test('Genau ein aufwendiges Gericht, am Wochenende', () => {
  const complex = plan.cooks.filter((c) => recipes.find((r) => r.id === c.recipeId).effort === 3);
  assert.equal(complex.length, 1);
  assert.ok(complex[0].day >= 5);
});

test('Abneigungen werden nicht eingeplant', () => {
  const s = settings();
  s.dislikes.push('Lachs');
  const p = generatePlan({ recipes, idx, settings: s, weekStart: '2026-10-05', seed: 3, candidates: 10 });
  const names = p.days.flatMap((d) => d.meals.filter((m) => m.recipeId).map((m) => recipes.find((r) => r.id === m.recipeId)));
  assert.ok(names.every((r) => !r.name.includes('Lachs') && !r.ingredients.some((l) => l.id.includes('lachs'))));
});

test('Saisonale Rezepte nur in der Saison (kein Spargel im Oktober)', () => {
  assert.ok(!plan.cooks.some((c) => c.recipeId === 'spargel_schinken'));
});

test('Einkaufsliste: ganze Packungen, Vermerk für welche Gerichte, Reste werden abgezogen', () => {
  for (const it of plan.shopping.items) {
    assert.ok(Number.isInteger(it.packs));
    assert.ok(it.uses.length > 0);
    assert.ok(it.packs * it.pack + it.have >= it.need * 0.95, it.name);
  }
  const p2 = generatePlan({ recipes, idx, settings: settings(), weekStart: '2026-10-05', seed: 7, pantry: { reis: 1000 } });
  const reis = p2.shopping.items.find((i) => i.id === 'reis');
  if (reis) assert.equal(reis.packs, 0);
});

test('Meal-Prep: Kochmenge = Summe der Portionen', () => {
  const prep = plan.cooks.find((c) => c.portions.length > 1);
  assert.ok(prep, 'mindestens ein Meal-Prep');
  const meals = prep.portions.map((p) => plan.days[p.day].meals.find((m) => m.key === p.key));
  const sumG = (id, items) => items.filter((i) => i.id === id).reduce((a, i) => a + i.g, 0);
  for (const it of prep.items) assert.ok(Math.abs(it.g - meals.reduce((a, m) => a + sumG(it.id, m.items), 0)) < 0.01);
});

test('Gericht tauschen ändert das Rezept und hält die Ziele', () => {
  const key = plan.cooks[0].portions[0].key;
  const next = swapMeal(plan, key, { recipes, idx, settings: settings(), weekStart: '2026-10-05' });
  assert.notEqual(next.cooks[0].recipeId, plan.cooks[0].recipeId);
  const d = next.days[plan.cooks[0].day];
  assert.ok(Math.abs(d.totals.kcal - 2800) / 2800 < 0.08);
});

test('Bewertung in deiner Prioritäten-Reihenfolge, ohne Verbotssprache', () => {
  assert.match(plan.evaluation[0].title, /Energie/);
  assert.match(plan.evaluation[1].title, /Protein/);
  assert.match(plan.evaluation[2].title, /Gemüse/);
  const text = JSON.stringify(plan.evaluation).toLowerCase();
  for (const bad of ['verboten', 'ungesund', 'vermeide', 'schlecht']) assert.ok(!text.includes(bad), bad);
});

test('Budget zu niedrig → klare Meldung', () => {
  const s = settings();
  s.budget = 25;
  const p = generatePlan({ recipes, idx, settings: s, weekStart: '2026-10-05', seed: 1, candidates: 8 });
  const b = p.evaluation.find((x) => x.title.startsWith('Einkauf'));
  assert.equal(b.level, 'warn');
  assert.ok(p.budgetInfo.missing > 0);
});

test('Feedback: 👍/„nochmal“ erhöht, 👎 senkt die Gewichtung, nie auf 0', () => {
  const w = recipeWeights([
    { weekStart: '2026-09-28', recipes: { carbonara: { rating: 1, again: true }, toast_hawaii: { rating: -1 } } },
    { weekStart: '2026-09-21', recipes: { toast_hawaii: { rating: -1 } } },
  ]);
  assert.ok(w.carbonara.weight > 1.5);
  assert.ok(w.toast_hawaii.weight < 0.5 && w.toast_hawaii.weight >= 0.15);
});

test('Plausibilitätscheck 4/4/9', () => {
  assert.ok(plausibility({ kcal: 2800, protein: 140, carbs: 350, fat: 90 }).ok);
  const bad = plausibility({ kcal: 2800, protein: 140, carbs: 200, fat: 60 });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /kcal/);
});

test('Angebote: Zuordnung und Umrechnung auf Packungsgröße', () => {
  assert.equal(matchIngredient('Frisches Hähnchenbrustfilet, 1 kg', ingData.items).id, 'haehnchenbrust');
  assert.equal(parseGrams('je 400-g-Packung'), 400);
  assert.equal(parseGrams('2 x 125 g'), 250);
  const raw = normalizeEdeka({ offers: [{ title: 'Hähnchenbrustfilet', descriptiion: '1-kg-Packung', price: { rawValue: 8.99 }, validTill: '2026-10-10' }, { title: 'Waschmittel', price: { rawValue: 3 } }] });
  const mapped = mapOffers(raw, 'edeka', ingData.items);
  assert.equal(mapped[0].ingredientId, 'haehnchenbrust');
  assert.equal(mapped[0].packPrice, 4.5);
  assert.equal(mapped[1].ingredientId, null);
  // Echtes Edeka-Format (docs/titel/preis/beschreibung/gueltig_bis)
  const real = normalizeEdeka({ docs: [{ titel: 'Frische Hähnchenbrustfilets', preis: 4.99, beschreibung: 'Teilstück, 500g', basicPrice: '1 kg = 9,98', gueltig_bis: 1791590400000 }], gueltig_von: 1791072000000 });
  const m2 = mapOffers(real, 'edeka', ingData.items);
  assert.equal(m2[0].ingredientId, 'haehnchenbrust');
  assert.equal(m2[0].packPrice, 4.99);
  assert.ok(m2[0].validTo.startsWith('2026-10'));
  const s = settings();
  const priceOf = makePriceFn({ idx, settings: s, offers: [{ store: 'edeka', ingredientId: 'haehnchenbrust', packPrice: 3.5, validTo: '2026-10-10' }], weekStart: '2026-10-05' });
  assert.equal(priceOf('haehnchenbrust').store, 'edeka');
  assert.equal(priceOf('haehnchenbrust').offer, true);
  assert.equal(priceOf('reis').store, 'lidl');
});

test('Zeitzone: Montag 9:00 Berlin, Sommer- und Winterzeit', () => {
  // Sommerzeit (5.10.2026): 07:00 UTC = 9:00 Berlin
  assert.equal(shouldRunNow('0 7 * * 1', new Date('2026-10-05T07:25:00Z'), 9), true);
  assert.equal(shouldRunNow('0 8 * * 1', new Date('2026-10-05T08:05:00Z'), 9), false);
  // Winterzeit (2.11.2026): 08:00 UTC = 9:00 Berlin
  assert.equal(shouldRunNow('0 7 * * 1', new Date('2026-11-02T07:25:00Z'), 9), false);
  assert.equal(shouldRunNow('0 8 * * 1', new Date('2026-11-02T08:40:00Z'), 9), true);
  // Wochenbeginn in Berliner Zeit (Sonntag 23:30 UTC = Montag 1:30 Berlin)
  assert.equal(mondayOf(new Date('2026-10-04T23:30:00Z')), '2026-10-05');
  assert.equal(berlinNow(new Date('2026-10-05T07:00:00Z')).hour, 9);
});

test('Auswärtsessen nachträglich ändern: Slot wird Pauschale bzw. wieder gekocht', async () => {
  const { setEatOut } = await import('../js/planner.js');
  const input = { recipes, idx, settings: settings(), weekStart: '2026-10-05' };
  const key = '2-abend';
  const out = setEatOut(plan, key, true, input);
  assert.equal(out.days[2].meals.find((m) => m.key === key).kind, 'eatout');
  assert.ok(!out.cooks.some((c) => c.portions.some((p) => p.key === key)));
  const back = setEatOut(out, key, false, input);
  assert.equal(back.days[2].meals.find((m) => m.key === key).kind, 'recipe');
  assert.ok(Math.abs(back.days[2].totals.kcal - 2800) / 2800 < 0.06);
});

test('Proteinpulver: nur eingeplant, wenn aktiviert', () => {
  const s = settings();
  s.proteinPowder = false;
  const p = generatePlan({ recipes, idx, settings: s, weekStart: '2026-10-05', seed: 5, candidates: 10 });
  assert.ok(!p.shopping.items.some((i) => i.id === 'proteinpulver'));
});
