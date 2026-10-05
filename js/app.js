// Michael Food – App-Oberfläche (Vanilla JS, kein Build-Schritt).
import { DAY_NAMES, DAY_SHORT, SLOT_LABEL, addDays, berlinNow, escapeHtml as e, euro, factorLabel, formatDate, isoWeek, mondayOf, num } from './util.js';
import { buildIndex, plausibility } from './nutrition.js';
import { budgetCost, generatePlan, setEatOut, swapMeal } from './planner.js';
import { mergeOffers, regularPrice, STORES } from './prices.js';
import { amountText, packText } from './shopping.js';
import { recipeWeights, weekHints } from './feedback.js';
import { DEFAULT_SETTINGS, mergeSettings } from './settings.js';
import { exportAll, importAll, prunePlans, requestPersistence, store } from './storage.js';
import { TimerManager, fmtTime, keepAwake, unlockAudio } from './timers.js';
import { generateVapidKeys, pushSupport, subscribePush, testNotification } from './push.js';

const S = {
  ingData: null,
  idx: null,
  recipes: [],
  recipesById: new Map(),
  offers: null,
  settings: mergeSettings(store.get('settings')),
  plans: store.get('plans', {}),
  checks: store.get('checks', {}),
  feedback: store.get('feedback', []),
  manualOffers: store.get('manualOffers', []),
  push: store.get('push', {}),
  ui: { hideChecked: false, cookStep: 0, openDays: {}, draftPantry: null, evalOpen: false },
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
  applyTheme();
  try {
    const [ing, rec] = await Promise.all([loadJSON('data/ingredients.json'), loadJSON('data/recipes.json')]);
    S.ingData = ing;
    S.idx = buildIndex(ing);
    S.recipes = rec.recipes;
    S.recipesById = new Map(S.recipes.map((r) => [r.id, r]));
  } catch (err) {
    app.innerHTML = `<main class="view"><div class="card warn"><h2>Daten konnten nicht geladen werden</h2><p>${e(err.message)}</p><p>Bitte Internetverbindung prüfen und neu laden.</p></div></main>`;
    return;
  }
  try {
    S.offers = await loadJSON('data/offers.json');
  } catch {
    S.offers = null; // still: Richtpreise
  }
  timers = new TimerManager((tickOnly) => (tickOnly ? updateTimerDock() : renderTimerDock()));
  window.addEventListener('hashchange', render);
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  registerSW();
  requestPersistence();
  checkSchedule();
  setInterval(checkSchedule, 60_000);
  render();
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
const currentWeek = () => mondayOf();
const ing = (id) => S.idx.get(id);
const recipe = (id) => S.recipesById.get(id);

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

function allOffers() {
  return mergeOffers(S.offers, S.manualOffers);
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
    offers: allOffers(),
    feedbackWeights: recipeWeights(S.feedback),
    weekNo: prevWeeks.length,
    recentRecipes,
    ...extra,
  };
}

function createPlan(pantry, eatOut) {
  const ws = currentWeek();
  const plan = generatePlan(plannerInput({ pantry, settings: { ...S.settings, eatOut: eatOut || S.settings.eatOut } }));
  plan.done = {};
  S.plans[ws] = plan;
  savePlans();
  S.checks[ws] = {};
  store.set('checks', S.checks);
  store.set('lastPantry', { week: ws, pantry });
  return plan;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('In die Zwischenablage kopiert');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Kopiert');
  }
}

// ---------------------------------------------------------------------------
// Montags-Automatik & Sonntags-Feedback
// ---------------------------------------------------------------------------

function checkSchedule() {
  const ws = currentWeek();
  if (S.plans[ws]) return;
  const b = berlinNow();
  const hasPrev = !!previousPlan();
  const tooEarly = b.weekday === 0 && b.hour < (S.settings.planHour ?? 9) && hasPrev;
  if (!tooEarly && !location.hash.startsWith('#/planen') && !location.hash.startsWith('#/einstellungen')) {
    location.hash = '#/planen';
  }
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
  if (lastRoute.startsWith('kochen') && r.name !== 'kochen') keepAwake(false);
  lastRoute = r.name;
  const views = {
    woche: viewWeek,
    planen: viewPlanning,
    einkauf: viewShopping,
    rueckblick: viewReview,
    einstellungen: viewSettings,
    mahlzeit: viewMeal,
    rezepte: viewRecipes,
    rezept: viewRecipeBase,
    kochen: viewCooking,
  };
  const fn = views[r.name] || viewWeek;
  const tab = { woche: 'woche', mahlzeit: 'woche', kochen: 'woche', rezepte: 'woche', rezept: 'woche', planen: 'woche', einkauf: 'einkauf', rueckblick: 'rueckblick', einstellungen: 'einstellungen' }[r.name] || 'woche';
  app.innerHTML = `
    <main class="view" id="view">${fn(...r.args)}</main>
    <div id="timer-dock"></div>
    <nav class="tabbar">
      ${tabBtn('woche', '🗓️', 'Woche', tab)}
      ${tabBtn('einkauf', '🛒', 'Einkauf', tab)}
      ${tabBtn('rueckblick', '💬', 'Rückblick', tab)}
      ${tabBtn('einstellungen', '⚙️', 'Einstellungen', tab)}
    </nav>`;
  renderTimerDock();
  if (r.name !== lastRenderedName) window.scrollTo(0, 0);
  lastRenderedName = r.name;
}
let lastRenderedName = '';

const tabBtn = (id, icon, label, active) =>
  `<a href="#/${id}" class="tab ${active === id ? 'active' : ''}"><span class="tab-icon">${icon}</span><span>${label}</span></a>`;

function macroLine(m, cls = '') {
  return `<span class="macros ${cls}"><b>${num(m.kcal)}</b> kcal · <b>${num(m.p)}</b> g P · ${num(m.c)} g KH · ${num(m.f)} g F</span>`;
}

function bar(value, target, label, unit = '') {
  const pct = Math.min(130, (value / target) * 100);
  const ok = Math.abs(value - target) / target <= 0.05 || (label === 'Protein' && value >= target * 0.97);
  return `<div class="bar"><div class="bar-label"><span>${label}</span><span>${num(value)}${unit} / ${num(target)}${unit}</span></div>
    <div class="bar-track"><div class="bar-fill ${ok ? 'ok' : value < target ? 'low' : 'high'}" style="width:${Math.min(100, pct)}%"></div></div></div>`;
}

// --- Woche -------------------------------------------------------------------

