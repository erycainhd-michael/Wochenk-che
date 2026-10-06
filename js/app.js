// Mise – App-Oberfläche (Vanilla JS, kein Build-Schritt). Design nach Figma-Vorlage.
import { DAY_NAMES, DAY_SHORT, SLOT_LABEL, addDays, clone, berlinNow, escapeHtml as e, euro, formatDate, isoWeek, mondayOf, num, shortName } from './util.js';
import { buildIndex, plausibility } from './nutrition.js';
import { generatePlan, swapMeal } from './planner.js';
import { mergeOffers, STORES, STORE_IDS } from './prices.js';
import { amountText, packText } from './shopping.js';
import { recipeWeights, weekHints } from './feedback.js';
import { DEFAULT_SETTINGS, mergeSettings } from './settings.js';
import { exportAll, importAll, prunePlans, requestPersistence, store } from './storage.js';
import { TimerManager, fmtTime, keepAwake, unlockAudio } from './timers.js';
import { cleanRecipe, inventRecipe } from './ai.js';
import { setSoundsEnabled, sound } from './sounds.js';

const S = {
  ingData: null,
  idx: null,
  builtin: [],
  custom: store.get('customRecipes', []),
  recipes: [],
  recipesById: new Map(),
  offers: null,
  settings: mergeSettings(store.get('settings')),
  plans: store.get('plans', {}),
  checks: store.get('checks', {}),
  feedback: store.get('feedback', []),
  manualOffers: store.get('manualOffers', []),
  // Eingaben für die nächste Planung (Auswärtstage + Reste), im Rückblick gepflegt
  next: store.get('nextWeek', null),
  ui: { fx: null, hideChecked: false, cookStep: 0, openDays: {}, evalOpen: false, servings: 1, search: '', newTitle: {}, edit: null },
};
let timers;
const app = document.getElementById('app');
const ICON = { fruehstueck: '🌅', mittag: '🥗', abend: '🍝', snack: '🍎', eatout: '🍴' };

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function loadJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function init() {
  window.__miseStarted = true;
  applyTheme();
  setSoundsEnabled(S.settings.sounds);
  try {
    const [ing, rec] = await Promise.all([loadJSON('data/ingredients.json'), loadJSON('data/recipes.json')]);
    S.ingData = ing;
    S.idx = buildIndex(ing);
    S.builtin = rec.recipes;
    rebuildRecipes();
  } catch (err) {
    app.innerHTML = `<main class="view"><div class="card warn"><h2>Daten konnten nicht geladen werden</h2><p>${e(err.message)}</p><p>Bitte Internetverbindung prüfen und neu laden.</p></div></main>`;
    return;
  }
  try {
    S.offers = await loadJSON('data/offers.json');
  } catch {
    S.offers = null; // dann gelten Richtpreise
  }
  timers = new TimerManager((tickOnly) => (tickOnly ? updateTimerDock() : renderTimerDock()));
  window.addEventListener('hashchange', render);
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  registerSW();
  requestPersistence();
  if (Object.keys(S.plans).length) store.set('welcomed', true);
  render();
  checkSchedule();
  setInterval(checkSchedule, 60_000);
}

/** Eingebaute Rezepte + eigene/KI-Rezepte (eigene Änderungen überschreiben das Original). */
function rebuildRecipes() {
  const byId = new Map(S.builtin.map((r) => [r.id, r]));
  for (const r of S.custom) byId.set(r.id, r);
  S.recipes = [...byId.values()];
  S.recipesById = byId;
}

function saveCustom(recipe) {
  S.custom = S.custom.filter((r) => r.id !== recipe.id).concat(recipe);
  store.set('customRecipes', S.custom);
  rebuildRecipes();
}

/** Ganzseitiger Hinweis während die KI arbeitet */
function busy(msg) {
  let el = document.getElementById('busy');
  if (!msg) return el?.remove();
  if (!el) {
    el = document.createElement('div');
    el.id = 'busy';
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="busy-box"><div class="spinner"></div><p>${e(msg)}</p></div>`;
}

/** Neues Rezept per KI erfinden und speichern (für ↻, „Hinzufügen“, Montags-Plan). */
async function aiRecipe({ title = '', type = 'main' } = {}) {
  const r = await inventRecipe({
    apiKey: S.settings.aiKey,
    title,
    type,
    ingredients: [...S.idx.values()].filter((i) => !i.staple || ['olivenoel', 'rapsoel', 'gewuerze', 'sojasauce', 'honig', 'senf', 'gemuesebruehe', 'tomatenmark', 'balsamico'].includes(i.id)),
    avoid: S.recipes.filter((x) => x.type === type).map((x) => x.name),
    dislikes: S.settings.dislikes,
  });
  r.source = 'ki';
  r.createdAt = new Date().toISOString();
  saveCustom(r);
  return r;
}

function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

function applyTheme() {
  const t = S.settings.theme || 'auto';
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

// ---------------------------------------------------------------------------
// Zustand & Hilfen
// ---------------------------------------------------------------------------

const saveSettings = () => store.set('settings', S.settings);
const savePlans = () => store.set('plans', prunePlans(S.plans));
const saveNext = () => store.set('nextWeek', S.next);
const currentWeek = () => mondayOf();
const ing = (id) => S.idx.get(id);
const recipe = (id) => S.recipesById.get(id);
/** Kompakte Einheit ohne Leerzeichen, z. B. „181g“ */
const g_ = (x) => `${num(x)}g`;
const portions = (f) => (Math.abs(f - 1) < 0.001 ? '1 Portion' : `${(Math.round(f * 100) / 100).toLocaleString('de-DE')} Portionen`);

function displayedPlan() {
  const ws = currentWeek();
  if (S.plans[ws]) return S.plans[ws];
  const prev = Object.keys(S.plans).filter((w) => w < ws).sort().pop();
  return prev ? S.plans[prev] : null;
}

function previousPlan(ws = currentWeek()) {
  const prev = Object.keys(S.plans).filter((w) => w < ws).sort().pop();
  return prev ? S.plans[prev] : null;
}

function plannerInput(extra = {}) {
  const ws = currentWeek();
  const prevWeeks = Object.keys(S.plans).filter((w) => w < ws).sort();
  const recentRecipes = {};
  prevWeeks.slice(-2).forEach((w, i, arr) => {
    for (const c of S.plans[w].cooks || []) recentRecipes[c.recipeId] = Math.min(recentRecipes[c.recipeId] || 9, arr.length - i);
  });
  return {
    recipes: S.recipes,
    idx: S.idx,
    settings: S.settings,
    weekStart: ws,
    offers: mergeOffers(S.offers, S.manualOffers),
    feedbackWeights: { ...freshBoost(), ...recipeWeights(S.feedback), ...(extra.boost || {}) },
    weekNo: prevWeeks.length,
    recentRecipes,
    ...extra,
  };
}

/** Auswärtstage (0–6) → Mahlzeiten (Abendessen) */
const daysToEatOut = (days) => days.map((day) => ({ day, slot: 'abend' }));
const eatOutDays = (list) => [...new Set(list.map((x) => x.day))].sort();

/** Entwurf für die nächste zu planende Woche (Auswärtstage + selbst eingetragene Reste). */
function nextDraft() {
  const ws = currentWeek();
  const target = S.plans[ws] ? addDays(ws, 7) : ws;
  if (!S.next || S.next.week !== target || S.next.v !== 2) {
    S.next = { v: 2, week: target, days: eatOutDays(S.settings.eatOut), items: [] };
    saveNext();
  }
  return S.next;
}

/** Neue Rezepte (z. B. von der wöchentlichen Rezept-Routine) werden in den ersten 2 Wochen bevorzugt */
function freshBoost() {
  const out = {};
  for (const r of S.recipes) if (isFresh(r)) out[r.id] = { weight: 2.5, tooComplex: 0 };
  return out;
}

function createPlan({ pantry, eatOut, boost } = {}) {
  const ws = currentWeek();
  const plan = generatePlan(plannerInput({ pantry: pantry || {}, boost, settings: { ...S.settings, eatOut: eatOut || S.settings.eatOut } }));
  plan.done = {};
  S.plans[ws] = plan;
  savePlans();
  S.checks[ws] = {};
  store.set('checks', S.checks);
  return plan;
}

/**
 * Plan aus dem Rückblick-Entwurf erstellen (Auswärtstage + bestätigte Reste).
 * Mit KI-Schlüssel wird zusätzlich ein ganz neues Gericht erfunden und bevorzugt eingeplant.
 */
async function createPlanFromDraft() {
  const d = S.next?.week === currentWeek() ? S.next : null;
  const pantry = autoStock(currentWeek());
  for (const it of d?.items || []) if (it.g > 0) pantry[it.id] = it.g;
  const boost = {};
  if (S.settings.aiKey) {
    try {
      busy('Mise erfindet ein neues Gericht für deine Woche …');
      const r = await aiRecipe({ type: 'main' });
      boost[r.id] = { weight: 3, tooComplex: 0 };
    } catch (err) {
      console.warn(err);
    } finally {
      busy(null);
    }
  }
  const plan = createPlan({ pantry, boost, eatOut: d ? daysToEatOut(d.days) : S.settings.eatOut });
  S.next = null;
  saveNext();
  return plan;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys[keys.length - 1]] = value;
}
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2600);
}

// ---------------------------------------------------------------------------
// Montags-Automatik: Ab der eingestellten Uhrzeit wird der neue Plan erstellt –
// mit den Auswärtstagen und Resten aus dem Rückblick.
// ---------------------------------------------------------------------------

let planning = false;
async function checkSchedule() {
  const ws = currentWeek();
  if (S.plans[ws] || planning) return false;
  const hasPrev = !!previousPlan();
  if (!hasPrev && !store.get('welcomed')) return false; // erster Start: Willkommensbildschirm
  const b = berlinNow();
  if (hasPrev && b.weekday === 0 && b.hour < (S.settings.planHour ?? 8)) return false;
  planning = true;
  try {
    await createPlanFromDraft();
  } finally {
    planning = false;
  }
  toast('Dein neuer Wochenplan ist da 🍽️');
  render();
  return true;
}

function feedbackFor(ws) {
  return S.feedback.find((f) => f.weekStart === ws);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, ...rest] = h.split('/');
  return { name: name || 'woche', args: rest.map(decodeURIComponent) };
}

let lastRoute = '';
function render() {
  const r = route();
  if (lastRoute.startsWith('kochen/') && r.name !== 'kochen') keepAwake(false);
  const key = r.name + '/' + r.args.join('/');
  const changed = key !== lastRoute;
  if (changed && r.name === 'kochen' && !lastRoute.startsWith('kochen/')) sound.cookStart();
  lastRoute = key;
  const views = {
    woche: viewWeek,
    einkauf: viewShopping,
    rueckblick: viewReview,
    planen: viewReview,
    einstellungen: viewSettings,
    mahlzeit: viewMeal,
    rezepte: viewRecipes,
    rezept: viewRecipeBase,
    kochen: viewCooking,
    waehlen: viewChoose,
    bearbeiten: viewEdit,
  };
  const fn = views[r.name] || viewWeek;
  const tab = { einkauf: 'einkauf', rueckblick: 'rueckblick', planen: 'rueckblick', einstellungen: 'einstellungen' }[r.name] || 'woche';
  // Hülle nur einmal bauen, damit die Tab-Leiste weich animieren kann
  if (!document.getElementById('view')) {
    app.innerHTML = `
    <main class="view" id="view"></main>
    <div id="timer-dock"></div>
    <nav class="tabbar">
      ${tabBtn('woche', 'Wochenübersicht')}
      ${tabBtn('einkauf', 'Einkaufsliste')}
      ${tabBtn('rueckblick', 'Feedback')}
      ${tabBtn('einstellungen', 'Einstellungen')}
    </nav>`;
  }
  const view = document.getElementById('view');
  view.innerHTML = fn(...r.args);
  for (const t of app.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.tab === tab);
  if (changed) {
    view.classList.remove('enter');
    void view.offsetWidth; // Animation neu starten
    view.classList.add('enter');
  }
  applyFx();
  renderTimerDock();
  if (changed) window.scrollTo(0, 0);
}

/** Kleine Animation für das Element, mit dem gerade interagiert wurde */
function fx(sel, cls = 'pop') {
  S.ui.fx = { sel, cls };
}
function applyFx() {
  const f = S.ui.fx;
  S.ui.fx = null;
  if (!f) return;
  for (const el of document.querySelectorAll(f.sel)) el.classList.add(f.cls);
}

/** Dezentes Konfetti, z. B. beim Erreichen des Zielgewichts */
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#1f7a4d', '#3fb97a', '#e0702a', '#f2c94c', '#9bd3b0'];
  for (let i = 0; i < 26; i++) {
    const p = document.createElement('i');
    const ang = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * 120;
    p.style.setProperty('--x', `${Math.cos(ang) * dist}px`);
    p.style.setProperty('--y', `${Math.sin(ang) * dist - 60}px`);
    p.style.setProperty('--r', `${Math.random() * 540 - 270}deg`);
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 0.12}s`;
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 1600);
}

