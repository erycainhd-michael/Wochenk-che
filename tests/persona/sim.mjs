// 26-Wochen-Simulation je Persona mit dem echten Planer (Node). Ausgabe: results.json
import fs from 'node:fs';
const R = new URL('../../', import.meta.url).pathname;
const { buildIndex } = await import(R + 'js/nutrition.js');
const { generatePlan, refitPlan, isReady } = await import(R + 'js/planner.js');
const { DEFAULT_SETTINGS, mergeSettings, calcGoals, ACTIVITY } = await import(R + 'js/settings.js');
const { mergeOffers } = await import(R + 'js/prices.js');
const { sportKcal } = await import(R + 'js/sport.js');
const { isoWeek, addDays } = await import(R + 'js/util.js');
const { PERSONAS, NUTS, GLUTEN, ANIMAL, PREGNANCY } = await import('./personas.mjs');
const ingData = JSON.parse(fs.readFileSync(R + 'data/ingredients.json', 'utf8'));
const idx = buildIndex(ingData);
const recipes = JSON.parse(fs.readFileSync(R + 'data/recipes.json', 'utf8')).recipes;
const byId = new Map(recipes.map((r) => [r.id, r]));
const offers = mergeOffers(JSON.parse(fs.readFileSync(R + 'data/offers.json', 'utf8')), []);
const TRUTH = { NUTS, GLUTEN, ANIMAL, PREGNANCY };
const WEEKS = Number(process.argv[2] || 26);
const only = process.argv[3];
const rng = (s) => () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const low = (s) => String(s || '').toLowerCase();
const hitTerms = (text, terms) => terms.filter((t) => new RegExp(`(^|[^a-zäöüß])${t}`, 'i').test(text) || (t.length > 4 && low(text).includes(t)));
const pal = (a) => ACTIVITY.find((x) => x[0] === a)[3];
const bmr = (p, w) => 10 * w + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161);
const badNum = (o, path = '') => {
  if (typeof o === 'number') return Number.isFinite(o) ? [] : [path];
  if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => badNum(v, path + '.' + k)).slice(0, 5);
  return [];
};
const out = [];
for (const P of PERSONAS.filter((x) => !only || x.id === only)) {
  const r = rng(Number(P.id.slice(1)) * 97);
  const profile = { sex: P.sex, age: P.age, height: P.height, weight: P.weight, activity: P.activity, goal: P.goal };
  const settings = mergeSettings({ ...structuredClone(DEFAULT_SETTINGS), profile, goals: calcGoals(profile), budget: P.budget, studi: !!P.studi, dislikes: P.dislikes || [], eatOut: (P.eatOut || []).map((day) => ({ day, slot: 'abend' })), goalWeight: P.goalWeight || null });
  if (P.proteinOverride) settings.goals.protein = P.proteinOverride;
  let weight = P.weight;
  let pantry = {};
  const plans = [];
  const weeks = [];
  for (let w = 0; w < WEEKS; w++) {
    const ws = addDays('2026-11-16', 7 * w);
    const away = P.shift ? [Math.floor(r() * 7)] : [];
    const recentRecipes = {};
    plans.slice(-2).forEach((pl, i, arr) => pl.cooks.forEach((c) => (recentRecipes[c.recipeId] = Math.min(recentRecipes[c.recipeId] || 9, arr.length - i))));
    const input = { recipes, idx, settings, weekStart: ws, offers, pantry, away, recentRecipes, weekNo: w };
    const t0 = Date.now();
    let plan;
    try {
      plan = generatePlan({ ...input, seed: 1000 + w * 31 + Number(P.id.slice(1)) });
    } catch (e) {
      weeks.push({ ws, crash: String(e.stack).slice(0, 400) });
      continue;
    }
    let taps = 0;
    if (P.people) {
      const people = {};
      for (const c of plan.structure.cooks) for (const k of c.portions) if (k.endsWith('abend')) { people[k] = P.people; taps += 2; }
      plan = refitPlan({ ...plan, structure: { ...plan.structure, people } }, input);
    }
    if (P.sportDays) {
      const sport = {};
      for (const d of P.sportDays) sport[d] = [{ type: 'kraft', level: 1, min: 75, kcal: sportKcal('kraft', 1, 75, weight) }];
      plan = refitPlan({ ...plan, structure: { ...plan.structure, sport } }, input);
    }
    const ms = Date.now() - t0;
    plans.push(plan);
    const days = plan.days.filter((d) => !d.away);
    const meals = days.flatMap((d) => d.meals.map((m) => ({ ...m, day: d.day })));
    // Invarianten
    const truthTerms = P.truth ? TRUTH[P.truth] : [];
    const forbidden = [];
    for (const m of meals) {
      if (m.kind !== 'recipe') continue;
      const rec = byId.get(m.recipeId);
      const texts = [rec?.name, ...(m.items || []).map((i) => idx.get(i.id)?.name)];
      for (const t of texts) {
        const h = hitTerms(t, truthTerms);
        if (h.length) forbidden.push(`${m.key} ${rec?.name}: „${t}“ (${h[0]})`);
      }
    }
    const kdev = days.map((d) => (d.totals.kcal - (d.goalKcal || settings.goals.kcal)) / (d.goalKcal || settings.goals.kcal));
    const pAvg = days.reduce((a, d) => a + d.totals.p, 0) / days.length;
    const kAvg = days.reduce((a, d) => a + d.totals.kcal, 0) / days.length;
    const mainMeals = meals.filter((m) => m.kind === 'recipe' && m.slot !== 'snack');
    const carbMax = Math.max(...mainMeals.map((m) => m.macros.c));
    const sugar = meals.filter((m) => (m.items || []).some((i) => /honig|zucker|schoko|zartbitter|nutella|sirup/i.test(idx.get(i.id)?.name || ''))).length;
    const short = [];
    for (const it of plan.shopping.items) {
      const ing = idx.get(it.id);
      if (it.have + it.packs * ing.pack < it.need - 0.06 * ing.pack - 1 && it.trip !== 2) short.push(`${it.id} braucht ${it.need}, hat ${it.have}+${it.packs}×${ing.pack}`);
    }
    const prev = plans[plans.length - 2];
    const repeats = prev ? plan.cooks.filter((c) => prev.cooks.some((x) => x.recipeId === c.recipeId)).map((c) => c.recipeId) : [];
    const ready = meals.filter((m) => isReady(byId.get(m.recipeId))).map((m) => m.recipeId);
    // Gewicht: Plan wird zu 100 % gegessen; echter Verbrauch aus aktuellem Gewicht
    const sportAvg = P.sportDays ? (P.sportDays.length * sportKcal('kraft', 1, 75, weight)) / 7 : 0;
    const tdee = bmr(P, weight) * pal(P.activity) + sportAvg;
    weight += ((kAvg - tdee) * 7) / 7700;
    const ramadanMeals = P.ramadan && ws >= '2027-02-08' && ws <= '2027-03-08' ? meals.filter((m) => ['fruehstueck', 'mittag', 'snack'].includes(m.slot)).length : 0;
    weeks.push({
      ws, kw: isoWeek(ws), ms, cost: +plan.cost.toFixed(2), budgetInfo: plan.budgetInfo, kAvg: Math.round(kAvg), goalK: settings.goals.kcal, pAvg: Math.round(pAvg), goalP: settings.goals.protein,
      daysOff5: kdev.filter((x) => Math.abs(x) > 0.05).length, minDay: Math.round(Math.min(...days.map((d) => d.totals.kcal))), forbidden: forbidden.slice(0, 8), forbiddenN: forbidden.length,
      nan: badNum(plan.days).concat(badNum(plan.shopping)), short: short.slice(0, 3), repeats, mains: new Set(plan.cooks.map((c) => c.recipeId)).size, ready, carbMax: Math.round(carbMax), sugar,
      pantryItems: Object.keys(pantry).length, pantryG: Math.round(Object.values(pantry).reduce((a, b) => a + b, 0)), weight: +weight.toFixed(1), bmi: +(weight / (P.height / 100) ** 2).toFixed(1), tdee: Math.round(tdee), taps, ramadanMeals,
      fancy: meals.filter((m) => m.slot === 'fruehstueck').map((m) => m.recipeId),
    });
    // Vorrat für nächste Woche wie in der App (autoStock: haltbar ≥ 180 Tage, ≥ 5 g) + bestätigte Reste (≤ 10 Tage haltbar fallen weg)
    pantry = {};
    for (const [id, g] of Object.entries(plan.shopping.leftovers || {})) {
      const ing = idx.get(id);
      if (ing && !ing.staple && ing.shelf >= 180 && g >= 5) pantry[id] = g;
    }
  }
  out.push({ persona: P, settings: { goals: settings.goals, budget: settings.budget }, weeks });
  const ok = weeks.filter((x) => !x.crash);
  console.log(`${P.id} ${P.name.padEnd(32)} kcal ${settings.goals.kcal} P ${settings.goals.protein} | Ø ${Math.round(ok.reduce((a, x) => a + x.cost, 0) / ok.length)}€/${P.budget}€ | verboten ${ok.reduce((a, x) => a + x.forbiddenN, 0)} | Tage>5% ${ok.reduce((a, x) => a + x.daysOff5, 0)} | Gewicht ${P.weight}→${ok.at(-1)?.weight} (BMI ${ok.at(-1)?.bmi}) | crash ${weeks.length - ok.length} | ${Math.round(ok.reduce((a, x) => a + x.ms, 0) / ok.length)}ms`);
}
fs.writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(out, null, 1));
