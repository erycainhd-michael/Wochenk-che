// Wochenplaner. Läuft komplett im Browser (und in Node für Tests).
//
// Ablauf:
//  1. buildStructure: wählt Frühstücke und Hauptgerichte (inkl. Meal-Prep, aufwendigem Gericht,
//     Resteverwertung, Angeboten, Vielfalt, Feedback) per gewichtetem Zufall.
//  2. finalizePlan: ergänzt bei Bedarf einen Proteinshake zum Frühstück und skaliert Portionen, sodass das Tagesziel ±5 % erreicht wird.
//  3. scorePlan: bewertet den Plan nach deinen Prioritäten (Kalorien > Protein > Gemüse/Ballaststoffe >
//     Vielfalt > Geschmack/Alltag > Feinschliff). Aus vielen Kandidaten gewinnt der beste.

import { DAY_NAMES, DAY_SHORT, SLOT_LABEL, addDays, avg, clamp, clone, mulberry32, pickWeighted, round, sum, euro, num } from './util.js';
import { addMacros, emptyMacros, hasFish, itemsMacros, mainProteinCategory, recipeItems, recipeMacros } from './nutrition.js';
import { itemsCost, makePriceFn } from './prices.js';
import { buildShopping } from './shopping.js';
import { fiberTargetFor } from './settings.js';
import { daySportKcal } from './sport.js';

const MAIN_SLOTS = ['mittag', 'abend'];

// ---------------------------------------------------------------------------
// Kontext vorbereiten
// ---------------------------------------------------------------------------

export function prepareContext(input) {
  const { recipes, idx, settings, weekStart } = input;
  const month = Number(weekStart.slice(5, 7));
  const dislikes = (settings.dislikes || []).map((d) => d.toLowerCase().trim()).filter(Boolean);
  const priceOf = input.priceOf || makePriceFn({ idx, settings, offers: input.offers || [], weekStart });
  const fbw = input.feedbackWeights || {};
  const exclude = new Set(input.exclude || []);
  // Tage, an denen man noch unterwegs ist (z. B. Urlaub bis Dienstag): kein Plan, kein Einkauf
  const away = [...new Set(input.away || [])].filter((d) => d >= 0 && d < 7).sort();

  const isDisliked = (r) => {
    const texts = [r.name, ...(r.contains || []), ...r.ingredients.map((l) => idx.get(l.id)?.name || '')].map((t) => t.toLowerCase());
    return dislikes.some((d) => texts.some((t) => t.includes(d)));
  };
  const inSeason = (r) => {
    if (r.season && !r.season.includes(month)) return false;
    return r.ingredients.every((l) => !idx.get(l.id)?.season || idx.get(l.id).season.includes(month));
  };

  const usable = recipes.filter((r) => inSeason(r) && !isDisliked(r) && (!r.requires || settings[r.requires]) && !exclude.has(r.id) && r.ingredients.every((l) => idx.has(l.id)));
  const info = new Map();
  for (const r of recipes) {
    const m = recipeMacros(r, idx, settings, 1);
    const items = r.ingredients.filter((l) => !l.opt || settings[l.opt]).map((l) => ({ id: l.id, g: l.g }));
    const { cost, offerShare } = itemsCost(items, idx, priceOf);
    const colors = new Set(r.ingredients.map((l) => idx.get(l.id)?.color).filter(Boolean));
    info.set(r.id, {
      macros: m,
      cost,
      offerShare,
      colors,
      protein: mainProteinCategory(r, idx),
      fish: hasFish(r, idx),
      pasta: r.ingredients.some((l) => idx.get(l.id)?.tags?.includes('pasta')),
      weight: fbw[r.id]?.weight ?? 1,
      tooComplex: fbw[r.id]?.tooComplex ?? 0,
    });
  }

  const byType = (t) => usable.filter((r) => r.type === t);
  const mains = byType('main');
  return {
    ...input,
    away,
    month,
    priceOf,
    info,
    recipesById: new Map(recipes.map((r) => [r.id, r])),
    mains,
    breakfasts: byType('breakfast'),
    addons: byType('addon'),
    avgMainCost: avg(mains, (r) => info.get(r.id).cost) || 3,
    fiberTarget: fiberTargetFor(settings),
    pantry: input.pantry || {},
    recentRecipes: input.recentRecipes || {},
  };
}

// ---------------------------------------------------------------------------
// 1. Struktur: welche Gerichte an welchen Tagen
// ---------------------------------------------------------------------------

const slotKey = (day, slot) => `${day}-${slot}`;

function eatOutSet(settings) {
  return new Set((settings.eatOut || []).map((e) => slotKey(e.day, e.slot)));
}