const tabBtn = (id, label) =>
  `<a href="#/${id}" class="tab" data-tab="${id}" aria-label="${label}"><img src="icons/nav/${id}.png" alt="${label}" width="44" height="44"></a>`;

/** In den letzten 14 Tagen neu hinzugekommenes Rezept (z. B. von der wöchentlichen Rezept-Routine) */
const isFresh = (r) => r.addedAt && Date.now() - new Date(r.addedAt).getTime() < 14 * 864e5;

function bar(value, target, label, unit = '') {
  const pct = Math.min(100, (value / target) * 100);
  const ok = Math.abs(value - target) / target <= 0.05 || (label === 'Protein' && value >= target * 0.97);
  const fmt = (x) => (unit ? g_(x) : num(x));
  return `<div class="bar"><div class="bar-label"><span>${label}</span><span>${fmt(value)} / ${fmt(target)}</span></div>
    <div class="bar-track"><div class="bar-fill ${ok ? 'ok' : value < target ? 'low' : 'high'}" style="width:${pct}%"></div></div></div>`;
}

// --- Woche -------------------------------------------------------------------

function viewWelcome() {
  return `<div class="welcome">
      <img class="welcome-icon" src="icons/icon-512.png" alt="">
      <h2>Willkommen bei Mise!</h2>
    </div>
    <section class="card center">
      <button class="btn primary block" data-action="first-plan">🍽️ Wochenplan erstellen</button>
      <p>Die App plant deine Woche so, dass dein Einkauf deine Kalorien- und Proteinziele schon erfüllt – kein Tracking nötig.</p>
      <p>Mise hilft dir außerdem bei einer ausgewogeneren Ernährung und bezieht dabei deine Vorlieben ein.</p>
    </section>`;
}

function viewWeek() {
  const plan = displayedPlan();
  if (!plan) return store.get('welcomed') ? `<p class="sub center">Dein Wochenplan wird erstellt …</p>` : viewWelcome();
  const ws = currentWeek();
  const b = berlinNow();
  const isCurrent = plan.weekStart === ws;
  const banners = [];
  if (!isCurrent) {
    banners.push(`<div class="banner">Neue Woche! Der neue Plan wird ab ${S.settings.planHour ?? 8}:00 Uhr erstellt. <button class="btn small" data-action="plan-now">Jetzt planen</button></div>`);
  }
  if (isCurrent && b.weekday >= 5 && !feedbackFor(ws)) {
    banners.push(`<div class="banner">Wie war die Woche? Dein Feedback verbessert die nächsten Pläne. <a class="btn small" href="#/rueckblick">Feedback geben</a></div>`);
  }
  const todayIdx = isCurrent ? b.weekday : -1;
  const g = plan.goals;
  const avgK = plan.days.reduce((a, d) => a + d.totals.kcal, 0) / 7;
  const avgP = plan.days.reduce((a, d) => a + d.totals.p, 0) / 7;
  return `
    <header class="top">
      <div><h1>KW ${isoWeek(plan.weekStart)}</h1><div class="sub">${formatDate(plan.weekStart)} – ${formatDate(addDays(plan.weekStart, 6), { day: 'numeric', month: 'long' })}</div></div>
      <a class="btn pill" href="#/rezepte">📖 Rezepte</a>
    </header>
    ${banners.join('')}
    <section class="card hero">
      <div class="kpis">
        <div><b>${num(avgK)}</b><span>Ø kcal / ${num(g.kcal)}</span></div>
        <div><b>${num(avgP)}g</b><span>Ø Protein / ${g.protein}g</span></div>
        <div><b>${euro(plan.cost)}</b><span>Einkauf / ${euro(S.settings.budget)}</span></div>
      </div>
      <div class="divider"></div>
      <button class="link" data-action="toggle-eval">${S.ui.evalOpen ? '▾' : '▸'} Bewertung des Plans</button>
      ${S.ui.evalOpen ? evaluationHtml(plan) : ''}
    </section>
    ${plan.days.map((d) => dayCard(plan, d, S.ui.openDays[d.day] ?? d.day === Math.max(0, todayIdx), d.day === todayIdx)).join('')}`;
}

function evaluationHtml(plan) {
  return `<ol class="eval">${(plan.evaluation || []).map((x) => `<li class="${x.level}"><b>${e(x.title)}</b><br>${e(x.text)}</li>`).join('')}</ol>`;
}

function mealRow(plan, m) {
  if (m.kind === 'eatout') {
    return `<li class="meal eatout"><span class="mi">${ICON.eatout}</span><div class="mt"><div class="ml">${SLOT_LABEL[m.slot]} · auswärts</div>
      <div class="mn">Auswärtsessen</div><div class="mm">≈ ${num(m.macros.kcal)} kcal · ≈ ${g_(m.macros.p)} P</div></div></li>`;
  }
  const r = recipe(m.recipeId);
  const cook = m.cookId ? plan.cooks.find((c) => c.id === m.cookId) : null;
  const badges = [];
  if (m.leftover) badges.push('<span class="badge">Portion von gestern</span>');
  else if (cook && cook.portions.length > 1) badges.push('<span class="badge">+ Portion für morgen</span>');
  if (r.effort === 3) badges.push('<span class="badge fancy">aufwendig</span>');
  if (r.source === 'ki' || isFresh(r)) badges.push('<span class="badge new">neu</span>');
  for (const a of m.addons || []) badges.push(`<span class="badge">+ ${e(recipe(a)?.name || a)}</span>`);
  const isSnack = m.slot === 'snack';
  return `<li class="meal" data-key="${m.key}">
    <a class="mt" href="#/mahlzeit/${m.key}">
      <div class="ml">${ICON[isSnack ? 'snack' : m.slot]} ${isSnack ? 'Snack' : SLOT_LABEL[m.slot]} · ${r.time} Min.</div>
      <div class="mn">${e(r.name)}</div>
      <div class="mm">${portions(m.factor)} · ${num(m.macros.kcal)} kcal · ${g_(m.macros.p)} P</div>
      ${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}
    </a>
    ${
      !isSnack
        ? `<div class="meal-btns">
      <button class="round-btn" data-action="swap" data-key="${m.key}" aria-label="Neues Rezept vorschlagen">↻</button>
      <a class="round-btn" href="#/waehlen/${m.key}" aria-label="Rezept aus der Sammlung wählen">🔎</a>
    </div>`
        : ''
    }
  </li>`;
}