function viewWeek() {
  const plan = displayedPlan();
  const ws = currentWeek();
  const b = berlinNow();
  if (!plan) {
    return `<header class="top"><h1>Michael Food</h1></header>
      <div class="card"><h2>Willkommen! 👋</h2><p>Die App plant deine Woche so, dass dein Einkauf deine Kalorien- und Proteinziele schon erfüllt – kein Tracking nötig.</p>
      <p>Prüfe am besten zuerst kurz die <a href="#/einstellungen">Einstellungen</a> (Ziele, Auswärtsessen, Budget).</p>
      <a class="btn primary block" href="#/planen">Ersten Wochenplan erstellen</a></div>`;
  }
  const isCurrent = plan.weekStart === ws;
  const banners = [];
  if (!isCurrent) {
    banners.push(`<div class="banner">Neue Woche! Der neue Plan wird ab ${S.settings.planHour ?? 9}:00 Uhr erstellt.
      <a class="btn small" href="#/planen">Jetzt planen</a></div>`);
  }
  if (isCurrent && b.weekday >= 5 && !feedbackFor(ws)) {
    banners.push(`<div class="banner">Wie war die Woche? Dein Feedback verbessert die nächsten Pläne. <a class="btn small" href="#/rueckblick">Feedback geben</a></div>`);
  }
  if (budgetCost(plan) > S.settings.budget) {
    banners.push(`<div class="banner warn">Der Einkauf liegt bei ${euro(plan.cost)} und damit über deinem Budget von ${euro(S.settings.budget)}. Details unten in der Bewertung.</div>`);
  }
  const todayIdx = isCurrent ? b.weekday : -1;
  const days = plan.days
    .map((d) => {
      const open = S.ui.openDays[d.day] ?? (d.day === todayIdx || todayIdx === -1 ? d.day === Math.max(0, todayIdx) : false);
      return dayCard(plan, d, open, d.day === todayIdx);
    })
    .join('');
  const g = plan.goals;
  const avgK = plan.days.reduce((a, d) => a + d.totals.kcal, 0) / 7;
  const avgP = plan.days.reduce((a, d) => a + d.totals.p, 0) / 7;
  return `
    <header class="top">
      <div><h1>KW ${isoWeek(plan.weekStart)}</h1><div class="sub">${formatDate(plan.weekStart)} – ${formatDate(addDays(plan.weekStart, 6), { day: 'numeric', month: 'long' })}</div></div>
      <a class="btn ghost small" href="#/rezepte">📖 Rezepte</a>
    </header>
    ${banners.join('')}
    <section class="card summary">
      <div class="kpis">
        <div><b>${num(avgK)}</b><span>Ø kcal / ${num(g.kcal)}</span></div>
        <div><b>${num(avgP)} g</b><span>Ø Protein / ${g.protein} g</span></div>
        <div><b>${euro(plan.cost)}</b><span>Einkauf / ${euro(S.settings.budget)}</span></div>
      </div>
      <button class="link" data-action="toggle-eval">${S.ui.evalOpen ? '▾' : '▸'} Bewertung des Plans</button>
      ${S.ui.evalOpen ? evaluationHtml(plan) : ''}
    </section>
    ${days}
    <div class="actions">
      <a class="btn" href="#/einkauf">🛒 Einkaufsliste</a>
      <button class="btn ghost" data-action="replan">🔄 Neu planen</button>
    </div>`;
}

function evaluationHtml(plan) {
  return `<ol class="eval">${(plan.evaluation || [])
    .map((x) => `<li class="${x.level}"><b>${e(x.title)}</b><br>${e(x.text)}</li>`)
    .join('')}</ol>`;
}

function dayCard(plan, d, open, isToday) {
  const g = plan.goals;
  const meals = d.meals
    .map((m) => {
      const done = plan.done?.[m.key];
      if (m.kind === 'eatout') {
        return `<li class="meal eatout"><span class="mi">${ICON.eatout}</span><div class="mt"><div class="ml">${SLOT_LABEL[m.slot]} · auswärts</div>
          <div class="mn">Auswärtsessen (Pauschale)</div><div class="mm">≈ ${num(m.macros.kcal)} kcal · ≈ ${num(m.macros.p)} g P</div></div>
          <button class="icon-btn" data-action="meal-eatout" data-on="0" data-key="${m.key}" title="Doch zu Hause essen">🏠</button></li>`;
      }
      const r = recipe(m.recipeId);
      const cook = m.cookId ? plan.cooks.find((c) => c.id === m.cookId) : null;
      const badges = [];
      if (m.leftover) badges.push('<span class="badge">Rest von gestern</span>');
      else if (cook && cook.portions.length > 1) badges.push('<span class="badge prep">+ Portion für morgen</span>');
      if (r.effort === 3) badges.push('<span class="badge fancy">aufwendig</span>');
      const slotLbl = m.slot === 'snack' ? 'Snack' : SLOT_LABEL[m.slot];
      return `<li class="meal ${done ? 'done' : ''}">
        <button class="check ${done ? 'on' : ''}" data-action="toggle-done" data-key="${m.key}" aria-label="erledigt">${done ? '✓' : ''}</button>
        <a class="mt" href="#/mahlzeit/${m.key}">
          <div class="ml">${ICON[m.slot.startsWith('snack') ? 'snack' : m.slot]} ${slotLbl} · ${r.time} Min. ${badges.join('')}</div>
          <div class="mn">${e(r.name)}</div>
          <div class="mm">${factorLabel(m.factor)} Portion · ${num(m.macros.kcal)} kcal · ${num(m.macros.p)} g P</div>
        </a>
        ${m.slot !== 'snack' ? `<div class="meal-btns">${!m.leftover ? `<button class="icon-btn" data-action="swap" data-key="${m.key}" title="Gericht tauschen">↻</button>` : ''}<button class="icon-btn" data-action="meal-eatout" data-on="1" data-key="${m.key}" title="Auswärts essen">🍴</button></div>` : ''}
      </li>`;
    })
    .join('');
  return `<section class="card day ${isToday ? 'today' : ''}">
    <button class="day-head" data-action="toggle-day" data-day="${d.day}">
      <div><b>${d.name}</b> <span class="sub">${formatDate(d.date)}</span>${isToday ? ' <span class="badge today">heute</span>' : ''}</div>
      <div class="day-k">${num(d.totals.kcal)} kcal · ${num(d.totals.p)} g P <span class="chev">${open ? '▾' : '▸'}</span></div>
    </button>
    ${
      open
        ? `<ul class="meals">${meals}</ul>
      <div class="bars">
        ${bar(d.totals.kcal, g.kcal, 'Kalorien')}
        ${bar(d.totals.p, g.protein, 'Protein', ' g')}
        <div class="mini">KH ${num(d.totals.c)} / ${g.carbs} g · Fett ${num(d.totals.f)} / ${g.fat} g · Ballaststoffe ${num(d.totals.fib)} g · Gemüse/Obst ${num(d.totals.veg)} g · Warenwert ≈ ${euro(d.cost)}</div>
      </div>`
        : ''
    }
  </section>`;
}

// --- Auswärtsessen-Raster (Planung & Einstellungen) --------------------------