/** Simulierter Vorrat: wie viel einer Zutat ist durch angebrochene Packungen/Reste schon da? */
class Stock {
  constructor(pantry, idx, priceOf) {
    this.g = new Map(Object.entries(pantry).map(([k, v]) => [k, Number(v) || 0]));
    this.idx = idx;
    this.priceOf = priceOf;
  }
  evaluate(items) {
    let total = 0;
    let covered = 0;
    let waste = 0;
    for (const { id, g } of items) {
      const ing = this.idx.get(id);
      if (!ing || ing.staple) continue;
      const price = this.priceOf(id).price;
      const value = (g / ing.pack) * price;
      const have = this.g.get(id) || 0;
      total += value;
      covered += (Math.min(have, g) / ing.pack) * price;
      const missing = g - have;
      if (missing > 0) {
        const packs = Math.ceil(missing / ing.pack - 0.05);
        const left = Math.max(0, packs * ing.pack - missing);
        waste += (left / ing.pack) * price * (ing.shelf <= 10 ? 1 : 0.2);
      }
    }
    return { coverage: total ? covered / total : 0, waste };
  }
  consume(items) {
    for (const { id, g } of items) {
      const ing = this.idx.get(id);
      if (!ing || ing.staple) continue;
      const have = this.g.get(id) || 0;
      const missing = g - have;
      if (missing > 0) {
        const packs = Math.max(1, Math.ceil(missing / ing.pack - 0.05));
        this.g.set(id, Math.max(0, have + packs * ing.pack - g));
      } else {
        this.g.set(id, have - g);
      }
    }
  }
}

function baseItems(r, settings, portions = 1) {
  return r.ingredients.filter((l) => !l.opt || settings[l.opt]).map((l) => ({ id: l.id, g: l.g * portions }));
}

function complexSlots(settings, eatOut) {
  const prefs = [slotKey(6, 'abend'), slotKey(5, 'abend'), slotKey(6, 'mittag'), slotKey(5, 'mittag'), slotKey(4, 'abend'), slotKey(3, 'abend')];
  const out = new Set();
  for (const k of prefs) {
    if (out.size >= (settings.complexPerWeek || 0)) break;
    if (!eatOut.has(k)) out.add(k);
  }
  return out;
}

export function buildStructure(ctx, rng, mode = {}) {
  const { settings, idx, info } = ctx;
  const sl = settings.sliders;
  const simple = sl.simple / 100;
  const dishes = sl.dishes / 100;
  const offersW = sl.offers / 100;
  const variety = sl.variety / 100;
  const eatOut = eatOutSet(settings);
  for (const d of ctx.away || []) for (const slot of ['fruehstueck', ...MAIN_SLOTS]) eatOut.add(slotKey(d, slot));
  const complex = complexSlots(settings, eatOut);
  const stock = new Stock(ctx.pantry, idx, ctx.priceOf);
  const used = new Set();
  const usedColors = new Set();
  const recent = [];
  let pastaLast = false;
  const cooks = [];
  const covered = new Map();

  const weightOf = (r, { isLunch, isComplex }) => {
    const inf = info.get(r.id);
    let w = inf.weight;
    if (inf.tooComplex) w *= 1 / (1 + inf.tooComplex * (0.5 + simple));
    if (!isComplex) {
      // Feineinstellungen gelten für den Großteil der Gerichte, nicht für die aufwendigen
      const maxTime = simple >= 0.9 ? 15 : simple >= 0.5 ? 30 : 999;
      if (r.time > maxTime) w *= 0.25;
      w *= 1 - 0.4 * simple * clamp((r.time - 15) / 25, 0, 1);
      if (dishes >= 0.8 && r.dishes > 2) w *= 0.4;
      w *= 1 - 0.5 * dishes * clamp((r.dishes - 1) / 2, 0, 1);
    }
    if (isLunch) w *= 1 - 0.5 * clamp((r.time - 20) / 15, 0, 1);
    else if (r.mealPrep) w *= 1 + 2 * dishes + (mode.cheap ? 1.5 : 0);
    w *= 1 + 1.5 * offersW * inf.offerShare;
    if (recent.slice(-2).includes(inf.protein)) w *= 1 - 0.6 * variety;
    if (inf.pasta && pastaLast) w *= 1 - 0.5 * variety;
    const newColors = [...inf.colors].filter((c) => !usedColors.has(c)).length;
    w *= 1 + 0.12 * variety * newColors;
    const ev = stock.evaluate(baseItems(r, settings));
    w *= 1 + (mode.cheap ? 4 : 2) * ev.coverage;
    w *= 1 / (1 + 0.25 * ev.waste);
    // Ballaststoffe ausgewogen: sehr ballaststoffreiche Gerichte nicht gehäuft
    w *= Math.exp(-Math.max(0, inf.macros.fib - ctx.fiberTarget * 0.38) / 4);
    // Abwechslung über Wochen: kürzlich gekochte Gerichte seltener (außer mit „nochmal“-Feedback)
    const ago = ctx.recentRecipes[r.id];
    if (ago && inf.weight < 1.3) w *= 1 - variety * (ago === 1 ? 0.7 : 0.35);
    const costRatio = ctx.avgMainCost / Math.max(0.5, inf.cost);
    w *= Math.pow(costRatio, mode.cheap ? 2.5 : 0.3);
    return Math.max(0.001, w);
  };

  for (let d = 0; d < 7; d++) {
    for (const slot of MAIN_SLOTS) {
      const key = slotKey(d, slot);
      if (eatOut.has(key) || covered.has(key)) continue;
      const isComplex = complex.has(key);
      const isLunch = slot === 'mittag';
      let pool = ctx.mains.filter((r) => (isComplex ? r.effort === 3 : r.effort < 3));
      if (!pool.length) pool = ctx.mains.filter((r) => r.effort < 3);
      let fresh = pool.filter((r) => !used.has(r.id));
      if (!fresh.length) fresh = pool;
      const weights = fresh.map((r) => Math.pow(weightOf(r, { isLunch, isComplex }), 1.6));
      const r = pickWeighted(fresh, weights, rng);
      const portions = [key];
      if (r.mealPrep && slot === 'abend' && d < 6) {
        const partner = slotKey(d + 1, 'mittag');
        const prepProb = isComplex ? 1 : 0.2 + 0.75 * dishes;
        if (!eatOut.has(partner) && !covered.has(partner) && !complex.has(partner) && rng() < prepProb) portions.push(partner);
      }
      const cook = { id: `c${cooks.length + 1}`, recipeId: r.id, day: d, slot, portions };
      cooks.push(cook);
      for (const p of portions) covered.set(p, cook.id);
      used.add(r.id);
      const inf = info.get(r.id);
      inf.colors.forEach((c) => usedColors.add(c));
      recent.push(inf.protein);
      pastaLast = inf.pasta;
      stock.consume(baseItems(r, settings, portions.length));
    }
  }

  // Frühstück: 1–3 verschiedene Frühstücke im Wechsel (Vielfalt vs. weniger Packungen)
  const k = clamp(1 + Math.round(variety * 2), 1, Math.min(3, ctx.breakfasts.length));
  const chosen = [];
  let pool = [...ctx.breakfasts];
  for (let i = 0; i < k && pool.length; i++) {
    const weights = pool.map((r) => {
      const inf = info.get(r.id);
      const ev = stock.evaluate(baseItems(r, settings, 7 / k));
      return Math.pow(inf.weight * (1 + 1.5 * ev.coverage) * (1 + offersW * inf.offerShare) * (mode.cheap ? 1 / Math.max(0.5, inf.cost) : 1), 1.5);
    });
    const r = pickWeighted(pool, weights, rng);
    chosen.push(r.id);
    pool = pool.filter((x) => x.id !== r.id);
    stock.consume(baseItems(r, settings, 7 / k));
  }
  const breakfasts = Array.from({ length: 7 }, (_, d) => (eatOut.has(slotKey(d, 'fruehstueck')) ? null : chosen[d % chosen.length]));

  return { cooks, breakfasts, eatOut: [...eatOut], complex: [...complex], away: [...(ctx.away || [])] };
}