function dayCard(plan, d, open, isToday) {
  const g = plan.goals;
  return `<section class="card day ${isToday ? 'accent' : ''}" data-day="${d.day}">
    <button class="day-head" data-action="toggle-day" data-day="${d.day}" data-open="${open ? 1 : 0}">
      <b>${d.name} ${formatDate(d.date)}${isToday ? ' · heute' : ''}</b>
      <span class="sub">${num(d.totals.kcal)} kcal · ${g_(d.totals.p)} P</span>
    </button>
    ${
      open
        ? `<ul class="meals">${d.meals.map((m) => mealRow(plan, m)).join('')}</ul>
      <div class="bars">
        ${bar(d.totals.kcal, g.kcal, 'Kalorien')}
        ${bar(d.totals.p, g.protein, 'Protein', 'g')}
        <div class="mini">KH ${num(d.totals.c)} / ${g_(g.carbs)} · Fett ${num(d.totals.f)} / ${g_(g.fat)} · Ballaststoffe ${g_(d.totals.fib)} · Gemüse/Obst ${g_(d.totals.veg)} · Warenwert ≈ ${euro(d.cost)}</div>
      </div>`
        : ''
    }
  </section>`;
}

// --- Mahlzeit / Rezept -------------------------------------------------------

function findMeal(plan, key) {
  const d = Number(key.split('-')[0]);
  return plan?.days[d]?.meals.find((m) => m.key === key);
}

function macrosOf(items) {
  return items.reduce(
    (a, it) => {
      const i = ing(it.id);
      const k = it.g / 100;
      return { kcal: a.kcal + i.kcal * k, p: a.p + i.p * k, c: a.c + i.c * k, f: a.f + i.f * k };
    },
    { kcal: 0, p: 0, c: 0, f: 0 }
  );
}

function viewMeal(key) {
  const plan = displayedPlan();
  const meal = findMeal(plan, key);
  if (!meal || meal.kind !== 'recipe') return `<div class="card">Mahlzeit nicht gefunden. <a href="#/woche">Zur Woche</a></div>`;
  const r = recipe(meal.recipeId);
  const cook = meal.cookId ? plan.cooks.find((c) => c.id === meal.cookId) : null;
  const items = cook ? cook.items : meal.items;
  let info = '';
  if (cook && cook.portions.length > 1) {
    const parts = cook.portions.map((p) => `${DAY_SHORT[p.day]} ${SLOT_LABEL[p.slot]}`).join(' + ');
    info = `<div class="banner info">🍱 Du kochst für <b>${parts}</b>. ${meal.leftover ? 'Heute isst du die vorgekochte Portion – nur aufwärmen.' : 'Füll die zweite Portion direkt in die Lunchbox.'}</div>`;
  }
  for (const a of meal.addons || []) {
    const ar = recipe(a);
    info += `<div class="banner info">💪 Dazu: <b>${e(ar.name)}</b> – ergänzt heute dein Protein. ${ar.steps.map((x) => e(x.t)).join(' ')}</div>`;
  }
  const slot = meal.slot.startsWith('snack') ? 'Snack' : SLOT_LABEL[meal.slot];
  return recipeHtml(r, items, meal.macros, `${DAY_NAMES[meal.key.split('-')[0]]} · ${slot} · ${portions(cook ? cook.totalFactor : meal.factor)}`, `<a class="back" href="#/woche">‹ Woche</a>`, info, key, false);
}

function viewRecipes() {
  const groups = { main: 'Hauptgerichte', breakfast: 'Frühstück' };
  const fbw = recipeWeights(S.feedback);
  return `<header class="top col"><a class="back" href="#/woche">‹ Woche</a><h1>Rezepte</h1></header>
    ${Object.entries(groups)
      .map(([t, label]) => {
        const list = S.recipes.filter((r) => r.type === t);
        return `<section class="card"><h2>${label}</h2>
        <div class="add-row"><input placeholder="Neues Rezept, z. B. Pilzrisotto" data-new-title="${t}" value="${e(S.ui.newTitle[t] || '')}"><button class="btn pill" data-action="new-recipe" data-type="${t}">Hinzufügen</button></div>
        <p class="hint">${S.settings.aiKey ? 'Nur den Titel eintragen – die KI erfindet das passende Rezept.' : 'Titel eintragen und Rezept selbst ausfüllen. Mit KI-Schlüssel (Einstellungen) erfindet Mise es für dich.'}</p>
        <ul class="list">${list
          .map((r) => {
            const w = fbw[r.id]?.weight;
            const tag = r.source === 'ki' ? ' · ✨ KI' : isFresh(r) ? ' · ✨ neu' : r.source === 'eigen' ? ' · eigenes' : '';
            const m = macrosOf(r.ingredients.filter((l) => !l.opt || S.settings[l.opt]));
            return `<li><a href="#/rezept/${r.id}"><span>${e(r.name)}</span><small>${r.time} Min. · ${'🧽'.repeat(Math.max(1, r.dishes))}${w > 1.15 ? ' · 👍' : w < 0.85 ? ' · 👎' : ''}${r.season ? ' · saisonal' : ''}${tag}</small>
              <span class="macros"><b>${num(m.kcal)} kcal</b><span>${g_(m.p)} P</span><span>${g_(m.c)} KH</span><span>${g_(m.f)} F</span></span></a></li>`;
          })
          .join('')}</ul></section>`;
      })
      .join('')}`;
}

/** 🔎 Rezept aus der Sammlung für eine Mahlzeit auswählen */
function viewChoose(key) {
  const plan = displayedPlan();
  const meal = findMeal(plan, key);
  if (!meal) return `<div class="card">Mahlzeit nicht gefunden. <a href="#/woche">Zur Woche</a></div>`;
  const type = meal.slot === 'fruehstueck' ? 'breakfast' : 'main';
  const q = S.ui.search.toLowerCase().trim();
  const list = S.recipes
    .filter((r) => r.type === type && r.id !== meal.recipeId)
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.ingredients.some((l) => ing(l.id)?.name.toLowerCase().includes(q)));
  return `<header class="top col"><a class="back" href="#/woche">‹ Woche</a><h1>Rezept wählen</h1>
    <div class="sub">${DAY_NAMES[key.split('-')[0]]} · ${SLOT_LABEL[meal.slot]} · statt „${e(recipe(meal.recipeId)?.name || '')}“</div></header>
    <section class="card">
      <input type="search" placeholder="Suchen, z. B. Lachs oder Pasta" data-search="choose" value="${e(S.ui.search)}">
      <ul class="list">${
        list.length
          ? list
              .map(
                (r) => `<li><button class="list-btn" data-action="choose" data-key="${key}" data-id="${r.id}"><span>${e(r.name)}</span><small>${r.time} Min. · ${'🧽'.repeat(Math.max(1, r.dishes))}${r.source === 'ki' ? ' · ✨ KI' : ''}</small></button></li>`
              )
              .join('')
          : '<li class="muted">Nichts gefunden.</li>'
      }</ul>
    </section>`;
}