function eatOutGrid(list, action) {
  const eo = new Set(list.map((x) => `${x.day}-${x.slot}`));
  return `<table class="eo"><tr><th></th><th>Früh</th><th>Mittag</th><th>Abend</th></tr>
    ${DAY_SHORT.map(
      (d, i) =>
        `<tr><td>${d}</td>${['fruehstueck', 'mittag', 'abend']
          .map((s) => `<td><button class="pill ${eo.has(`${i}-${s}`) ? 'on' : ''}" data-action="${action}" data-day="${i}" data-slot="${s}">${eo.has(`${i}-${s}`) ? '🍴' : '·'}</button></td>`)
          .join('')}</tr>`
    ).join('')}
  </table>`;
}

function toggleInList(list, day, slot) {
  const i = list.findIndex((x) => x.day === day && x.slot === slot);
  if (i >= 0) list.splice(i, 1);
  else list.push({ day, slot });
}

// --- Planung (Auswärtsessen + Reste-Abfrage) ---------------------------------

function viewPlanning() {
  const ws = currentWeek();
  const prev = previousPlan(ws);
  if (!S.ui.draftPantry || S.ui.draftPantry.week !== ws) {
    const items = [];
    const left = prev?.shopping?.leftovers || {};
    for (const [id, g] of Object.entries(left)) {
      const i = ing(id);
      if (!i || g < 5) continue;
      items.push({ id, g, use: i.shelf >= 7 });
    }
    items.sort((a, b) => ing(a.id).name.localeCompare(ing(b.id).name, 'de'));
    S.ui.draftPantry = { week: ws, items };
  }
  if (!S.ui.draftEatOut || S.ui.draftEatOut.week !== ws) {
    S.ui.draftEatOut = { week: ws, list: structuredClone(S.settings.eatOut) };
  }
  const d = S.ui.draftPantry;
  const prevFb = prev && !feedbackFor(prev.weekStart);
  const options = [...S.idx.values()]
    .filter((i) => !i.staple)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    .map((i) => `<option value="${i.id}">${e(i.name)}</option>`)
    .join('');
  return `
    <header class="top"><div><h1>Neue Woche planen</h1><div class="sub">KW ${isoWeek(ws)} · ab ${formatDate(ws)}</div></div></header>
    ${!prev ? `<div class="banner info">Tipp: Prüfe vor dem ersten Plan kurz die <a href="#/einstellungen">Einstellungen</a> (Ziele, Auswärtsessen, Budget, Läden).</div>` : ''}
    ${prevFb ? `<div class="banner">Für letzte Woche fehlt noch dein Feedback. <a class="btn small" href="#/rueckblick/${prev.weekStart}">Kurz nachtragen</a></div>` : ''}
    <section class="card">
      <h2>1. Wann isst du diese Woche auswärts?</h2>
      <p class="sub">Tippe die Mahlzeiten an (${S.ui.draftEatOut.list.length}× ausgewählt). Sie werden mit ca. ${num(S.settings.eatOutKcal)} kcal eingerechnet; an diesen Tagen wird entsprechend weniger gekocht. Später kannst du das in der Wochenansicht bei jeder Mahlzeit mit 🍴 ändern.</p>
      ${eatOutGrid(S.ui.draftEatOut.list, 'draft-eatout')}
    </section>
    <section class="card">
      <h2>2. Was ist von letzter Woche übrig?</h2>
      <p class="sub">${prev ? 'Vorausgefüllt mit den Packungsresten, die die App berechnet hat. Korrigiere, was nicht stimmt – diese Reste werden in dieser Woche zuerst verplant.' : 'Trage ein, was du schon zu Hause hast – das wird zuerst verplant.'}</p>
      <ul class="pantry">
        ${
          d.items.length
            ? d.items
                .map((it, n) => {
                  const i = ing(it.id);
                  return `<li class="${it.use ? '' : 'off'}">
              <label class="row"><input type="checkbox" data-pantry-use="${n}" ${it.use ? 'checked' : ''}> <span>${e(i.name)}${i.shelf < 7 ? ' <small class="muted">(schnell verderblich – noch gut?)</small>' : ''}</span></label>
              <span class="qty"><input type="number" inputmode="numeric" min="0" step="5" value="${it.g}" data-pantry-g="${n}"> g</span>
            </li>`;
                })
                .join('')
            : '<li class="muted">Keine Reste eingetragen.</li>'
        }
      </ul>
      <div class="add-row">
        <select id="pantry-add-id"><option value="">+ Zutat hinzufügen …</option>${options}</select>
        <input id="pantry-add-g" type="number" inputmode="numeric" placeholder="g" min="0" step="5">
        <button class="btn small" data-action="pantry-add">Hinzufügen</button>
      </div>
    </section>
    <button class="btn primary block big" data-action="make-plan">🍽️ Wochenplan erstellen</button>
    <p class="sub center">Der Planer berücksichtigt Ziele, Budget, Reste, Angebote, Feedback und deine Regler.</p>`;
}

// --- Mahlzeit / Rezept -------------------------------------------------------

function findMeal(plan, key) {
  const d = Number(key.split('-')[0]);
  return plan?.days[d]?.meals.find((m) => m.key === key);
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
    const parts = cook.portions.map((p) => `${DAY_SHORT[p.day]} ${SLOT_LABEL[p.slot]} (${factorLabel(p.factor)})`).join(' + ');
    info = `<div class="banner info">🍱 Meal-Prep: Du kochst ${num(cook.totalFactor, 2)} Portionen für <b>${parts}</b>. ${meal.leftover ? 'Heute isst du den vorgekochten Rest – nur aufwärmen.' : 'Füll die zweite Portion direkt ab.'}</div>`;
  }
  const back = `<a class="back" href="#/woche">‹ Woche</a>`;
  return recipeHtml(r, items, meal.macros, `${DAY_NAMES[meal.key.split('-')[0]]} · ${meal.slot.startsWith('snack') ? 'Snack' : SLOT_LABEL[meal.slot]} · ${factorLabel(meal.factor)} Portion`, back, info, key);
}

function viewRecipes() {
  const groups = { main: 'Hauptgerichte', breakfast: 'Frühstück', snack: 'Snacks & Desserts' };
  const fbw = recipeWeights(S.feedback);
  return `<header class="top"><a class="back" href="#/woche">‹ Woche</a><h1>Rezepte</h1></header>
    ${Object.entries(groups)
      .map(
        ([t, label]) => `<section class="card"><h2>${label}</h2><ul class="list">
        ${S.recipes
          .filter((r) => r.type === t)
          .map((r) => {
            const w = fbw[r.id]?.weight;
            return `<li><a href="#/rezept/${r.id}"><span>${e(r.name)}</span><small>${r.time} Min. · ${'🧽'.repeat(Math.max(1, r.dishes))}${w > 1.15 ? ' · 👍' : w < 0.85 ? ' · 👎' : ''}${r.season ? ' · saisonal' : ''}</small></a></li>`;
          })
          .join('')}</ul></section>`
      )
      .join('')}`;
}