// ---------------------------------------------------------------------------
// 2. Portionen skalieren & Snacks wählen
// ---------------------------------------------------------------------------

function eatOutMacros(settings) {
  const kcal = settings.eatOutKcal || 1000;
  const p = settings.eatOutProtein || 35;
  const rest = kcal - p * 4;
  return { kcal, p, c: (rest * 0.55) / 4, f: (rest * 0.45) / 9, fib: 6, veg: 100 };
}

/** Ergänzungen zum Frühstück (z. B. Proteinshake): keine oder eine */
function addonCombos(addons) {
  return [[], ...addons.map((a) => [a])];
}

/** Tagesziele inkl. Sport: Mehrbedarf vor allem über Kohlenhydrate (≈60 %) und etwas Fett (≈25 %) */
function dayGoals(goals, extra) {
  if (!extra) return goals;
  return { ...goals, kcal: goals.kcal + extra, carbs: goals.carbs + (extra * 0.6) / 4, fat: goals.fat + (extra * 0.25) / 9 };
}

function fitDay({ ctx, fixed, breakfast, mains, combos, extra = 0 }) {
  const g = dayGoals(ctx.settings.goals, extra);
  const B = breakfast ? ctx.info.get(breakfast).macros : null;
  const M = mains.reduce((a, id) => addMacros(a, ctx.info.get(id).macros), emptyMacros());
  let best = null;
  for (const combo of combos) {
    let S = emptyMacros();
    let pref = 0;
    for (const s of combo) {
      const inf = ctx.info.get(s.id);
      S = addMacros(S, inf.macros);
      // Proteinpulver nur, wenn es wirklich hilft – Ergänzung, keine Grundlage
      pref += 0.04 + 0.03 * inf.cost;
    }
    const R = g.kcal - fixed.kcal - S.kcal;
    let fb = 1;
    let fm = 1;
    if (B && M.kcal > 0) {
      const f0 = R / (B.kcal + M.kcal);
      fb = round(clamp(f0, 0.8, 1.4), 0.05);
      fm = round(clamp((R - B.kcal * fb) / M.kcal, 0.7, 1.7), 0.05);
    } else if (M.kcal > 0) {
      fm = round(clamp(R / M.kcal, 0.7, 1.7), 0.05);
    } else if (B) {
      fb = round(clamp(R / B.kcal, 0.8, 1.6), 0.05);
    }
    let T = addMacros(addMacros(fixed, S), M, fm);
    if (B) T = addMacros(T, B, fb);
    const kErr = Math.abs(T.kcal - g.kcal) / g.kcal;
    const pShort = Math.max(0, (g.protein - T.p) / g.protein);
    const pOver = Math.max(0, (T.p - 1.1 * g.protein) / g.protein);
    const cErr = Math.abs(T.c - g.carbs) / g.carbs;
    const fErr = Math.abs(T.f - g.fat) / g.fat;
    const fibOver = Math.max(0, T.fib - ctx.fiberTarget - 3) / ctx.fiberTarget;
    const cost = 5 * Math.max(0, kErr - 0.03) + kErr + 4 * pShort + 3 * pOver + 0.6 * cErr + 0.6 * fErr + 3 * fibOver + 0.03 * combo.length + pref;
    if (!best || cost < best.cost) best = { cost, fb, fm, addons: combo.map((s) => s.id) };
  }
  return best;
}