/** Rezept anlegen/ändern: Text, Zutaten und Timer */
function viewEdit(id) {
  if (!S.ui.edit || S.ui.edit.id !== id) {
    const r = recipe(id);
    if (!r) return `<div class="card">Rezept nicht gefunden. <a href="#/rezepte">Zu den Rezepten</a></div>`;
    S.ui.edit = clone(r);
  }
  const r = S.ui.edit;
  const opts = (sel) =>
    [...S.idx.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
      .map((i) => `<option value="${i.id}" ${i.id === sel ? 'selected' : ''}>${e(i.name)}</option>`)
      .join('');
  const isBuiltin = S.builtin.some((b) => b.id === r.id);
  const isCustom = S.custom.some((c) => c.id === r.id);
  return `<header class="top"><a class="back" href="#/rezept/${r.id}" data-action="edit-cancel">‹ Abbrechen</a><button class="btn primary pill" data-action="edit-save">Speichern</button></header>
    <section class="card accent">
      <label class="field">Titel<input data-edit="name" value="${e(r.name)}"></label>
      <div class="grid2">
        <label class="field">Mahlzeit<select data-edit="type"><option value="main" ${r.type === 'main' ? 'selected' : ''}>Mittag/Abend</option><option value="breakfast" ${r.type === 'breakfast' ? 'selected' : ''}>Frühstück</option></select></label>
        <label class="field">Zeit (Min.)<input type="number" inputmode="numeric" data-edit="time" value="${r.time}"></label>
        <label class="field">Abwasch (Töpfe)<input type="number" inputmode="numeric" data-edit="dishes" value="${r.dishes}"></label>
        <label class="field">Aufwand<select data-edit="effort">${[1, 2, 3].map((v) => `<option value="${v}" ${r.effort === v ? 'selected' : ''}>${['', 'einfach', 'normal', 'aufwendig'][v]}</option>`).join('')}</select></label>
      </div>
      <label class="row"><input type="checkbox" data-edit="mealPrep" ${r.mealPrep ? 'checked' : ''}> Schmeckt auch am nächsten Tag (Lunchbox)</label>
    </section>
    <section class="card"><h2>Zutaten <span class="sub">für 1 Portion</span></h2>
      <ul class="edit-list">${r.ingredients
        .map(
          (l, n) => `<li><select data-edit-ing="${n}" data-f="id">${opts(l.id)}</select>
          <span class="qty"><input type="number" inputmode="numeric" data-edit-ing="${n}" data-f="g" value="${l.g}"> g</span>
          <button class="round-btn" data-action="edit-del-ing" data-n="${n}" aria-label="entfernen">✕</button></li>`
        )
        .join('')}</ul>
      <button class="btn pill small" data-action="edit-add-ing">+ Zutat</button>
    </section>
    <section class="card"><h2>Anleitung</h2>
      <ol class="edit-steps">${r.steps
        .map(
          (st, n) => `<li><textarea rows="3" data-edit-step="${n}" data-f="t">${e(st.t)}</textarea>
          <div class="step-meta"><span class="qty">⏱️ <input type="number" inputmode="decimal" step="0.5" min="0" data-edit-step="${n}" data-f="timer" value="${st.timer ? st.timer / 60 : ''}" placeholder="–"> Min.</span>
          <input data-edit-step="${n}" data-f="label" value="${e(st.label || '')}" placeholder="Timer-Name">
          <button class="round-btn" data-action="edit-del-step" data-n="${n}" aria-label="entfernen">✕</button></div></li>`
        )
        .join('')}</ol>
      <button class="btn pill small" data-action="edit-add-step">+ Schritt</button>
      ${S.settings.aiKey ? `<button class="btn pill small" data-action="edit-ai">✨ Mit KI ausfüllen</button>` : ''}
    </section>
    <button class="btn primary block" data-action="edit-save">Speichern</button>
    ${isCustom ? `<button class="link danger" data-action="edit-delete">${isBuiltin ? 'Original wiederherstellen' : 'Rezept löschen'}</button>` : ''}`;
}

function viewRecipeBase(id) {
  const r = recipe(id);
  if (!r) return `<div class="card">Rezept nicht gefunden.</div>`;
  const n = S.ui.servings || 1;
  const items = r.ingredients.filter((l) => !l.opt || S.settings[l.opt]).map((l) => ({ id: l.id, g: l.g * n, note: l.note }));
  const per = macrosOf(items.map((it) => ({ ...it, g: it.g / n })));
  return recipeHtml(r, items, per, `Basisrezept · ${n === 1 ? '1 Portion' : n + ' Portionen'}`, `<a class="back" href="#/rezepte">‹ Rezepte</a>`, '', 'r:' + id, true);
}

function recipeHtml(r, items, macros, subtitle, back, info, cookKey, withServings) {
  const cookHref = `#/kochen/${encodeURIComponent(cookKey)}`;
  const ingList = items
    .map((it) => {
      const i = ing(it.id);
      return `<li><span>${e(i.name)}${it.note ? ` <small class="muted">${e(it.note)}</small>` : ''}${it.extra ? ` <small class="badge">+${Math.round(it.extra)}g Restverwertung</small>` : ''}</span><b>${amountText(i, it.g)}</b></li>`;
    })
    .join('');
  const steps = r.steps
    .map(
      (s, n) =>
        `<li><p>${e(s.t)}</p>${s.timer ? `<button class="btn small pill timer-btn" data-action="timer" data-sec="${s.timer}" data-label="${e(s.label || 'Schritt ' + (n + 1))}" data-ctx="${e(r.name)}">⏱️ ${e(s.label || '')} ${fmtTime(s.timer)}</button>` : ''}</li>`
    )
    .join('');
  const servings = withServings
    ? `<section class="card"><h2>Portionen</h2><div class="pills">${[1, 2, 3, 4, 5, 6]
        .map((n) => `<button class="pill circle ${S.ui.servings === n ? 'on' : ''}" data-action="servings" data-n="${n}">${n}</button>`)
        .join('')}</div></section>`
    : '';
  return `<header class="top">${back}<a class="btn primary pill" href="${cookHref}">👨‍🍳 Kochmodus starten</a></header>
    <section class="card accent">
      <div class="card-head"><div class="sub">${e(subtitle)}</div><a class="btn small pill" href="#/bearbeiten/${r.id}">✏️ Ändern</a></div>
      <h1 class="rtitle">${e(r.name)}</h1>
      <div class="chips"><span class="chip on">⏱️ ${r.time} Min.</span><span class="chip">Abwasch ${r.dishes}</span><span class="chip">${['', 'einfach', 'normal', 'aufwendig'][r.effort]}</span><span class="chip">${e(r.protein)}</span></div>
      <div class="divider accent"></div>
      <div class="sub">${num(macros.kcal)} kcal · ${g_(macros.p)} P · ${g_(macros.c)} Kh · ${g_(macros.f)} F</div>
    </section>
    ${info}
    ${servings}
    <section class="card"><h2>Zutaten</h2><ul class="ings">${ingList}</ul></section>
    <section class="card"><ol class="steps">${steps}</ol>
      <a class="btn primary block" href="${cookHref}">👨‍🍳 Kochmodus starten</a>
    </section>`;
}

function viewCooking(key) {
  let r;
  let items;
  let backHref = '#/woche';
  if (key.startsWith('r:')) {
    r = recipe(key.slice(2));
    items = r?.ingredients.map((l) => ({ id: l.id, g: l.g * (S.ui.servings || 1) }));
    backHref = `#/rezept/${key.slice(2)}`;
  } else {
    const plan = displayedPlan();
    const meal = findMeal(plan, key);
    if (meal) {
      r = recipe(meal.recipeId);
      const cook = meal.cookId ? plan.cooks.find((c) => c.id === meal.cookId) : null;
      items = cook ? cook.items : meal.items;
      backHref = `#/mahlzeit/${key}`;
    }
  }
  if (!r) return `<div class="card">Nicht gefunden.</div>`;
  keepAwake(true);
  const n = Math.min(S.ui.cookStep, r.steps.length - 1);
  const s = r.steps[n];
  return `<div class="cook">
    <header class="top col"><a class="back" href="${backHref}">‹ Zurück</a></header>
    <a class="sub underline" href="${backHref}">${e(r.name)}</a>
    <div class="step-count">Schritt ${n + 1} von ${r.steps.length}</div>
    <p class="step-text" data-step="${n}">${e(s.t)}</p>
    ${s.timer ? `<button class="btn primary block big" data-action="timer" data-sec="${s.timer}" data-label="${e(s.label || 'Schritt ' + (n + 1))}" data-ctx="${e(r.name)}">⏱️ Timer ${fmtTime(s.timer)} starten</button>` : ''}
    <div class="cook-nav">
      <button class="btn big" data-action="cook-step" data-d="-1" ${n === 0 ? 'disabled' : ''}>‹ Zurück</button>
      ${
        n === r.steps.length - 1
          ? `<button class="btn big primary" data-action="cook-done" data-back="${backHref}">Fertig ✓</button>`
          : `<button class="btn big primary" data-action="cook-step" data-d="1">Weiter ›</button>`
      }
    </div>
    <details class="card"><summary>Zutaten anzeigen</summary><ul class="ings">${items
      .map((it) => `<li><span>${e(ing(it.id).name)}</span><b>${amountText(ing(it.id), it.g)}</b></li>`)
      .join('')}</ul></details>
  </div>`;
}

// --- Einkaufsliste -----------------------------------------------------------

/** Kurze Rezeptnamen, damit die Einkaufsliste kompakt bleibt */
const useLinks = (refs) => refs.map((u) => `<a href="#/rezept/${u.id}">${e(shortName(recipe(u.id) || u.name))}</a>`).join(' · ');

function viewShopping() {
  const plan = displayedPlan();
  if (!plan) return `<header class="top"><h1>Einkauf</h1></header><div class="card">Noch kein Plan. <a href="#/woche">Zur Woche</a></div>`;
  const ws = plan.weekStart;
  const checks = (S.checks[ws] ||= {});
  const sh = plan.shopping;
  const toBuy = sh.items.filter((i) => i.packs > 0);
  const openCost = toBuy.filter((i) => !checks[i.id]).reduce((a, i) => a + i.cost, 0);
  const cats = S.ingData.categories;
  const stores = [...new Set(toBuy.map((i) => i.store))].sort((a, b) => (a === S.settings.mainStore ? -1 : b === S.settings.mainStore ? 1 : 0));
  const offerInfo = S.offers?.updated ? `Angebote: Stand ${new Date(S.offers.updated).toLocaleDateString('de-DE')}` : 'Keine aktuellen Angebote – Richtpreise';
  const row = (id, name, price, sub, refs) => {
    const done = checks[id];
    if (S.ui.hideChecked && done) return '';
    return `<li class="shop-item ${done ? 'done' : ''}" data-id="${e(id)}">
      <button class="check ${done ? 'on' : ''}" data-action="check" data-id="${id}" aria-label="abhaken">${done ? '✓' : ''}</button>
      <div class="si" data-action="check" data-id="${id}">
        <div class="si-top"><b>${e(name)}</b>${price ? `<span>${price}</span>` : ''}</div>
        <div class="si-sub">${sub}</div>
        ${refs.length ? `<div class="si-uses">für ${useLinks(refs)}</div>` : ''}
      </div></li>`;
  };
  const itemRow = (it) =>
    row(
      it.id,
      it.name,
      euro(it.cost),
      `${packText(it).replace(/(\d) g\b/g, '$1g').replace(/(\d) Liter\b/, '$1L')} · benötigt ${g_(it.need)}${it.have ? ` (davon ${g_(it.have)} Rest)` : ''}${it.offer ? ` · <span class="badge offer">Angebot${it.offerTitle ? ': ' + e(it.offerTitle) : ''}</span>` : ''}${it.note ? ` · ${e(it.note)}` : ''}`,
      it.useRefs || []
    );
  const staples = sh.staples.map((s) => row('staple:' + s.id, s.name, '', g_(s.g), s.useRefs || [])).join('');
  const storeBlocks = stores
    .map((st) => {
      const list = toBuy.filter((i) => i.store === st);
      const total = list.reduce((a, i) => a + i.cost, 0);
      return `<section class="card"><h2>${e(STORES[st]?.short || st)} ${euro(total)}</h2>
        ${cats
          .map((c) => {
            const rows = list.filter((i) => i.cat === c).map(itemRow).join('');
            return rows ? `<h3>${e(c)}</h3><ul class="shop">${rows}</ul>` : '';
          })
          .join('')}</section>`;
    })
    .join('');
  return `<header class="top col"><h1>Einkauf</h1><div class="sub">KW ${isoWeek(ws)} · ${e(offerInfo)}</div></header>
    <button class="btn pill hide-btn" data-action="toggle-hide">${S.ui.hideChecked ? 'Alle zeigen' : 'Erledigte ausblenden'}</button>
    <section class="card accent sticky">
      <div class="kpis">
        <div><b>${euro(plan.cost)}</b><span>Gesamt</span></div>
        <div><b>${euro(openCost)}</b><span>noch offen</span></div>
        <div><b>${toBuy.filter((i) => checks[i.id]).length}/${toBuy.length}</b><span>erledigt</span></div>
      </div>
    </section>
    ${staples ? `<section class="card"><h2>Vorrat prüfen</h2><ul class="shop">${staples}</ul></section>` : ''}
    ${storeBlocks}`;
}

// --- Rückblick (Verlauf, Feedback + Planung der nächsten Woche) ---------------

const fmtKg = (x) => (x == null || x === '' ? '' : Number(x).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const parseKg = (s) => {
  const v = parseFloat(String(s).replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : null;
};

/** Liniendiagramm (SVG) für die letzten Wochen. series: [{ name, cls, marker, values[] }] */
function lineChart({ weeks, series, min, max, ticks, fmt, labelFmt = fmt, goal, unit = '' }) {
  const W = 320, H = 150, L = 30, R = 46, T = 12, B = 24;
  const x = (i) => L + (i * (W - L - R)) / (weeks.length - 1);
  const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const grid = ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('');
  const xl = weeks.map((w, i) => `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="middle">KW ${isoWeek(w)}</text>`).join('');
  let goalLine = '';
  if (goal != null) goalLine = `<line class="goal" x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}"/>`;
  const marks = series
    .map((s) => {
      // Linie nur zwischen aufeinanderfolgenden Wochen mit Wert
      let path = '';
      s.values.forEach((v, i) => {
        if (v == null) return;
        path += `${i > 0 && s.values[i - 1] != null ? 'L' : 'M'}${x(i)} ${y(v)} `;
      });
      const pts = s.values
        .map((v, i) => {
          if (v == null) return '';
          const tip = `KW ${isoWeek(weeks[i])} · ${s.name}: ${labelFmt(v)}${unit}`;
          const m = s.marker === 'square' ? `<rect class="pt ${s.cls}" x="${x(i) - 4}" y="${y(v) - 4}" width="8" height="8" rx="1.5"/>` : `<circle class="pt ${s.cls}" cx="${x(i)}" cy="${y(v)}" r="4.5"/>`;
          return `${m}<circle class="hit" cx="${x(i)}" cy="${y(v)}" r="16" data-action="chart-tip" data-tip="${e(tip)}"/>`;
        })
        .join('');
      const last = s.values.map((v, i) => [v, i]).filter(([v]) => v != null).pop();
      const label = last ? `<text class="dl" x="${x(last[1]) + 9}" y="${y(last[0]) + 4 + (s.nudge || 0)}">${labelFmt(last[0])}</text>` : '';
      return `<path class="ln ${s.cls}" d="${path}"/>${pts}${label}`;
    })
    .join('');
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img">${grid}${xl}${goalLine}${marks}</svg>`;
}

function trendCard(ws) {
  const weeks = [-21, -14, -7, 0].map((d) => addDays(ws, d));
  const val = (w, f) => feedbackFor(w)?.week?.[f] ?? null;
  const sat = weeks.map((w) => val(w, 'satiety'));
  const en = weeks.map((w) => val(w, 'energy'));
  const kg = weeks.map((w) => val(w, 'weight'));
  const goal = S.settings.goalWeight;
  const has = (arr) => arr.some((v) => v != null);
  // Direkte Beschriftungen nicht übereinanderlegen
  const lastOf = (arr) => [...arr].reverse().find((v) => v != null);
  const close = has(sat) && has(en) && Math.abs(lastOf(sat) - lastOf(en)) < 0.6;
  const chart1 = has(sat) || has(en)
    ? lineChart({
        weeks,
        min: 1,
        max: 5,
        ticks: [1, 3, 5],
        fmt: (v) => num(v),
        series: [
          { name: 'Sättigung', cls: 's1', marker: 'circle', values: sat, nudge: close && lastOf(sat) >= lastOf(en) ? -7 : close ? 7 : 0 },
          { name: 'Energie', cls: 's2', marker: 'square', values: en, nudge: close && lastOf(sat) >= lastOf(en) ? 7 : close ? -7 : 0 },
        ],
      })
    : `<p class="chart-empty">Noch keine Werte – bewerte unten Sättigung und Energie.</p>`;
  let chart2 = `<p class="chart-empty">Noch kein Gewicht eingetragen.</p>`;
  if (has(kg)) {
    const vals = kg.filter((v) => v != null).concat(goal ? [goal] : []);
    let lo = Math.floor(Math.min(...vals) - 0.5);
    let hi = Math.ceil(Math.max(...vals) + 0.5);
    if (hi - lo < 2) hi = lo + 2;
    const mid = Math.round(((lo + hi) / 2) * 2) / 2;
    chart2 = lineChart({ weeks, min: lo, max: hi, ticks: [lo, mid, hi], fmt: (v) => fmtKg(v).replace(/,0$/, ''), labelFmt: fmtKg, unit: ' kg', goal, series: [{ name: 'Gewicht', cls: 's1', marker: 'circle', values: kg }] });
  }
  return `<section class="card charts">
    <div class="chart" data-chart>
      <div class="chart-head"><h2>Sättigung & Energie</h2>
        <div class="legend"><span><i class="sw s1"></i>Sättigung</span><span><i class="sw s2 sq"></i>Energie</span></div></div>
      ${chart1}
    </div>
    <div class="chart" data-chart>
      <div class="chart-head"><h2>Gewicht <span class="sub">kg</span></h2>${goal ? `<div class="legend"><span><i class="sw goal"></i>Ziel ${fmtKg(goal)}</span></div>` : ''}</div>
      ${chart2}
    </div>
    <p class="chart-tip sub" aria-live="polite">Letzte 4 Wochen · Punkt antippen für Details</p>
  </section>`;
}

function weekPager(ws, weeks) {
  const asc = [...weeks].sort();
  const i = asc.indexOf(ws);
  const prev = asc[i - 1];
  const next = asc[i + 1];
  const side = (w, fallback, dir) => {
    const label = dir < 0 ? `‹ KW ${isoWeek(w || fallback)}` : `KW ${isoWeek(w || fallback)} ›`;
    return w ? `<a class="pg" href="#/rueckblick/${w}">${label}${feedbackFor(w) ? ' <small>✓</small>' : ''}</a>` : `<span class="pg off">${label}</span>`;
  };
  return `<nav class="pager">
    ${side(prev, addDays(ws, -7), -1)}
    <div class="pg cur"><b>KW ${isoWeek(ws)}</b><small>${formatDate(ws, { day: 'numeric', month: 'short' })} – ${formatDate(addDays(ws, 6), { day: 'numeric', month: 'short' })}</small></div>
    ${side(next, addDays(ws, 7), 1)}
  </nav>`;
}

// Haltbares (Reis, Nudeln, Dosen, Proteinpulver …) hält Monate – das rechnet Mise automatisch mit
const AUTO_SHELF = 180;

/** Plan, aus dessen Einkauf die Reste für die Woche `target` stammen */
const draftBase = (target) => S.plans[currentWeek()] || previousPlan(target);

/** Vermutlich übrig gebliebene frische Zutaten aus dem letzten Einkauf (mit geschätzter Menge) */
function leftoverGuesses(d) {
  const have = new Set(d.items.map((x) => x.id));
  return Object.entries(draftBase(d.week)?.shopping?.leftovers || {})
    .map(([id, g]) => ({ id, g: Math.max(5, Math.round(g / 5) * 5), i: ing(id) }))
    .filter((x) => x.i && !x.i.staple && x.i.shelf < AUTO_SHELF && x.g >= 10 && !have.has(x.id))
    .sort((a, b) => b.g / b.i.pack - a.g / a.i.pack);
}

/** Haltbare Reste, die ohne Nachfrage in den nächsten Plan einfließen */
function autoStock(week) {
  const out = {};
  for (const [id, g] of Object.entries(draftBase(week)?.shopping?.leftovers || {})) {
    const i = ing(id);
    if (i && !i.staple && i.shelf >= AUTO_SHELF && g >= 5) out[id] = g;
  }
  return out;
}

function viewReview(weekArg) {
  const weeks = Object.keys(S.plans).sort().reverse();
  const draft = nextDraft();
  const guesses = leftoverGuesses(draft);
  const guessIds = new Set(guesses.map((x) => x.id));
  const planningCards = `
    <section class="card"><h2>Wann isst du auswärts?</h2>
      <p class="sub">Tippe die Tage an (KW ${isoWeek(draft.week)}). Sie werden mit ca. ${num(S.settings.eatOutKcal)} kcal eingerechnet; an diesen Tagen wird entsprechend weniger gekocht. Den Standard änderst du in den Einstellungen.</p>
      ${dayPills(draft.days, 'draft-day')}
    </section>
    <section class="card"><h2>Was ist übrig geblieben?</h2>
      <p class="sub">Trag ein, was noch da ist – Mise plant es in der nächsten Woche ein.</p>
      ${
        draft.items.length
          ? `<ul class="pantry">${draft.items
              .map(
                (it, n) => `<li data-pid="${it.id}">
            <span class="pname">${e(ing(it.id).name)}${ing(it.id).shelf < 7 ? ' <small class="muted">(noch gut?)</small>' : ''}</span>
            <span class="qty"><input type="number" inputmode="numeric" min="0" step="5" value="${it.g}" data-pantry-g="${n}"> g</span>
            <button class="round-btn" data-action="pantry-del" data-n="${n}" aria-label="entfernen">✕</button>
          </li>`
              )
              .join('')}</ul>`
          : ''
      }
      ${
        guesses.length
          ? `<div class="field">Vermutlich noch da – antippen zum Hinzufügen:
        <div class="chips guess">${guesses
          .slice(0, 12)
          .map((x) => `<button class="chip add" data-action="pantry-guess" data-id="${x.id}" data-g="${x.g}">+ ${e(x.i.name)} <small>${g_(x.g)}</small></button>`)
          .join('')}</div></div>`
          : ''
      }
      <select data-pantry-add aria-label="Zutat hinzufügen"><option value="">+ Andere Zutat hinzufügen</option>
        ${guesses.length ? `<optgroup label="Aus deinem Einkauf">${guesses.map((x) => `<option value="${x.id}">${e(x.i.name)}</option>`).join('')}</optgroup>` : ''}
        <optgroup label="Alle Zutaten">${[...S.idx.values()]
          .filter((i) => !i.staple && !guessIds.has(i.id))
          .sort((a, b) => a.name.localeCompare(b.name, 'de'))
          .map((i) => `<option value="${i.id}">${e(i.name)}</option>`)
          .join('')}</optgroup>
      </select>
      <p class="hint">Haltbares wie Reis, Nudeln oder Dosen rechnet Mise automatisch mit. ${S.plans[currentWeek()] ? `Gilt für deinen Plan ab ${formatDate(draft.week)}.` : 'Gilt für den Plan dieser Woche.'}</p>
    </section>`;
  if (!weeks.length) return `<header class="top col"><h1>Rückblick</h1></header>${planningCards}`;

  const ws = weekArg && S.plans[weekArg] ? weekArg : weeks[0];
  const plan = S.plans[ws];
  const fb = feedbackFor(ws) || { weekStart: ws, recipes: {}, week: {} };
  const hints = weekHints(S.feedback, S.settings.goals, S.settings.goalWeight);
  const groups = { fruehstueck: [], mittag: [], abend: [] };
  const seen = new Set();
  for (const d of plan.days)
    for (const m of d.meals) {
      if (m.kind !== 'recipe' || m.leftover || seen.has(m.recipeId)) continue;
      seen.add(m.recipeId);
      groups[m.slot]?.push(m.recipeId);
    }
  const icon = (id, field, val, emoji, label) => {
    const cur = fb.recipes[id]?.[field];
    const on = val === undefined ? !!cur : cur === val;
    return `<button class="pill circle ${on ? 'on' : ''}" data-action="fb" data-week="${ws}" data-id="${id}" data-field="${field}" data-val="${val ?? ''}" aria-label="${label}" title="${label}">${emoji}</button>`;
  };
  const scale = (field, label) =>
    `<div class="scale"><span>${label}</span><div class="pills">${[1, 2, 3, 4, 5]
      .map((v) => `<button class="pill circle ${fb.week?.[field] === v ? 'on' : ''}" data-action="fbw" data-week="${ws}" data-field="${field}" data-val="${v}">${v}</button>`)
      .join('')}</div></div>`;
  const groupCard = (key, title) =>
    groups[key].length
      ? `<section class="card"><h2>${title}</h2><ul class="fb-list">${groups[key]
          .map(
            (id) => `<li><div class="fb-name">${e(recipe(id).name)}</div><div class="pills">
          ${icon(id, 'rating', 2, '😍', 'Ich liebe das')}${icon(id, 'rating', 1, '👍', 'War gut')}${icon(id, 'rating', -1, '👎', 'War schlecht')}${icon(id, 'dishes', undefined, '🧽', 'War zu viel Abwasch')}${icon(id, 'tooComplex', undefined, '⏱️', 'War zu aufwendig')}
        </div></li>`
          )
          .join('')}</ul></section>`
      : '';
  const w = fb.week?.weight;
  const goal = S.settings.goalWeight;
  const diff = w != null && goal ? Math.round((w - goal) * 10) / 10 : null;
  const goalText = diff == null ? '' : Math.abs(diff) < 0.05 ? '🎉 Ziel erreicht!' : `Noch ${fmtKg(Math.abs(diff))} kg bis zum Ziel.`;
  return `<header class="top col"><h1>Rückblick</h1><div class="sub">Dein Feedback beeinflusst, wie oft Gerichte künftig vorkommen.</div></header>
    ${trendCard(ws)}
    ${weekPager(ws, weeks)}
    ${hints.length ? `<section class="card tip">${hints.map((h) => `<p>💡 ${e(h)}</p>`).join('')}</section>` : ''}
    <section class="card"><h2>Wie war die Woche?</h2>
      ${scale('satiety', 'Sättigung (1 = hungrig, 5 = sehr satt)')}
      ${scale('energy', 'Energie (1 = schlapp, 5 = top)')}
      <div class="grid2">
        <label class="field">Gewicht (kg)<input type="text" inputmode="decimal" placeholder="z. B. 82,4" data-weight data-week="${ws}" value="${fmtKg(w)}"></label>
        <label class="field">Zielgewicht (kg)<input type="text" inputmode="decimal" placeholder="z. B. 80,0" data-goal-weight value="${fmtKg(goal)}"></label>
      </div>
      ${goalText ? `<p class="goal-text">${goalText}</p>` : ''}
    </section>
    ${groupCard('fruehstueck', 'Frühstück')}${groupCard('mittag', 'Mittagessen')}${groupCard('abend', 'Abendessen')}
    ${planningCards}`;
}

/** Zielgewicht erreicht? (Gewicht hat das Ziel getroffen oder überschritten – egal ob ab- oder zunehmend) */
function checkGoal(before, now) {
  const goal = S.settings.goalWeight;
  if (!goal || now == null) return;
  const hit = Math.abs(now - goal) < 0.05 || (before != null && Math.abs(before - goal) >= 0.05 && (before - goal) * (now - goal) < 0);
  if (!hit) return;
  sound.goal();
  confetti();
  toast('🎉 Zielgewicht erreicht – stark!');
}

/** Letztes eingetragenes Gewicht vor der Woche ws */
function lastWeightBefore(ws) {
  return S.feedback
    .filter((f) => f.weekStart < ws && f.week?.weight != null)
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .pop()?.week.weight ?? null;
}

function dayPills(days, action) {
  const set = new Set(days);
  return `<div class="pills days">${DAY_SHORT.map((d, i) => `<button class="pill circle ${set.has(i) ? 'on' : ''}" data-action="${action}" data-day="${i}">${d}</button>`).join('')}</div>`;
}

function updateFeedback(ws, fn) {
  let fb = feedbackFor(ws);
  if (!fb) {
    fb = { weekStart: ws, recipes: {}, week: {} };
    S.feedback.push(fb);
  }
  fn(fb);
  fb.updatedAt = new Date().toISOString();
  store.set('feedback', S.feedback);
}

// --- Einstellungen -----------------------------------------------------------

// Zubereitung/Abwasch werden intern auf die Planer-Regler (0–100) abgebildet
const PREP = [
  ['bis 15min', 95],
  ['15-30min', 60],
  ['ab 30min', 20],
];
const DISHES = [
  ['möglichst fix', 90],
  ['egal', 20],
];
const nearest = (opts, v) => opts.reduce((a, b) => (Math.abs(b[1] - v) < Math.abs(a[1] - v) ? b : a))[1];

function viewSettings() {
  const st = S.settings;
  const pl = plausibility(st.goals);
  const field = (path, label, attrs = '') =>
    `<label class="field">${label}<input type="number" inputmode="numeric" data-set="${path}" value="${getPath(st, path)}" ${attrs}></label>`;
  const seg = (opts, key) => {
    const cur = nearest(opts, st.sliders[key]);
    return `<div class="seg">${opts.map(([label, v]) => `<button class="pill ${cur === v ? 'on' : ''}" data-action="slider" data-key="${key}" data-val="${v}">${label}</button>`).join('')}</div>`;
  };
  return `<header class="top"><h1>Einstellungen</h1></header>

  <section class="card accent"><h2>Tagesziele</h2>
    <div class="grid2">
      ${field('goals.kcal', 'Kalorien (kcal)', 'step="50"')}
      ${field('goals.protein', 'Protein (g)', 'step="5"')}
      ${field('goals.carbs', 'Kohlenhydrate (g)', 'step="5"')}
      ${field('goals.fat', 'Fett (g)', 'step="5"')}
    </div>
    ${pl.ok ? '' : `<p class="warn-text">⚠️ ${e(pl.message)}</p>`}
    ${!pl.ok && pl.suggestedCarbs > 0 ? `<button class="btn small pill" data-action="fix-carbs" data-val="${pl.suggestedCarbs}">Kohlenhydrate auf ${pl.suggestedCarbs} g setzen</button>` : ''}
  </section>

  <section class="card"><h2>Feineinstellungen</h2>
    <div class="field">Zubereitung${seg(PREP, 'simple')}</div>
    <div class="field">Abwasch${seg(DISHES, 'dishes')}</div>
  </section>

  <section class="card"><h2>Wann isst du auswärts?</h2>
    <p class="sub">Tippe die Tage an. Sie werden mit ca. ${num(st.eatOutKcal)} kcal eingerechnet; an diesen Tagen wird entsprechend weniger gekocht. Du kannst das im Rückblick für jede Woche ändern.</p>
    ${dayPills(eatOutDays(st.eatOut), 'eatout-day')}
  </section>

  <section class="card"><h2>Einkauf</h2>
    ${STORE_IDS.map((id) => `<label class="row"><input type="checkbox" data-set="stores.${id}" ${st.stores[id] ? 'checked' : ''}> ${e(id === 'edeka' ? 'Edeka No1 Center Schloßstraße (Berlin)' : STORES[id].name)}</label>`).join('')}
    <label class="field">Hauptladen<select data-set="mainStore">${STORE_IDS.filter((id) => st.stores[id])
      .map((id) => `<option value="${id}" ${st.mainStore === id ? 'selected' : ''}>${e(STORES[id].short)}</option>`)
      .join('')}</select></label>
    <p class="sub">Gekauft wird im Hauptladen. Nur wenn ein anderer ausgewählter Laden mindestens 10 % günstiger ist (z. B. durch ein Angebot), landet der Artikel dort. dm und Rossmann führen nur Trockenware, Nüsse & Co.</p>
    ${field('budget', 'Wochenbudget (€)', 'step="1"')}
  </section>

  <section class="card"><h2>Gerichte</h2>
    ${field('complexPerWeek', 'Aufwendige Gerichte pro Woche', 'min="0" max="3"')}
    <div class="field">Abneigungen (werden nicht eingeplant)
      <div class="chips">${st.dislikes.map((d, i) => `<span class="chip soft">${e(d)} <button data-action="del-dislike" data-i="${i}" aria-label="entfernen">×</button></span>`).join('')}</div>
      <div class="add-row"><input id="dislike-new" placeholder="z. B. Pilze"><button class="btn pill" data-action="add-dislike">Hinzufügen</button></div>
    </div>
  </section>

  <section class="card"><h2>Darstellung</h2>
    <label class="field">Design<select data-set="theme"><option value="auto" ${!st.theme || st.theme === 'auto' ? 'selected' : ''}>Automatisch</option><option value="dark" ${st.theme === 'dark' ? 'selected' : ''}>Dunkel</option><option value="light" ${st.theme === 'light' ? 'selected' : ''}>Hell</option></select></label>
    ${field('planHour', 'Neuer Plan montags ab (Uhr)', 'min="0" max="23"')}
    <label class="row"><input type="checkbox" data-set="sounds" ${st.sounds !== false ? 'checked' : ''}> Töne (nur wenn das iPhone nicht lautlos ist)</label>
  </section>

  <section class="card"><h2>KI-Rezepte <span class="sub">(optional, kostenpflichtig)</span></h2>
    <p class="sub">Mit einem eigenen Claude-API-Schlüssel erfindet Mise neue Gerichte: jeden Montag eines für deinen Plan, bei ↻ in der Woche und wenn du unter „Rezepte“ nur einen Titel einträgst. Kosten: ca. 3–5 Cent pro Rezept auf deinem Anthropic-Konto. Der Schlüssel bleibt nur auf diesem Gerät.</p>
    <label class="field">API-Schlüssel<input type="password" autocomplete="off" placeholder="sk-ant-…" data-set="aiKey" value="${e(st.aiKey || '')}"></label>
    <p class="hint">${st.aiKey ? '✓ KI-Rezepte sind aktiv.' : 'Ohne Schlüssel schlägt Mise nur Rezepte aus der Sammlung vor.'} Schlüssel erstellen: console.anthropic.com → API Keys.</p>
  </section>

  <section class="card"><h2>Datensicherung</h2>
    <p class="sub">Alle Daten liegen nur auf diesem Gerät. Exportiere ab und zu eine Sicherung (z. B. in iCloud Drive).</p>
    <div class="grid2"><button class="btn" data-action="export">Exportieren</button>
    <label class="btn">Importieren<input type="file" accept="application/json,.json" id="import-file" hidden></label></div>
    <button class="link danger" data-action="reset-settings">Einstellungen zurücksetzen</button>
  </section>
  <p class="sub center">Mise · Nährwerte aus BLS/Open-Food-Facts-Richtwerten · Preise sind Richtwerte</p>`;
}

// ---------------------------------------------------------------------------
// Timer-Leiste
// ---------------------------------------------------------------------------

function renderTimerDock() {
  const dock = document.getElementById('timer-dock');
  if (!dock || !timers) return;
  dock.innerHTML = timers.timers
    .map(
      (t) => `<div class="timer ${t.done ? 'ringing' : ''} ${t.paused != null ? 'paused' : ''}">
      <b class="tl">${e(t.label)}</b>
      <span class="tt" data-tt="${t.id}">${t.done ? 'Fertig!' : fmtTime(timers.remaining(t), true)}</span>
      ${
        t.done
          ? `<button class="btn small primary pill" data-action="t-del" data-id="${t.id}">OK</button>`
          : `<button class="round-btn" data-action="t-toggle" data-id="${t.id}" aria-label="Pause">${t.paused != null ? '▶' : 'II'}</button>`
      }
      <button class="round-btn" data-action="t-del" data-id="${t.id}" aria-label="Beenden">✕</button>
    </div>`
    )
    .join('');
  document.body.classList.toggle('has-timers', timers.timers.length > 0);
}

function updateTimerDock() {
  if (!timers) return;
  if (document.querySelectorAll('[data-tt]').length !== timers.timers.length) return renderTimerDock();
  for (const t of timers.timers) {
    const el = document.querySelector(`[data-tt="${t.id}"]`);
    if (!el) return renderTimerDock();
    if (t.done && !el.closest('.timer').classList.contains('ringing')) return renderTimerDock();
    const txt = t.done ? 'Fertig!' : fmtTime(timers.remaining(t), true);
    if (el.textContent !== txt) el.textContent = txt;
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function toggleDay(list, day) {
  const i = list.indexOf(day);
  if (i >= 0) list.splice(i, 1);
  else list.push(day);
  list.sort();
}

async function onClick(ev) {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const plan = displayedPlan();
  switch (a) {
    case 'toggle-eval':
      S.ui.evalOpen = !S.ui.evalOpen;
      return render();
    case 'toggle-day':
      S.ui.openDays[Number(el.dataset.day)] = el.dataset.open !== '1';
      if (el.dataset.open !== '1') fx(`.day[data-day="${el.dataset.day}"] .meals, .day[data-day="${el.dataset.day}"] .bars`, 'unfold');
      return render();
    case 'toggle-done':
      plan.done ||= {};
      plan.done[el.dataset.key] = !plan.done[el.dataset.key];
      savePlans();
      return render();
    case 'swap': {
      // ↻ = neues Rezept: mit KI frisch erfunden, sonst zufällig aus der Sammlung
      const key = el.dataset.key;
      const type = key.endsWith('fruehstueck') ? 'breakfast' : 'main';
      let chosen = null;
      if (S.settings.aiKey) {
        busy('Mise erfindet ein neues Rezept …');
        try {
          chosen = (await aiRecipe({ type })).id;
        } catch (err) {
          toast(err.message);
        } finally {
          busy(null);
        }
      }
      const next = swapMeal(plan, key, plannerInput({ weekStart: plan.weekStart }), chosen);
      next.done = plan.done || {};
      S.plans[plan.weekStart] = next;
      savePlans();
      toast(chosen ? 'Neues Rezept eingeplant ✨' : 'Gericht getauscht – Einkaufsliste aktualisiert');
      fx(`.meal[data-key="${key}"]`, 'swapped');
      return render();
    }
    case 'choose': {
      const next = swapMeal(plan, el.dataset.key, plannerInput({ weekStart: plan.weekStart }), el.dataset.id);
      next.done = plan.done || {};
      S.plans[plan.weekStart] = next;
      savePlans();
      S.ui.search = '';
      fx(`.meal[data-key="${el.dataset.key}"]`, 'swapped');
      location.hash = '#/woche';
      toast('Rezept übernommen – Einkaufsliste aktualisiert');
      return;
    }
    case 'first-plan':
    case 'plan-now':
      el.disabled = true;
      store.set('welcomed', true);
      await createPlanFromDraft();
      S.ui.openDays = {};
      location.hash = '#/woche';
      render();
      toast('Dein Wochenplan ist fertig!');
      return;
    case 'new-recipe': {
      const type = el.dataset.type;
      const title = (S.ui.newTitle[type] || '').trim();
      if (!title) return toast('Bitte zuerst einen Titel eintragen');
      S.ui.newTitle[type] = '';
      if (S.settings.aiKey) {
        busy(`Mise erfindet „${title}“ …`);
        try {
          const r = await aiRecipe({ title, type });
          location.hash = `#/rezept/${r.id}`;
        } catch (err) {
          toast(err.message);
        } finally {
          busy(null);
        }
        return;
      }
      S.ui.edit = { id: `u_${Date.now().toString(36)}`, name: title, type, time: 20, dishes: 1, effort: 1, mealPrep: false, tags: [], protein: '', ingredients: [], steps: [{ t: '' }], source: 'eigen' };
      location.hash = `#/bearbeiten/${S.ui.edit.id}`;
      return;
    }
    case 'edit-add-ing':
      S.ui.edit.ingredients.push({ id: 'eier', g: 100 });
      return render();
    case 'edit-del-ing':
      S.ui.edit.ingredients.splice(Number(el.dataset.n), 1);
      return render();
    case 'edit-add-step':
      S.ui.edit.steps.push({ t: '' });
      return render();
    case 'edit-del-step':
      S.ui.edit.steps.splice(Number(el.dataset.n), 1);
      return render();
    case 'edit-cancel':
      S.ui.edit = null;
      return;
    case 'edit-ai': {
      const d = S.ui.edit;
      if (!d.name.trim()) return toast('Bitte zuerst einen Titel eintragen');
      busy(`Mise erfindet „${d.name}“ …`);
      try {
        const r = await inventRecipe({ apiKey: S.settings.aiKey, title: d.name, type: d.type, ingredients: [...S.idx.values()], avoid: [], dislikes: S.settings.dislikes });
        S.ui.edit = { ...r, id: d.id, name: d.name, source: d.source === 'eigen' ? 'ki' : d.source };
      } catch (err) {
        toast(err.message);
      } finally {
        busy(null);
      }
      return render();
    }
    case 'edit-save': {
      const d = S.ui.edit;
      const r = cleanRecipe(d, d.type, S.ingData.items);
      if (!r.ingredients.length) return toast('Bitte mindestens eine Zutat eintragen');
      if (!r.steps.length) return toast('Bitte mindestens einen Schritt eintragen');
      r.source = d.source || 'eigen';
      saveCustom(r);
      S.ui.edit = null;
      location.hash = `#/rezept/${r.id}`;
      toast('Rezept gespeichert');
      return;
    }
    case 'edit-delete': {
      const id = S.ui.edit.id;
      const builtin = S.builtin.some((b) => b.id === id);
      if (!confirm(builtin ? 'Deine Änderungen verwerfen und das Original wiederherstellen?' : 'Dieses Rezept löschen?')) return;
      S.custom = S.custom.filter((r) => r.id !== id);
      store.set('customRecipes', S.custom);
      rebuildRecipes();
      S.ui.edit = null;
      location.hash = builtin ? `#/rezept/${id}` : '#/rezepte';
      return;
    }
    case 'draft-day':
      toggleDay(nextDraft().days, Number(el.dataset.day));
      saveNext();
      return render();
    case 'pantry-del':
      nextDraft().items.splice(Number(el.dataset.n), 1);
      saveNext();
      return render();
    case 'pantry-guess':
      nextDraft().items.push({ id: el.dataset.id, g: Number(el.dataset.g) });
      saveNext();
      fx(`.pantry li[data-pid="${el.dataset.id}"]`, 'unfold');
      return render();
    case 'chart-tip': {
      const tip = el.closest('.charts')?.querySelector('.chart-tip');
      if (tip) tip.textContent = el.dataset.tip;
      return;
    }
    case 'eatout-day': {
      const days = eatOutDays(S.settings.eatOut);
      toggleDay(days, Number(el.dataset.day));
      S.settings.eatOut = daysToEatOut(days);
      saveSettings();
      return render();
    }
    case 'slider':
      S.settings.sliders[el.dataset.key] = Number(el.dataset.val);
      saveSettings();
      return render();
    case 'timer':
      timers.start(el.dataset.label, Number(el.dataset.sec), el.dataset.ctx);
      sound.timerStart();
      toast(`Timer „${el.dataset.label}“ läuft`);
      return;
    case 't-toggle':
      return timers.toggle(el.dataset.id);
    case 't-del':
      return timers.remove(el.dataset.id);
    case 'cook-step':
      S.ui.cookStep = Math.max(0, S.ui.cookStep + Number(el.dataset.d));
      fx('.step-text', Number(el.dataset.d) > 0 ? 'step-next' : 'step-prev');
      return render();
    case 'cook-done': {
      sound.cookDone();
      const ov = document.createElement('div');
      ov.className = 'done-overlay';
      ov.innerHTML = `<div class="done-box"><svg viewBox="0 0 52 52" class="done-check"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg><h2>Guten Appetit!</h2></div>`;
      document.body.appendChild(ov);
      setTimeout(() => {
        ov.classList.add('out');
        location.hash = el.dataset.back || '#/woche';
        setTimeout(() => ov.remove(), 300);
      }, 1600);
      return;
    }
    case 'servings':
      S.ui.servings = Number(el.dataset.n);
      return render();
    case 'check': {
      if (ev.target.closest('a')) return; // Link zum Rezept nicht als Abhaken werten
      const ws = plan.weekStart;
      S.checks[ws] ||= {};
      const on = (S.checks[ws][el.dataset.id] = !S.checks[ws][el.dataset.id]);
      store.set('checks', S.checks);
      if (on) sound.check();
      else sound.uncheck();
      if (on) fx(`.shop-item[data-id="${el.dataset.id}"] .check`);
      return render();
    }
    case 'toggle-hide':
      S.ui.hideChecked = !S.ui.hideChecked;
      return render();
    case 'fb': {
      const { week, id, field, val } = el.dataset;
      updateFeedback(week, (fb) => {
        const r = (fb.recipes[id] ||= {});
        if (field === 'rating') r.rating = r.rating === Number(val) ? 0 : Number(val);
        else r[field] = !r[field];
      });
      fx(`[data-action="fb"][data-id="${id}"][data-field="${field}"][data-val="${val}"].on`);
      return render();
    }
    case 'fbw':
      updateFeedback(el.dataset.week, (fb) => {
        fb.week ||= {};
        fb.week[el.dataset.field] = Number(el.dataset.val);
      });
      fx(`[data-action="fbw"][data-field="${el.dataset.field}"].on`);
      return render();
    case 'fix-carbs':
      S.settings.goals.carbs = Number(el.dataset.val);
      saveSettings();
      return render();
    case 'add-dislike': {
      const v = document.getElementById('dislike-new').value.trim();
      if (v) S.settings.dislikes.push(v);
      saveSettings();
      return render();
    }
    case 'del-dislike':
      S.settings.dislikes.splice(Number(el.dataset.i), 1);
      saveSettings();
      return render();
    case 'export':
      return doExport();
    case 'reset-settings':
      if (confirm('Alle Einstellungen auf Standard zurücksetzen? Pläne und Feedback bleiben erhalten.')) {
        S.settings = clone(DEFAULT_SETTINGS);
        saveSettings();
        applyTheme();
        render();
      }
      return;
  }
}

function onChange(ev) {
  const el = ev.target;
  if (S.ui.edit && (el.dataset.edit || el.dataset.editIng !== undefined || el.dataset.editStep !== undefined)) return editField(el);
  if (el.dataset.set) {
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number') v = Number(v);
    setPath(S.settings, el.dataset.set, v);
    if (!STORE_IDS.some((id) => S.settings.stores[id])) S.settings.stores.lidl = true;
    if (!S.settings.stores[S.settings.mainStore]) S.settings.mainStore = STORE_IDS.find((id) => S.settings.stores[id]);
    saveSettings();
    if (el.dataset.set === 'theme') applyTheme();
    setSoundsEnabled(S.settings.sounds);
    render();
    return;
  }
  if (el.dataset.pantryG !== undefined) {
    nextDraft().items[Number(el.dataset.pantryG)].g = Number(el.value);
    saveNext();
    return;
  }
  if (el.dataset.pantryAdd !== undefined && el.value) {
    const d = nextDraft();
    const guess = leftoverGuesses(d).find((x) => x.id === el.value);
    if (!d.items.some((x) => x.id === el.value)) d.items.push({ id: el.value, g: guess?.g || 100 });
    saveNext();
    fx(`.pantry li[data-pid="${el.value}"]`, 'unfold');
    return render();
  }
  if (el.dataset.weight !== undefined) {
    const ws = el.dataset.week;
    const v = parseKg(el.value);
    const before = feedbackFor(ws)?.week?.weight ?? lastWeightBefore(ws);
    updateFeedback(ws, (fb) => {
      fb.week ||= {};
      fb.week.weight = v;
    });
    render();
    if (v !== before) checkGoal(before, v);
    return;
  }
  if (el.dataset.goalWeight !== undefined) {
    S.settings.goalWeight = parseKg(el.value);
    saveSettings();
    return render();
  }
  if (el.id === 'import-file' && el.files?.[0]) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importAll(JSON.parse(reader.result));
        toast('Sicherung importiert');
        setTimeout(() => location.reload(), 600);
      } catch (err) {
        alert(err.message);
      }
    };
    reader.readAsText(el.files[0]);
  }
}

let searchTimer;
function onInput(ev) {
  const el = ev.target;
  if (el.dataset.search) {
    S.ui.search = el.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const pos = el.selectionStart;
      render();
      const again = document.querySelector('[data-search]');
      again?.focus();
      again?.setSelectionRange?.(pos, pos);
    }, 250);
    return;
  }
  if (el.dataset.newTitle) {
    S.ui.newTitle[el.dataset.newTitle] = el.value;
    return;
  }
  if (S.ui.edit) editField(el);
}