function viewRecipeBase(id) {
  const r = recipe(id);
  if (!r) return `<div class="card">Rezept nicht gefunden.</div>`;
  const items = r.ingredients.filter((l) => !l.opt || S.settings[l.opt]).map((l) => ({ id: l.id, g: l.g, note: l.note }));
  const m = items.reduce(
    (a, it) => {
      const i = ing(it.id);
      const k = it.g / 100;
      return { kcal: a.kcal + i.kcal * k, p: a.p + i.p * k, c: a.c + i.c * k, f: a.f + i.f * k };
    },
    { kcal: 0, p: 0, c: 0, f: 0 }
  );
  return recipeHtml(r, items, m, 'Basisrezept · 1 Portion', `<a class="back" href="#/rezepte">‹ Rezepte</a>`, '', 'r:' + id);
}

function recipeHtml(r, items, macros, subtitle, back, info, cookKey) {
  const ingList = items
    .map((it) => {
      const i = ing(it.id);
      return `<li><span>${e(i.name)}${it.note ? ` <small class="muted">${e(it.note)}</small>` : ''}${it.extra ? ` <small class="badge">+${Math.round(it.extra)} g Restverwertung</small>` : ''}</span><b>${amountText(i, it.g)}</b></li>`;
    })
    .join('');
  const steps = r.steps
    .map(
      (s, n) => `<li><p>${e(s.t)}</p>${s.timer ? `<button class="btn small timer-btn" data-action="timer" data-sec="${s.timer}" data-label="${e(s.label || 'Schritt ' + (n + 1))}" data-ctx="${e(r.name)}">⏱ ${e(s.label || '')} ${fmtTime(s.timer)}</button>` : ''}</li>`
    )
    .join('');
  return `<header class="top">${back}</header>
    <section class="card">
      <div class="sub">${e(subtitle)}</div>
      <h1 class="rtitle">${e(r.name)}</h1>
      <div class="chips"><span class="chip">⏱ ${r.time} Min.</span><span class="chip">🧽 Abwasch ${r.dishes}</span><span class="chip">${['', 'einfach', 'normal', 'aufwendig'][r.effort]}</span><span class="chip">💪 ${e(r.protein)}</span></div>
      ${macroLine(macros)}
    </section>
    ${info}
    <section class="card"><h2>Zutaten</h2><ul class="ings">${ingList}</ul></section>
    <section class="card"><h2>Zubereitung</h2><ol class="steps">${steps}</ol>
      <p class="hint">Timer laufen zuverlässig, solange die App geöffnet ist. iOS pausiert Web-Apps im Hintergrund.</p>
      <a class="btn primary block" href="#/kochen/${encodeURIComponent(cookKey)}">👨‍🍳 Kochmodus starten</a>
    </section>
    ${r.tip ? `<section class="card tip">💡 ${e(r.tip)}</section>` : ''}`;
}

function viewCooking(key) {
  let r;
  let items;
  if (key.startsWith('r:')) {
    r = recipe(key.slice(2));
    items = r?.ingredients.map((l) => ({ id: l.id, g: l.g }));
  } else {
    const plan = displayedPlan();
    const meal = findMeal(plan, key);
    if (meal) {
      r = recipe(meal.recipeId);
      const cook = meal.cookId ? plan.cooks.find((c) => c.id === meal.cookId) : null;
      items = cook ? cook.items : meal.items;
    }
  }
  if (!r) return `<div class="card">Nicht gefunden.</div>`;
  keepAwake(true).then((ok) => {
    const el = document.getElementById('wake-state');
    if (el) el.textContent = ok ? '🔆 Bildschirm bleibt an' : '⚠️ Bildschirm-Sperre konnte nicht verhindert werden';
  });
  const n = Math.min(S.ui.cookStep, r.steps.length - 1);
  const s = r.steps[n];
  return `<div class="cook">
    <header class="top"><a class="back" href="javascript:history.back()">‹ Zurück</a><span id="wake-state" class="sub"></span></header>
    <div class="sub">${e(r.name)}</div>
    <div class="step-count">Schritt ${n + 1} von ${r.steps.length}</div>
    <p class="step-text">${e(s.t)}</p>
    ${s.timer ? `<button class="btn primary block big" data-action="timer" data-sec="${s.timer}" data-label="${e(s.label || 'Schritt ' + (n + 1))}" data-ctx="${e(r.name)}">⏱ Timer ${fmtTime(s.timer)} starten</button>` : ''}
    <div class="cook-nav">
      <button class="btn big" data-action="cook-step" data-d="-1" ${n === 0 ? 'disabled' : ''}>‹ Zurück</button>
      <button class="btn big primary" data-action="cook-step" data-d="1" ${n === r.steps.length - 1 ? 'disabled' : ''}>Weiter ›</button>
    </div>
    <details class="card"><summary>Zutaten anzeigen</summary><ul class="ings">${items
      .map((it) => `<li><span>${e(ing(it.id).name)}</span><b>${amountText(ing(it.id), it.g)}</b></li>`)
      .join('')}</ul></details>
  </div>`;
}

// --- Einkaufsliste -----------------------------------------------------------