/**
 * Reste-Ausgleich: Angebrochene, schnell verderbliche Packungen (z. B. Skyr, Feta, Spinat) werden
 * auf Mahlzeiten verteilt, die diese Zutat ohnehin enthalten (max. +40 % je Mahlzeit), solange der
 * Tag im Kalorienziel +5 % bleibt. So bleibt weniger übrig, ohne zusätzliche Einkäufe.
 */
function absorbLeftovers(days, ctx) {
  const { idx, settings } = ctx;
  const need = new Map();
  for (const d of days) for (const m of d.meals) for (const it of m.items || []) need.set(it.id, (need.get(it.id) || 0) + it.g);
  const leftovers = [];
  for (const [id, g] of need) {
    const ing = idx.get(id);
    if (!ing || ing.staple || ing.shelf > 10 || ing.protein === 'Ei') continue;
    const have = ctx.pantry[id] || 0;
    const toBuy = g - have;
    const packs = toBuy <= 0 ? 0 : Math.max(1, Math.ceil((toBuy - 0.05 * ing.pack) / ing.pack));
    const left = have + packs * ing.pack - g;
    if (left > 5) leftovers.push({ ing, left });
  }
  leftovers.sort((a, b) => a.ing.kcal - b.ing.kcal);
  for (const lo of leftovers) {
    for (const d of days) {
      for (const m of d.meals) {
        if (lo.left <= 5 || m.kind !== 'recipe') continue;
        const it = m.items.find((x) => x.id === lo.ing.id);
        if (!it) continue;
        const room = ((d.goalKcal || settings.goals.kcal) * 1.02 - d.totals.kcal) / (lo.ing.kcal / 100 || 0.01);
        const add = Math.floor(Math.min(lo.left, it.g * 0.4, Math.max(0, room)));
        if (add < 5) continue;
        it.g += add;
        it.extra = (it.extra || 0) + add;
        lo.left -= add;
        const delta = itemsMacros([{ id: lo.ing.id, g: add }], idx);
        m.macros = addMacros(m.macros, delta);
        d.totals = addMacros(d.totals, delta);
        const { cost } = itemsCost([{ id: lo.ing.id, g: add }], idx, ctx.priceOf);
        m.cost += cost;
        d.cost += cost;
      }
    }
  }
}

export function finalizePlan(structure, ctx) {
  const { settings, idx, weekStart } = ctx;
  const eatOut = new Set(structure.eatOut);
  const eo = eatOutMacros(settings);
  const slotCook = new Map();
  for (const c of structure.cooks) for (const p of c.portions) slotCook.set(p, c);
  const addonCombosAll = addonCombos(ctx.addons);

  const away = new Set(structure.away || []);
  const days = [];
  for (let d = 0; d < 7; d++) {
    if (away.has(d)) {
      days.push({ day: d, date: addDays(weekStart, d), name: DAY_NAMES[d], short: DAY_SHORT[d], away: true, sportKcal: 0, goalKcal: 0, meals: [], totals: emptyMacros(), cost: 0 });
      continue;
    }
    let fixed = emptyMacros();
    for (const slot of ['fruehstueck', ...MAIN_SLOTS]) if (eatOut.has(slotKey(d, slot))) fixed = addMacros(fixed, eo);
    const breakfast = structure.breakfasts[d];
    const mains = MAIN_SLOTS.map((s) => slotCook.get(slotKey(d, s))?.recipeId).filter(Boolean);
    const sportKcal = daySportKcal(structure, d);
    const fit = fitDay({ ctx, fixed, breakfast, mains, combos: breakfast ? addonCombosAll : [[]], extra: sportKcal });

    const meals = [];
    const mk = (slot, recipeId, factor, extra = {}) => {
      const r = ctx.recipesById.get(recipeId);
      const items = recipeItems(r, factor, settings, idx);
      const macros = itemsMacros(items, idx);
      const { cost } = itemsCost(items, idx, ctx.priceOf);
      return { key: slotKey(d, slot), slot, kind: 'recipe', recipeId, factor, items, macros, cost, ...extra };
    };
    const eatOutMeal = (slot) => ({ key: slotKey(d, slot), slot, kind: 'eatout', macros: { ...eo }, cost: 0 });

    if (eatOut.has(slotKey(d, 'fruehstueck'))) meals.push(eatOutMeal('fruehstueck'));
    else if (breakfast) {
      const m = mk('fruehstueck', breakfast, fit.fb);
      for (const a of fit.addons) {
        const items = recipeItems(ctx.recipesById.get(a), 1, settings, idx);
        m.items = [...m.items, ...items.map((it) => ({ ...it, addon: a }))];
        m.macros = addMacros(m.macros, itemsMacros(items, idx));
        m.cost += itemsCost(items, idx, ctx.priceOf).cost;
        (m.addons ||= []).push(a);
      }
      meals.push(m);
    }
    for (const slot of MAIN_SLOTS) {
      const key = slotKey(d, slot);
      if (eatOut.has(key)) meals.push(eatOutMeal(slot));
      else {
        const c = slotCook.get(key);
        if (c) meals.push(mk(slot, c.recipeId, fit.fm, { cookId: c.id, leftover: c.portions[0] !== key }));
      }
    }

    const totals = meals.reduce((a, m) => addMacros(a, m.macros), emptyMacros());
    days.push({
      day: d,
      date: addDays(weekStart, d),
      name: DAY_NAMES[d],
      sportKcal,
      goalKcal: settings.goals.kcal + sportKcal,
      short: DAY_SHORT[d],
      meals,
      totals,
      cost: sum(meals, (m) => m.cost || 0),
    });
  }

  absorbLeftovers(days, ctx);

  // Kochvorgänge: Gesamtmengen (z. B. Abendessen + Reste für Mittag)
  const cooks = structure.cooks.map((c) => {
    const portions = c.portions.map((key) => {
      const [d, slot] = key.split('-');
      const meal = days[Number(d)].meals.find((m) => m.key === key);
      return { key, day: Number(d), slot, factor: meal?.factor || 1, items: meal?.items || [] };
    });
    const merged = new Map();
    for (const p of portions)
      for (const it of p.items) {
        const e = merged.get(it.id) || { id: it.id, g: 0, extra: 0, note: it.note };
        e.g += it.g;
        e.extra += it.extra || 0;
        merged.set(it.id, e);
      }
    return {
      ...c,
      portions: portions.map(({ items, ...p }) => p),
      totalFactor: sum(portions, (p) => p.factor),
      items: [...merged.values()],
    };
  });

  const plan = {
    version: 1,
    weekStart,
    createdAt: new Date().toISOString(),
    fiberTarget: ctx.fiberTarget,
    goals: { ...settings.goals },
    structure,
    days,
    cooks,
  };
  plan.shopping = buildShopping({ plan, idx, pantry: ctx.pantry, priceOf: ctx.priceOf, recipesById: ctx.recipesById });
  plan.cost = plan.shopping.total;
  plan.score = scorePlan(plan, ctx);
  return plan;
}