/** Eingaben im Rezept-Editor in den Entwurf übernehmen (ohne neu zu zeichnen) */
function editField(el) {
  const d = S.ui.edit;
  if (el.dataset.edit) {
    const f = el.dataset.edit;
    d[f] = el.type === 'checkbox' ? el.checked : ['time', 'dishes', 'effort'].includes(f) ? Number(el.value) : el.value;
  } else if (el.dataset.editIng !== undefined) {
    const l = d.ingredients[Number(el.dataset.editIng)];
    l[el.dataset.f] = el.dataset.f === 'g' ? Number(el.value) : el.value;
  } else if (el.dataset.editStep !== undefined) {
    const st = d.steps[Number(el.dataset.editStep)];
    if (el.dataset.f === 'timer') {
      const min = Number(String(el.value).replace(',', '.'));
      if (min > 0) st.timer = Math.round(min * 60);
      else delete st.timer;
    } else st[el.dataset.f] = el.value;
  }
}

async function doExport() {
  const data = JSON.stringify(exportAll(), null, 1);
  const name = `mise-backup-${berlinNow().iso}.json`;
  const file = new File([data], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Mise Sicherung' });
      return;
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Kochmodus beginnt bei Schritt 1; Rezeptansicht startet mit 1 Portion
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#/kochen')) S.ui.cookStep = 0;
  if (location.hash.startsWith('#/rezept/')) S.ui.servings = S.ui.servings || 1;
  if (location.hash.startsWith('#/rezepte')) S.ui.servings = 1;
  if (location.hash.startsWith('#/waehlen')) S.ui.search = '';
});

init();