function viewShopping() {
  const plan = displayedPlan();
  if (!plan) return `<header class="top"><h1>Einkauf</h1></header><div class="card">Noch kein Plan. <a href="#/planen">Jetzt planen</a></div>`;
  const ws = plan.weekStart;
  const checks = (S.checks[ws] ||= {});
  const sh = plan.shopping;
  const toBuy = sh.items.filter((i) => i.packs > 0);
  const fromPantry = sh.items.filter((i) => i.packs === 0);
  const openCost = toBuy.filter((i) => !checks[i.id]).reduce((a, i) => a + i.cost, 0);
  const cats = S.ingData.categories;
  const stores = [...new Set(toBuy.map((i) => i.store))].sort((a, b) => (a === S.settings.mainStore ? -1 : b === S.settings.mainStore ? 1 : 0));
  const offerInfo = S.offers?.updated
    ? `Angebote: Stand ${new Date(S.offers.updated).toLocaleDateString('de-DE')}${S.manualOffers.length ? ' + manuelle Angebote' : ''}`
    : S.manualOffers.length
      ? 'Angebote: nur manuell erfasste'
      : 'Keine aktuellen Angebote – Richtpreise';
  const itemRow = (it) => {
    const done = checks[it.id];
    if (S.ui.hideChecked && done) return '';
    return `<li class="shop-item ${done ? 'done' : ''}" data-action="check" data-id="${it.id}">
      <span class="check ${done ? 'on' : ''}">${done ? '✓' : ''}</span>
      <div class="si">
        <div class="si-top"><b>${e(it.name)}</b><span>${euro(it.cost)}</span></div>
        <div class="si-sub">${packText(it)} · benötigt ${num(it.need)} g${it.have ? ` (davon ${num(it.have)} g Rest)` : ''}${it.offer ? ` · <span class="badge offer">Angebot ${euro(it.price)} statt ${euro(it.regular)}</span>` : ''}</div>
        <div class="si-uses">für: ${it.uses.map(e).join(', ')}</div>
        ${it.note ? `<div class="si-uses">ℹ️ ${e(it.note)}</div>` : ''}
      </div></li>`;
  };
  const storeBlocks = stores
    .map((st) => {
      const list = toBuy.filter((i) => i.store === st);
      const sum = list.reduce((a, i) => a + i.cost, 0);
      return `<section class="card"><h2>${e(STORES[st]?.name || st)} <span class="sub">${euro(sum)}</span></h2>
        ${cats
          .map((c) => {
            const rows = list.filter((i) => i.cat === c).map(itemRow).join('');
            return rows ? `<h3>${e(c)}</h3><ul class="shop">${rows}</ul>` : '';
          })
          .join('')}</section>`;
    })
    .join('');
  return `<header class="top"><div><h1>Einkauf</h1><div class="sub">KW ${isoWeek(ws)} · ${e(offerInfo)}</div></div>
      <button class="btn ghost small" data-action="toggle-hide">${S.ui.hideChecked ? 'Alle zeigen' : 'Erledigte ausblenden'}</button></header>
    <section class="card summary"><div class="kpis">
      <div><b>${euro(plan.cost)}</b><span>Gesamt</span></div>
      <div><b>${euro(openCost)}</b><span>noch offen</span></div>
      <div><b>${toBuy.filter((i) => checks[i.id]).length}/${toBuy.length}</b><span>erledigt</span></div>
    </div>
    ${sh.stockEuro > 2 ? `<p class="sub">Davon ca. ${euro(sh.stockEuro)} für haltbaren Vorrat (z. B. Reis, Nudeln), der in den nächsten Wochen weiterverwendet wird.</p>` : ''}
    </section>
    ${storeBlocks}
    ${
      fromPantry.length
        ? `<section class="card"><h2>Schon zu Hause (Reste)</h2><ul class="list plain">${fromPantry.map((i) => `<li><span>${e(i.name)}</span><small>${num(i.need)} g für ${i.uses.map(e).join(', ')}</small></li>`).join('')}</ul></section>`
        : ''
    }
    <section class="card"><h2>Vorrat prüfen</h2><p class="sub">Basics, die meist zu Hause sind – nur bei Bedarf kaufen (nicht im Preis enthalten).</p>
      <ul class="list plain">${sh.staples.map((s) => `<li><span>${e(s.name)}</span><small>${num(s.g)} g · ${s.uses.map(e).join(', ')}</small></li>`).join('')}</ul></section>
    ${
      Object.keys(sh.leftovers).length
        ? `<details class="card"><summary><b>Bleibt voraussichtlich übrig (${Object.keys(sh.leftovers).length})</b></summary><p class="sub">Wird dir nächsten Montag zur Weiterverwendung vorgeschlagen.</p>
      <ul class="list plain">${Object.entries(sh.leftovers)
        .map(([id, g]) => `<li><span>${e(ing(id).name)}</span><small>${num(g)} g</small></li>`)
        .join('')}</ul></details>`
        : ''
    }`;
}

// --- Rückblick (Feedback) ----------------------------------------------------