// ---------------------------------------------------------------------------
// 3. Bewertung nach deinen Prioritäten
// ---------------------------------------------------------------------------

export function scorePlan(plan, ctx) {
  const { settings, idx } = ctx;
  const g = settings.goals;
  // Nur Tage mit Plan zählen (Tage „unterwegs“ bleiben außen vor)
  const days = plan.days.filter((d) => !d.away);
  const s = {};

  // 1. Kalorien (25)
  const target = (d) => d.goalKcal || g.kcal;
  const kDev = avg(days, (d) => Math.abs(d.totals.kcal - target(d)) / target(d));
  const daysInRange = days.filter((d) => Math.abs(d.totals.kcal - target(d)) / target(d) <= 0.05).length;
  s.kcal = 25 * (0.6 * clamp(1 - kDev / 0.1, 0, 1) + 0.4 * (daysInRange / days.length));

  // 2. Protein inkl. Verteilung (20)
  const pRatio = avg(days, (d) => Math.min(1, d.totals.p / g.protein));
  const mainMeals = days.flatMap((d) => d.meals.filter((m) => m.kind === 'recipe' && m.slot !== 'snack'));
  const distr = mainMeals.length ? mainMeals.filter((m) => m.macros.p >= 25).length / mainMeals.length : 0;
  s.protein = 20 * (0.7 * clamp((pRatio - 0.85) / 0.15, 0, 1) + 0.3 * distr);

  // 3. Gemüse/Obst & Ballaststoffe (20)
  const veg = avg(days, (d) => d.totals.veg);
  const fib = avg(days, (d) => d.totals.fib);
  const ft = plan.fiberTarget;
  const fibScore = fib < ft ? clamp(fib / ft, 0, 1) : clamp(1 - (fib - ft - 3) / 8, 0, 1);
  s.plants = 12 * clamp(veg / 400, 0, 1) + 8 * fibScore;

  // 4. Vielfalt & Nährstoffdichte über die Woche (15)
  const plantIds = new Set();
  const colors = new Set();
  const proteins = new Set();
  let fishCooks = 0;
  for (const d of days)
    for (const m of d.meals)
      for (const it of m.items || []) {
        const ing = idx.get(it.id);
        if (!ing || ing.staple) continue;
        if (ing.tags?.some((t) => ['gemuese', 'obst', 'nuss', 'vollkorn', 'huelsenfrucht', 'kartoffel'].includes(t))) plantIds.add(it.id);
        if (ing.color) colors.add(ing.color);
        if (ing.protein && it.g >= 50) proteins.add(ing.protein);
      }
  for (const c of plan.cooks) if (ctx.info.get(c.recipeId)?.fish) fishCooks++;
  s.variety = 6 * clamp(plantIds.size / 22, 0, 1) + 4 * clamp(proteins.size / 5, 0, 1) + 3 * clamp(fishCooks / 2, 0, 1) + 2 * clamp(colors.size / 6, 0, 1);

  // 5. Geschmack & Alltag (10)
  const ids = [...plan.cooks.map((c) => c.recipeId), ...new Set(plan.structure.breakfasts.filter(Boolean))];
  const taste = avg(ids, (id) => clamp(ctx.info.get(id).weight / 1.5, 0, 1));
  const normal = plan.cooks.filter((c) => !plan.structure.complex.includes(c.portions[0].key));
  const avgTime = avg(normal, (c) => ctx.recipesById.get(c.recipeId).time) || 20;
  const avgDishes = avg(normal, (c) => ctx.recipesById.get(c.recipeId).dishes) || 1;
  const sl = settings.sliders;
  s.taste =
    6 * taste +
    2 * (1 - (sl.simple / 100) * clamp((avgTime - 15) / 20, 0, 1)) +
    2 * (1 - (sl.dishes / 100) * clamp((plan.cooks.length * avgDishes - 6) / 14, 0, 1));

  // 6. Fettqualität/-menge (5) & 7. Energie im Alltag (5)
  const kcal = sum(days, (d) => d.totals.kcal);
  const fatPct = kcal ? (sum(days, (d) => d.totals.f) * 9) / kcal : 0.3;
  s.balance = 5 * clamp(1 - Math.max(0, Math.abs(fatPct - 0.3) - 0.05) / 0.1, 0, 1);
  const lunches = days.flatMap((d) => d.meals.filter((m) => m.slot === 'mittag' && m.kind === 'recipe'));
  s.energy = 5 * (lunches.length ? lunches.filter((m) => m.macros.f <= 35).length / lunches.length : 1);

  // Abzüge: Budget und verderbliche Reste
  // Haltbarer Vorrat (Reis, Nudeln …) zählt nur teilweise, er wird in den Folgewochen verbraucht
  const over = Math.max(0, budgetCost(plan) - settings.budget);
  s.budgetPenalty = -2.5 * over;
  s.wastePenalty = -0.6 * plan.shopping.wasteEuro;

  const total = Object.values(s).reduce((a, b) => a + b, 0);
  return {
    total,
    parts: s,
    stats: { kDev, daysInRange, pRatio, distr, veg, fib, fiberTarget: ft, plants: plantIds.size, proteins: [...proteins], fishCooks, colors: colors.size, fatPct, avgTime },
  };
}

// ---------------------------------------------------------------------------
// Hauptfunktion
// ---------------------------------------------------------------------------

/** Für die Budget-Bewertung zählt haltbarer Vorrat nur zu 25 % (er wird in den Folgewochen verbraucht). */
export const budgetCost = (plan) => plan.cost - 0.5 * (plan.shopping?.stockEuro || 0);

export function generatePlan(input) {
  const ctx = prepareContext(input);
  const seed = input.seed ?? (Date.now() & 0x7fffffff);
  const n = input.candidates ?? 40;
  const all = [];
  for (let i = 0; i < n; i++) {
    const rng = mulberry32(seed + i * 7919);
    all.push(finalizePlan(buildStructure(ctx, rng), ctx));
  }
  let best = all.reduce((a, b) => (b.score.total > a.score.total ? b : a));
  let budgetInfo = null;

  if (budgetCost(best) > input.settings.budget) {
    // Spar-Modus: günstigere Rezepte bevorzugen
    for (let i = 0; i < n; i++) {
      const rng = mulberry32(seed + 104729 + i * 7919);
      all.push(finalizePlan(buildStructure(ctx, rng, { cheap: true }), ctx));
    }
    const within = all.filter((p) => budgetCost(p) <= input.settings.budget && p.score.stats.pRatio >= 0.93 && p.score.stats.kDev <= 0.06);
    if (within.length) best = within.reduce((a, b) => (b.score.total > a.score.total ? b : a));
    else {
      const cheapest = all.reduce((a, b) => (b.cost < a.cost ? b : a));
      budgetInfo = { cheapest: cheapest.cost, missing: cheapest.cost - input.settings.budget };
      best = all.reduce((a, b) => (b.score.total > a.score.total ? b : a));
    }
  }

  best.seed = seed;
  best.weekNo = input.weekNo || 0;
  best.pantryUsed = { ...ctx.pantry };
  best.budgetInfo = budgetInfo;
  best.evaluation = evaluatePlan(best, ctx);
  return best;
}

/**
 * Markiert eine Mahlzeit dieser Woche als „auswärts“ (oder wieder als „zu Hause“), ohne den Rest
 * des Plans umzuwerfen. Portionen und Einkaufsliste werden neu berechnet.
 */
export function setEatOut(plan, mealKey, on, input) {
  const ctx = prepareContext({ ...input, pantry: plan.pantryUsed || input.pantry, weekNo: plan.weekNo });
  const structure = clone(plan.structure);
  const [dStr, slot] = mealKey.split('-');
  const d = Number(dStr);
  const eat = new Set(structure.eatOut);
  if (on) {
    eat.add(mealKey);
    if (slot === 'fruehstueck') structure.breakfasts[d] = null;
    else {
      for (const c of structure.cooks) c.portions = c.portions.filter((k) => k !== mealKey);
      structure.cooks = structure.cooks.filter((c) => c.portions.length);
    }
  } else {
    eat.delete(mealKey);
    const rng = mulberry32((Date.now() & 0xffff) + d);
    if (slot === 'fruehstueck') {
      const counts = {};
      structure.breakfasts.filter(Boolean).forEach((id) => (counts[id] = (counts[id] || 0) + 1));
      structure.breakfasts[d] = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ctx.breakfasts[0]?.id || null;
    } else {
      const usedIds = new Set(structure.cooks.map((c) => c.recipeId));
      let pool = ctx.mains.filter((r) => r.effort < 3 && !usedIds.has(r.id));
      if (!pool.length) pool = ctx.mains.filter((r) => r.effort < 3);
      const r = pickWeighted(pool, pool.map((x) => Math.pow(ctx.info.get(x.id).weight, 1.5) / Math.max(0.5, ctx.info.get(x.id).cost)), rng);
      structure.cooks.push({ id: `c${Date.now().toString(36)}`, recipeId: r.id, day: d, slot, portions: [mealKey] });
      structure.cooks.sort((a, b) => a.day - b.day || (a.slot === 'mittag' ? -1 : 1));
    }
  }
  structure.eatOut = [...eat];
  const next = finalizePlan(structure, ctx);
  Object.assign(next, { seed: plan.seed, weekNo: plan.weekNo, pantryUsed: plan.pantryUsed, createdAt: plan.createdAt, done: plan.done || {} });
  next.evaluation = evaluatePlan(next, ctx);
  return next;
}