function viewReview(weekArg) {
  const weeks = Object.keys(S.plans).sort().reverse();
  if (!weeks.length) return `<header class="top"><h1>Rückblick</h1></header><div class="card">Noch keine Woche geplant.</div>`;
  const ws = weekArg && S.plans[weekArg] ? weekArg : weeks[0];
  const plan = S.plans[ws];
  const fb = feedbackFor(ws) || { weekStart: ws, recipes: {}, week: {} };
  const ids = [...new Set([...plan.cooks.map((c) => c.recipeId), ...plan.days.flatMap((d) => d.meals.filter((m) => m.kind === 'recipe' && m.slot !== 'mittag' && m.slot !== 'abend').map((m) => m.recipeId))])];
  const hints = weekHints(S.feedback, S.settings.goals);
  const toggle = (id, field, val, label) => {
    const cur = fb.recipes[id]?.[field];
    const on = val === undefined ? !!cur : cur === val;
    return `<button class="pill ${on ? 'on' : ''}" data-action="fb" data-week="${ws}" data-id="${id}" data-field="${field}" data-val="${val === undefined ? '' : val}">${label}</button>`;
  };
  const scale = (field, label) =>
    `<div class="scale"><span>${label}</span><div>${[1, 2, 3, 4, 5]
      .map((v) => `<button class="pill ${fb.week?.[field] === v ? 'on' : ''}" data-action="fbw" data-week="${ws}" data-field="${field}" data-val="${v}">${v}</button>`)
      .join('')}</div></div>`;
  return `<header class="top"><div><h1>Rückblick</h1><div class="sub">Dein Feedback beeinflusst, wie oft Gerichte künftig vorkommen.</div></div></header>
    <div class="weekpick">${weeks
      .slice(0, 6)
      .map((w) => `<a class="pill ${w === ws ? 'on' : ''}" href="#/rueckblick/${w}">KW ${isoWeek(w)}${feedbackFor(w) ? ' ✓' : ''}</a>`)
      .join('')}</div>
    ${hints.length ? `<section class="card tip">${hints.map((h) => `<p>💡 ${e(h)}</p>`).join('')}</section>` : ''}
    <section class="card"><h2>Wie war die Woche?</h2>
      ${scale('satiety', 'Sättigung (1 = hungrig, 5 = sehr satt)')}
      ${scale('energy', 'Energie (1 = schlapp, 5 = top)')}
      <label class="field">Gewicht (optional, kg)<input type="number" inputmode="decimal" step="0.1" data-fbw-input="weight" data-week="${ws}" value="${fb.week?.weight ?? ''}"></label>
      <label class="field">Notiz zur Woche<textarea data-fbw-input="note" data-week="${ws}" rows="2">${e(fb.week?.note || '')}</textarea></label>
    </section>
    <section class="card"><h2>Gerichte</h2><ul class="fb-list">
      ${ids
        .map((id) => {
          const r = recipe(id);
          return `<li><div class="fb-name">${e(r.name)}</div>
          <div class="fb-btns">${toggle(id, 'rating', 1, '👍')}${toggle(id, 'rating', -1, '👎')}${toggle(id, 'again', undefined, 'nochmal')}${toggle(id, 'tooComplex', undefined, 'zu aufwendig')}</div>
          <input class="fb-note" placeholder="Notiz (optional)" data-fb-note="${id}" data-week="${ws}" value="${e(fb.recipes[id]?.note || '')}"></li>`;
        })
        .join('')}
    </ul></section>`;
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

function viewSettings() {
  const st = S.settings;
  const pl = plausibility(st.goals);
  const num_ = (path, label, attrs = '') =>
    `<label class="field">${label}<input type="number" inputmode="numeric" data-set="${path}" value="${getPath(st, path)}" ${attrs}></label>`;
  const slider = (key, label) =>
    `<label class="field slider">${label} <b id="sl-${key}">${st.sliders[key]} %</b><input type="range" min="0" max="100" step="5" data-set="sliders.${key}" data-live="sl-${key}" value="${st.sliders[key]}"></label>`;
  const ps = pushSupport();
  const offers = allOffers();
  const ingOptions = [...S.idx.values()]
    .filter((i) => !i.staple)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    .map((i) => `<option value="${i.id}">${e(i.name)} (${e(i.packLabel || i.pack + ' g')})</option>`)
    .join('');
  return `<header class="top"><h1>Einstellungen</h1></header>

  <section class="card"><h2>Tagesziele</h2>
    <div class="grid2">
      ${num_('goals.kcal', 'Kalorien (kcal)', 'step="50"')}
      ${num_('goals.protein', 'Protein (g)', 'step="5"')}
      ${num_('goals.carbs', 'Kohlenhydrate (g)', 'step="5"')}
      ${num_('goals.fat', 'Fett (g)', 'step="5"')}
    </div>
    <p class="${pl.ok ? 'ok-text' : 'warn-text'}">${pl.ok ? `✓ Passt: Die Makros ergeben ${num(pl.fromMacros)} kcal (4/4/9 kcal pro g).` : '⚠️ ' + e(pl.message)}</p>
    ${!pl.ok && pl.suggestedCarbs > 0 ? `<button class="btn small" data-action="fix-carbs" data-val="${pl.suggestedCarbs}">Kohlenhydrate auf ${pl.suggestedCarbs} g setzen</button>` : ''}
  </section>

  <section class="card"><h2>Regler</h2>
    ${slider('simple', 'Einfache Zubereitung')}
    ${slider('dishes', 'Wenig Abwasch (mehr Meal-Prep)')}
    ${slider('offers', 'Angebote berücksichtigen')}
    ${slider('variety', 'Vielfalt')}
  </section>

  <section class="card"><h2>Einkauf</h2>
    <label class="row"><input type="checkbox" data-set="stores.lidl" ${st.stores.lidl ? 'checked' : ''}> Lidl</label>
    <label class="row"><input type="checkbox" data-set="stores.edeka" ${st.stores.edeka ? 'checked' : ''}> Edeka No1 Center Schloßstraße (Berlin)</label>
    <label class="field">Hauptladen<select data-set="mainStore"><option value="lidl" ${st.mainStore === 'lidl' ? 'selected' : ''}>Lidl</option><option value="edeka" ${st.mainStore === 'edeka' ? 'selected' : ''}>Edeka</option></select></label>
    <p class="sub">Gekauft wird im Hauptladen; nur wenn ein Angebot im anderen Laden mindestens 10 % günstiger ist, landet der Artikel dort.</p>
    ${num_('budget', 'Wochenbudget (€)', 'step="1"')}
  </section>

  <section class="card"><h2>Auswärts essen – Standardwoche</h2>
    <p class="sub">Vorschlag für jede neue Woche (${st.eatOut.length}×). Vor jeder Planung kannst du ihn für die konkrete Woche anpassen, danach auch einzelne Mahlzeiten in der Wochenansicht.</p>
    ${eatOutGrid(st.eatOut, 'toggle-eatout')}
    <div class="grid2">${num_('eatOutKcal', 'Pauschale kcal', 'step="50"')}${num_('eatOutProtein', 'Pauschale Protein (g)', 'step="5"')}</div>
  </section>

  <section class="card"><h2>Gerichte</h2>
    ${num_('complexPerWeek', 'Aufwendige Gerichte pro Woche', 'min="0" max="3"')}
    <label class="row"><input type="checkbox" data-set="proteinPowder" ${st.proteinPowder ? 'checked' : ''}> Proteinpulver als Ergänzung einplanen (Shake, Porridge, Skyr-Creme)</label>
    <div class="field">Abneigungen <span class="sub">(werden nicht eingeplant)</span>
      <div class="chips">${st.dislikes.map((d, i) => `<span class="chip">${e(d)} <button data-action="del-dislike" data-i="${i}" aria-label="entfernen">×</button></span>`).join('')}</div>
      <div class="add-row"><input id="dislike-new" placeholder="z. B. Pilze"><button class="btn small" data-action="add-dislike">Hinzufügen</button></div>
    </div>
  </section>

  <section class="card"><h2>Ballaststoffe – langsam steigern</h2>
    <div class="grid3">${num_('fiber.start', 'Start (g/Tag)')}${num_('fiber.step', '+ pro Woche (g)')}${num_('fiber.max', 'Ziel (g/Tag)')}</div>
    <label class="row"><input type="checkbox" data-set="psyllium" ${st.psyllium ? 'checked' : ''}> Flohsamenschalen ins Frühstück (4 g, mit extra Flüssigkeit)</label>
  </section>

  <section class="card"><h2>Darstellung</h2>
    <label class="field">Design<select data-set="theme"><option value="auto" ${!st.theme || st.theme === 'auto' ? 'selected' : ''}>Automatisch</option><option value="dark" ${st.theme === 'dark' ? 'selected' : ''}>Dunkel</option><option value="light" ${st.theme === 'light' ? 'selected' : ''}>Hell</option></select></label>
    ${num_('planHour', 'Neuer Plan montags ab (Uhr)', 'min="0" max="23"')}
  </section>

  <section class="card"><h2>Angebote</h2>
    <p class="sub">${S.offers?.updated ? `Automatisch geladen: ${new Date(S.offers.updated).toLocaleString('de-DE')} · ${(S.offers.offers || []).filter((o) => o.ingredientId).length} passende Angebote. ${Object.entries(S.offers.sources || {}).map(([k, v]) => `${e(STORES[k]?.name || k)}: ${v.ok ? '✓' : e(v.message || 'nicht verfügbar')}`).join(' · ')}` : 'Keine automatischen Angebote geladen – es gelten Richtpreise.'}</p>
    <h3>Angebot manuell eintragen</h3>
    <div class="offer-form">
      <select id="mo-store"><option value="lidl">Lidl</option><option value="edeka">Edeka</option></select>
      <select id="mo-ing">${ingOptions}</select>
      <input id="mo-price" type="number" inputmode="decimal" step="0.01" placeholder="Preis pro Packung €">
      <input id="mo-to" type="date" value="${addDays(currentWeek(), 6)}">
      <button class="btn small" data-action="add-offer">Speichern</button>
    </div>
    <ul class="list plain">${S.manualOffers
      .map(
        (o, i) => `<li><span>${e(STORES[o.store]?.name || o.store)}: ${e(ing(o.ingredientId)?.name)} ${euro(o.packPrice)} <small class="muted">(sonst ${euro(regularPrice(ing(o.ingredientId), o.store))}, bis ${formatDate(o.validTo)})</small></span><button class="icon-btn" data-action="del-offer" data-i="${i}">🗑</button></li>`
      )
      .join('')}</ul>
    <p class="sub">${offers.length} Angebote aktiv. Nach Änderungen: „Neu planen“ in der Wochenansicht.</p>
  </section>

  <section class="card"><h2>Benachrichtigung „Dein Wochenplan ist da“</h2>
    ${pushHtml(ps)}
  </section>

  <section class="card"><h2>Datensicherung</h2>
    <p class="sub">Alle Daten liegen nur auf diesem Gerät. Exportiere ab und zu eine Sicherung (z. B. in iCloud Drive).</p>
    <div class="actions"><button class="btn" data-action="export">⬇️ Exportieren</button>
    <label class="btn">⬆️ Importieren<input type="file" accept="application/json,.json" id="import-file" hidden></label></div>
    <button class="btn ghost small danger" data-action="reset-settings">Einstellungen zurücksetzen</button>
  </section>
  <p class="sub center">Michael Food · Nährwerte aus BLS/Open-Food-Facts-Richtwerten · Preise sind Richtwerte</p>`;
}

function pushHtml(ps) {
  if (!ps.supported) return `<p class="sub">Dieser Browser unterstützt keine Push-Nachrichten. Auf dem iPhone: App über „Teilen → Zum Home-Bildschirm“ installieren (ab iOS 16.4) und von dort öffnen.</p>`;
  if (!ps.standalone) return `<p class="sub">Push funktioniert auf dem iPhone nur in der installierten App: In Safari „Teilen → Zum Home-Bildschirm“, dann die App vom Home-Bildschirm öffnen und hier weitermachen.</p>`;
  const k = S.push.keys;
  return `<p class="sub">Optional. Die GitHub Action schickt dir montags um ${S.settings.planHour ?? 9}:00 eine Nachricht. Dafür einmalig drei Werte als GitHub-Secrets eintragen (Anleitung im README, Abschnitt „Push“).</p>
    <ol class="steps">
      <li>${k ? '✓ Schlüssel erzeugt' : '<button class="btn small" data-action="push-keys">1. Schlüssel erzeugen</button>'}</li>
      ${k ? `<li>${S.push.subscription ? '✓ Benachrichtigungen erlaubt' : '<button class="btn small" data-action="push-sub">2. Benachrichtigungen erlauben</button>'}</li>` : ''}
    </ol>
    ${
      k && S.push.subscription
        ? `<div class="secrets">
      ${secretRow('VAPID_PUBLIC_KEY', k.publicKey)}
      ${secretRow('VAPID_PRIVATE_KEY', k.privateKey)}
      ${secretRow('PUSH_SUBSCRIPTION', JSON.stringify(S.push.subscription))}
    </div><p class="hint">Den privaten Schlüssel nur als GitHub-Secret speichern, nirgends sonst teilen.</p>`
        : ''
    }
    <button class="btn ghost small" data-action="push-test">Test-Nachricht anzeigen</button>
    ${k ? '<button class="btn ghost small danger" data-action="push-reset">Push zurücksetzen</button>' : ''}`;
}

const secretRow = (name, value) =>
  `<div class="secret"><div><b>${name}</b><code>${e(value.slice(0, 24))}…</code></div><button class="btn small" data-action="copy" data-text="${e(value)}">Kopieren</button></div>`;

// ---------------------------------------------------------------------------
// Timer-Leiste
// ---------------------------------------------------------------------------

function renderTimerDock() {
  const dock = document.getElementById('timer-dock');
  if (!dock || !timers) return;
  dock.innerHTML = timers.timers
    .map(
      (t) => `<div class="timer ${t.done ? 'ringing' : ''} ${t.paused != null ? 'paused' : ''}" data-tid="${t.id}">
      <div class="tl"><b>${e(t.label)}</b><small>${e(t.context)}</small></div>
      <div class="tt" data-tt="${t.id}">${t.done ? 'Fertig!' : fmtTime(timers.remaining(t))}</div>
      ${t.done ? `<button class="btn small primary" data-action="t-del" data-id="${t.id}">OK</button>` : `<button class="icon-btn" data-action="t-toggle" data-id="${t.id}">${t.paused != null ? '▶' : '⏸'}</button><button class="icon-btn" data-action="t-add" data-id="${t.id}">+1</button><button class="icon-btn" data-action="t-del" data-id="${t.id}">✕</button>`}
    </div>`
    )
    .join('');
  document.body.classList.toggle('has-timers', timers.timers.length > 0);
}

function updateTimerDock() {
  if (!timers) return;
  for (const t of timers.timers) {
    const el = document.querySelector(`[data-tt="${t.id}"]`);
    if (!el) return renderTimerDock();
    const txt = t.done ? 'Fertig!' : fmtTime(timers.remaining(t));
    if (el.textContent !== txt) el.textContent = txt;
    const box = el.closest('.timer');
    if (t.done && !box.classList.contains('ringing')) return renderTimerDock();
  }
  if (document.querySelectorAll('[data-tt]').length !== timers.timers.length) renderTimerDock();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

async function onClick(ev) {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const plan = displayedPlan();
  switch (a) {
    case 'toggle-eval':
      S.ui.evalOpen = !S.ui.evalOpen;
      return render();
    case 'toggle-day': {
      const d = Number(el.dataset.day);
      const isOpen = !!el.parentElement.querySelector('.meals');
      S.ui.openDays[d] = !isOpen;
      return render();
    }
    case 'toggle-done':
      plan.done ||= {};
      plan.done[el.dataset.key] = !plan.done[el.dataset.key];
      savePlans();
      return render();
    case 'swap': {
      const next = swapMeal(plan, el.dataset.key, plannerInput({ weekStart: plan.weekStart }));
      next.done = plan.done || {};
      S.plans[plan.weekStart] = next;
      savePlans();
      toast('Gericht getauscht – Einkaufsliste aktualisiert');
      return render();
    }
    case 'replan':
      if (plan?.weekStart === currentWeek() && !confirm('Plan dieser Woche neu erstellen? Häkchen der Einkaufsliste werden zurückgesetzt.')) return;
      S.ui.draftPantry = null;
      S.ui.draftEatOut = null;
      if (plan?.weekStart === currentWeek()) {
        S.ui.draftEatOut = {
          week: currentWeek(),
          list: (plan.structure.eatOut || []).map((k) => ({ day: Number(k.split('-')[0]), slot: k.split('-')[1] })),
        };
        const last = store.get('lastPantry');
        S.ui.draftPantry = {
          week: currentWeek(),
          items: Object.entries(last?.week === currentWeek() ? last.pantry : {}).map(([id, g]) => ({ id, g, use: true })),
        };
        // Bisher eingegebene Reste übernehmen
        if (!S.ui.draftPantry.items.length) S.ui.draftPantry = null;
      }
      location.hash = '#/planen';
      return render();
    case 'pantry-add': {
      const id = document.getElementById('pantry-add-id').value;
      const g = Number(document.getElementById('pantry-add-g').value);
      if (!id || !(g > 0)) return toast('Zutat und Menge wählen');
      const ex = S.ui.draftPantry.items.find((x) => x.id === id);
      if (ex) {
        ex.g = g;
        ex.use = true;
      } else S.ui.draftPantry.items.push({ id, g, use: true });
      return render();
    }
    case 'make-plan': {
      const pantry = {};
      for (const it of S.ui.draftPantry?.items || []) if (it.use && it.g > 0) pantry[it.id] = it.g;
      el.disabled = true;
      el.textContent = 'Plane …';
      setTimeout(() => {
        createPlan(pantry, S.ui.draftEatOut?.list);
        S.ui.draftPantry = null;
        S.ui.draftEatOut = null;
        S.ui.openDays = {};
        location.hash = '#/woche';
        toast('Dein Wochenplan ist fertig!');
      }, 30);
      return;
    }
    case 'timer':
      timers.start(el.dataset.label, Number(el.dataset.sec), el.dataset.ctx);
      toast(`Timer „${el.dataset.label}“ läuft`);
      return;
    case 't-toggle':
      return timers.toggle(el.dataset.id);
    case 't-add':
      return timers.add(el.dataset.id, 60);
    case 't-del':
      return timers.remove(el.dataset.id);
    case 'cook-step':
      S.ui.cookStep = Math.max(0, S.ui.cookStep + Number(el.dataset.d));
      return render();
    case 'check': {
      const ws = plan.weekStart;
      S.checks[ws] ||= {};
      S.checks[ws][el.dataset.id] = !S.checks[ws][el.dataset.id];
      store.set('checks', S.checks);
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
      return render();
    }
    case 'fbw':
      updateFeedback(el.dataset.week, (fb) => {
        fb.week ||= {};
        fb.week[el.dataset.field] = Number(el.dataset.val);
      });
      return render();
    case 'toggle-eatout':
      toggleInList(S.settings.eatOut, Number(el.dataset.day), el.dataset.slot);
      saveSettings();
      return render();
    case 'draft-eatout':
      toggleInList(S.ui.draftEatOut.list, Number(el.dataset.day), el.dataset.slot);
      return render();
    case 'meal-eatout': {
      const on = el.dataset.on === '1';
      const next = setEatOut(plan, el.dataset.key, on, plannerInput({ weekStart: plan.weekStart }));
      S.plans[plan.weekStart] = next;
      savePlans();
      toast(on ? 'Als auswärts markiert – Plan & Einkauf angepasst' : 'Wieder zu Hause eingeplant – Plan & Einkauf angepasst');
      return render();
    }
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
    case 'add-offer': {
      const price = Number(String(document.getElementById('mo-price').value).replace(',', '.'));
      if (!(price > 0)) return toast('Bitte einen Preis eingeben');
      S.manualOffers.push({
        store: document.getElementById('mo-store').value,
        ingredientId: document.getElementById('mo-ing').value,
        packPrice: price,
        validFrom: currentWeek(),
        validTo: document.getElementById('mo-to').value || addDays(currentWeek(), 6),
        title: 'manuell',
      });
      store.set('manualOffers', S.manualOffers);
      toast('Angebot gespeichert');
      return render();
    }
    case 'del-offer':
      S.manualOffers.splice(Number(el.dataset.i), 1);
      store.set('manualOffers', S.manualOffers);
      return render();
    case 'export':
      return doExport();
    case 'reset-settings':
      if (confirm('Alle Einstellungen auf Standard zurücksetzen? Pläne und Feedback bleiben erhalten.')) {
        S.settings = structuredClone(DEFAULT_SETTINGS);
        saveSettings();
        applyTheme();
        render();
      }
      return;
    case 'copy':
      return copyText(el.dataset.text);
    case 'push-keys':
      try {
        S.push = { keys: await generateVapidKeys() };
        store.set('push', S.push);
      } catch (err) {
        toast('Fehler: ' + err.message);
      }
      return render();
    case 'push-sub':
      try {
        S.push.subscription = await subscribePush(S.push.keys.publicKey);
        store.set('push', S.push);
      } catch (err) {
        toast(err.message);
      }
      return render();
    case 'push-test':
      try {
        await testNotification();
      } catch (err) {
        toast(err.message);
      }
      return;
    case 'push-reset':
      if (confirm('Push-Schlüssel und Abo löschen? Danach die GitHub-Secrets neu eintragen.')) {
        S.push = {};
        store.set('push', S.push);
        render();
      }
      return;
  }
}

function onChange(ev) {
  const el = ev.target;
  if (el.dataset.set) {
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number' || el.type === 'range') v = Number(v);
    setPath(S.settings, el.dataset.set, v);
    if (!S.settings.stores.lidl && !S.settings.stores.edeka) S.settings.stores.lidl = true;
    if (el.dataset.set === 'stores.lidl' || el.dataset.set === 'stores.edeka') {
      if (!S.settings.stores[S.settings.mainStore]) S.settings.mainStore = S.settings.stores.lidl ? 'lidl' : 'edeka';
    }
    saveSettings();
    if (el.dataset.set === 'theme') applyTheme();
    if (el.type !== 'range') render();
    return;
  }
  if (el.dataset.pantryUse !== undefined) {
    S.ui.draftPantry.items[Number(el.dataset.pantryUse)].use = el.checked;
    el.closest('li').classList.toggle('off', !el.checked);
    return;
  }
  if (el.dataset.pantryG !== undefined) {
    S.ui.draftPantry.items[Number(el.dataset.pantryG)].g = Number(el.value);
    return;
  }
  if (el.dataset.fbwInput) {
    const v = el.dataset.fbwInput === 'weight' ? (el.value ? Number(String(el.value).replace(',', '.')) : null) : el.value;
    updateFeedback(el.dataset.week, (fb) => {
      fb.week ||= {};
      fb.week[el.dataset.fbwInput] = v;
    });
    return;
  }
  if (el.dataset.fbNote) {
    updateFeedback(el.dataset.week, (fb) => {
      (fb.recipes[el.dataset.fbNote] ||= {}).note = el.value;
    });
    return;
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

function onInput(ev) {
  const el = ev.target;
  if (el.dataset.live) {
    const lbl = document.getElementById(el.dataset.live);
    if (lbl) lbl.textContent = el.value + ' %';
  }
}

async function doExport() {
  const data = JSON.stringify(exportAll(), null, 1);
  const name = `michael-food-backup-${berlinNow().iso}.json`;
  const file = new File([data], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Michael Food Sicherung' });
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

// Kochmodus: beim Betreten bei Schritt 1 beginnen
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#/kochen')) S.ui.cookStep = 0;
});

init();