/**
 * Gleiche Gerichte, neu berechnet – z. B. nach geänderten Tageszielen oder Läden:
 * Portionsgrößen, Makros und Einkaufsliste passen sich an, die Rezeptauswahl bleibt.
 */
export function refitPlan(plan, input) {
  const ctx = prepareContext({ ...input, pantry: plan.pantryUsed || input.pantry, weekNo: plan.weekNo });
  const next = finalizePlan(clone(plan.structure), ctx);
  Object.assign(next, { seed: plan.seed, weekNo: plan.weekNo, pantryUsed: plan.pantryUsed, createdAt: plan.createdAt, done: plan.done || {} });
  next.evaluation = evaluatePlan(next, ctx);
  return next;
}

/** Ersetzt ein Gericht (Hauptgericht-Kochvorgang oder Frühstück) und berechnet den Plan neu. */
export function swapMeal(plan, mealKey, input, chosenId = null) {
  const ctx = prepareContext({ ...input, pantry: plan.pantryUsed || input.pantry, weekNo: plan.weekNo });
  const structure = clone(plan.structure);
  const rng = mulberry32((Date.now() & 0xffff) + mealKey.length);
  const [dStr, slot] = mealKey.split('-');
  const d = Number(dStr);
  if (slot === 'fruehstueck') {
    const current = structure.breakfasts[d];
    const pool = ctx.breakfasts.filter((r) => r.id !== current);
    if (chosenId) structure.breakfasts[d] = chosenId;
    else if (!pool.length) return plan;
    else structure.breakfasts[d] = pickWeighted(pool, pool.map((r) => ctx.info.get(r.id).weight), rng).id;
  } else {
    const cook = structure.cooks.find((c) => c.portions.includes(mealKey));
    if (!cook) return plan;
    const old = ctx.recipesById.get(cook.recipeId);
    const usedIds = new Set(structure.cooks.map((c) => c.recipeId));
    let pool = ctx.mains.filter((r) => !usedIds.has(r.id) && (old.effort === 3 ? r.effort === 3 : r.effort < 3) && (cook.portions.length === 1 || r.mealPrep));
    if (!pool.length) pool = ctx.mains.filter((r) => r.id !== old.id && (cook.portions.length === 1 || r.mealPrep));
    if (chosenId) cook.recipeId = chosenId;
    else if (!pool.length) return plan;
    else cook.recipeId = pickWeighted(pool, pool.map((r) => Math.pow(ctx.info.get(r.id).weight, 1.5)), rng).id;
  }
  const next = finalizePlan(structure, ctx);
  next.seed = plan.seed;
  next.weekNo = plan.weekNo;
  next.pantryUsed = plan.pantryUsed;
  next.createdAt = plan.createdAt;
  next.evaluation = evaluatePlan(next, ctx);
  return next;
}

// ---------------------------------------------------------------------------
// Bewertungstexte (Ergänzen statt Verbieten, keine Moralisierung)
// ---------------------------------------------------------------------------

export function evaluatePlan(plan, ctx) {
  const g = ctx.settings.goals;
  const st = plan.score.stats;
  const out = [];
  const active = plan.days.filter((d) => !d.away);
  const nDays = active.length;
  const avgK = avg(active, (d) => d.totals.kcal);
  const avgP = avg(active, (d) => d.totals.p);
  const avgC = avg(active, (d) => d.totals.c);
  const avgF = avg(active, (d) => d.totals.f);

  // 1. Kalorien
  out.push({
    level: st.daysInRange >= nDays - 1 ? 'ok' : 'hint',
    title: `Energie: Ø ${num(avgK)} kcal/Tag`,
    text:
      st.daysInRange >= nDays - 1
        ? `Ziel ${num(g.kcal)} kcal – ${st.daysInRange} von ${nDays} Tagen liegen im Bereich ±5 %. Genug Energie für Muskelaufbau.`
        : `${st.daysInRange} von ${nDays} Tagen liegen im Bereich ±5 %. An den anderen Tagen hilft eine etwas größere Portion oder eine Banane mit Erdnussmus zwischendurch.`,
  });

  // 2. Protein
  const lowMeals = plan.days.flatMap((d) => d.meals.filter((m) => m.kind === 'recipe' && m.slot !== 'snack' && m.macros.p < 25).map((m) => `${d.short} ${ctx.recipesById.get(m.recipeId).name}`));
  out.push({
    level: st.pRatio >= 0.97 ? 'ok' : 'hint',
    title: `Protein: Ø ${num(avgP)} g/Tag`,
    text:
      (st.pRatio >= 0.97 ? `Ziel ${g.protein} g erreicht. ` : `Etwas unter dem Ziel von ${g.protein} g – ein Proteinshake oder Skyr zum Frühstück gleicht das leicht aus. `) +
      (lowMeals.length ? `Mahlzeiten mit weniger als 25 g: ${lowMeals.slice(0, 3).join(', ')}${lowMeals.length > 3 ? ' …' : ''}.` : 'Jede Hauptmahlzeit hat mindestens 25 g – gut über den Tag verteilt.'),
  });

  // 3. Gemüse, Obst, Ballaststoffe
  out.push({
    level: st.veg >= 380 && Math.abs(st.fib - st.fiberTarget) <= 6 ? 'ok' : 'hint',
    title: `Gemüse & Obst: Ø ${num(st.veg)} g/Tag · Ballaststoffe Ø ${num(st.fib)} g`,
    text:
      (st.veg >= 380 ? 'Gute Menge an Gemüse und Obst. ' : 'Ergänzen lässt sich leicht: eine Handvoll Cherrytomaten zum Abendessen oder ein Apfel zum Frühstück. ') +
      `Ballaststoffe: ausgewogen um ca. ${st.fiberTarget} g pro Tag – über die Woche verteilt, nicht gehäuft.` +
      (st.fib > st.fiberTarget + 6 ? ' Diese Woche etwas mehr – viel trinken hilft.' : ''),
  });

  // 4. Vielfalt
  out.push({
    level: st.plants >= 20 && st.proteins.length >= 4 ? 'ok' : 'hint',
    title: `Vielfalt: ${st.plants} pflanzliche Lebensmittel, ${st.proteins.length} Proteinquellen`,
    text: `Proteinquellen: ${st.proteins.join(', ')}. Fischgerichte: ${st.fishCooks}.` + (st.fishCooks < 1 ? ' Ein Fischgericht (z. B. Lachs-Bowl) würde die Woche noch abrunden.' : ''),
  });

  // 5. Alltag
  const prepCount = plan.cooks.filter((c) => c.portions.length > 1).length;
  out.push({
    level: 'ok',
    title: `Alltag: ${plan.cooks.length}× kochen, davon ${prepCount}× mit Rest für den nächsten Tag`,
    text: `Ø ${num(st.avgTime)} Min. pro Gericht.` + (plan.structure.complex.length ? ' Ein aufwendigeres Gericht liegt am Wochenende.' : ''),
  });

  // Makro-Feinschliff
  const cDev = (avgC - g.carbs) / g.carbs;
  const fDev = (avgF - g.fat) / g.fat;
  if (Math.abs(cDev) > 0.12 || Math.abs(fDev) > 0.15) {
    out.push({
      level: 'hint',
      title: `Makros: Ø ${num(avgC)} g Kohlenhydrate · ${num(avgF)} g Fett`,
      text:
        fDev > 0.15
          ? 'Etwas mehr Fett als geplant – kein Problem. Wer mag, nimmt bei Sahnesaucen halb Skyr.'
          : cDev < -0.12
            ? 'Etwas weniger Kohlenhydrate als geplant – eine Scheibe Brot oder etwas mehr Reis/Kartoffeln ergänzt das.'
            : 'Makros weichen leicht vom Ziel ab, die Kalorien passen aber.',
    });
  }

  // Budget
  const b = ctx.settings.budget;
  const stock = plan.shopping.stockEuro;
  if (plan.cost <= b) {
    out.push({ level: 'ok', title: `Einkauf: ca. ${euro(plan.cost)}`, text: `Budget ${euro(b)} eingehalten (Vorratsartikel wie Öl und Gewürze nicht eingerechnet).` });
  } else if (budgetCost(plan) <= b) {
    out.push({
      level: 'hint',
      title: `Einkauf: ca. ${euro(plan.cost)} – davon ${euro(stock)} Vorrat`,
      text: `Der Kassenbon liegt diese Woche ${euro(plan.cost - b)} über ${euro(b)}, weil haltbare Packungen (z. B. Reis, Nudeln, Haferflocken, Nüsse) nicht ganz aufgebraucht werden. Diese Reste schlägt dir die App nächsten Montag vor – dann wird der Einkauf entsprechend günstiger. Was du diese Woche tatsächlich verbrauchst: ca. ${euro(plan.cost - stock)}.`,
    });
  } else {
    const info = plan.budgetInfo;
    out.push({
      level: 'warn',
      title: `Einkauf: ca. ${euro(plan.cost)} – ${euro(plan.cost - b)} über Budget`,
      text:
        (info
          ? `Mit ${euro(b)} lassen sich deine Ziele (${num(g.kcal)} kcal, ${g.protein} g Protein) mit den aktuellen Rezepten nicht ganz erreichen – der günstigste gefundene Plan kostet ${euro(info.cheapest)}. `
          : '') +
        'Möglichkeiten: Budget anheben, den Regler „Angebote berücksichtigen“ erhöhen, Reste der Vorwoche eintragen oder Gerichte mit Lachs/Garnelen gegen Hähnchen, Eier, Quark oder Linsen tauschen.',
    });
  }
  return out;
}

export { slotKey, SLOT_LABEL };
