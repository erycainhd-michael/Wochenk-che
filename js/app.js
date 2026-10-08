// Mise – App-Oberfläche (Vanilla JS, kein Build-Schritt). Design nach Figma-Vorlage.
import { DAY_NAMES, DAY_SHORT, SLOT_LABEL, addDays, clone, berlinNow, escapeHtml as e, euro, formatDate, isoWeek, mondayOf, num, shortName } from './util.js';
import { buildIndex, plausibility } from './nutrition.js';
import { cakesOf, generatePlan, refitPlan, swapMeal } from './planner.js';
import { mergeOffers, STORES, STORE_IDS } from './prices.js';
import { amountText, packText } from './shopping.js';
import { recipeWeights, weekHints } from './feedback.js';
import { ACTIVITY, DEFAULT_SETTINGS, GOALS, calcGoals, mergeSettings } from './settings.js';
import { exportAll, importAll, prunePlans, requestPersistence, store } from './storage.js';
import { TimerManager, fmtTime, keepAwake, unlockAudio } from './timers.js';
import { cleanRecipe, inventRecipe } from './ai.js';
import { setSoundsEnabled, sound } from './sounds.js';
import { LEVELS, SPORTS, sportById, sportKcal } from './sport.js';
import { NAV_ICONS } from './navicons.js';
import { autoSnapshot, getSnapshot, listSnapshots } from './backup.js';
import { haptic, hapticBurst } from './haptics.js';
import { stepTools } from './tools.js';
import { lookupBarcode, searchProducts, scanBarcode } from './foodlookup.js';

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
  // Eigene Rezept-Kategorien (z. B. „Familienrezepte“): Namen + Zuordnung Rezept-ID → Kategorien
  cats: store.get('recipeCats', { names: ['Familienrezepte'], map: {} }),
  // Eigene Zutaten aus dem Rezept-Editor (mit Nährwerten pro 100 g)
  customIng: store.get('customIngredients', []),
  // Grundlebensmittel (Gurke, Kohl, Putenbrust …) mit echten Nährwerten für eigene Zutaten
  foods: [],
  snapshots: [],
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

/** Blatt-Animation beim Kaltstart (Markup in index.html) – mindestens so lange, bis sie einmal durchgespielt ist */
function hideSplash() {
  const el = document.getElementById('splash');
  if (!el) return;
  sound.jingle(); // iOS spielt Töne erst nach der ersten Berührung – dann bleibt es still
  const out = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 450);
  };
  if (reducedMotion()) return out();
  // Die Stop-Motion zu Ende laufen lassen, dann das fertige Icon noch kurz zeigen (höchstens 3 s insgesamt)
  const t0 = performance.now();
  const wait = () => (el.classList.contains('done') || performance.now() - t0 > 3000 ? setTimeout(out, 550) : setTimeout(wait, 50));
  wait();
}

// Eckenradius der iPhone-Displays (Punkte), nach Bildschirmgröße im Hochformat
const SCREEN_RADIUS = { '375x812': 41, '414x896': 41.5, '390x844': 47.33, '428x926': 53.33, '393x852': 55, '430x932': 55, '402x874': 62, '440x956': 62, '420x912': 60 };

/** Sichtbare Höhe für Layouts, die genau den Bildschirm füllen (Rückblick) */
function setVh() {
  document.documentElement.style.setProperty('--vh', `${innerHeight}px`);
}

/**
 * Abstand der Tab-Leiste zum unteren Rand einmal messen und festhalten (neu nur beim Drehen),
 * dazu der Eckenradius des Displays für den Rahmen im Kochmodus.
 */
let pinnedKey = '';
function pinChrome() {
  const key = `${innerWidth}x${innerHeight > innerWidth}`;
  if (key === pinnedKey) return;
  pinnedKey = key;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:0;padding-bottom:var(--sab);visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const sab = probe.offsetHeight;
  probe.remove();
  const root = document.documentElement.style;
  root.setProperty('--tab-bottom', `${Math.max(8, Math.round(sab - 14))}px`);
  const dims = `${Math.min(screen.width, screen.height)}x${Math.max(screen.width, screen.height)}`;
  // Quer gehalten liegen die runden Ecken genauso – der Radius bleibt gleich
  root.setProperty('--screen-r', `${SCREEN_RADIUS[dims] ?? (sab > 0 ? 44 : 0)}px`);
}

async function init() {
  window.__miseStarted = true;
  applyTheme();
  pinChrome();
  setVh();
  addEventListener('resize', () => (pinChrome(), setVh()));
  // Töne sind immer an (Timer und „Fertig“ klingeln auch bei Lautlos)
  setSoundsEnabled(true);
  try {
    const [ing, rec] = await Promise.all([loadJSON('data/ingredients.json'), loadJSON('data/recipes.json')]);
    S.ingBase = ing.items;
    S.ingData = ing;
    rebuildIngredients();
    S.builtin = rec.recipes;
    rebuildRecipes();
  } catch (err) {
    document.getElementById('splash')?.remove();
    app.innerHTML = `<main class="view"><div class="card warn"><h2>Daten konnten nicht geladen werden</h2><p>${e(err.message)}</p><p>Bitte Internetverbindung prüfen und neu laden.</p></div></main>`;
    return;
  }
  try {
    S.foods = (await loadJSON('data/foods.json')).items;
  } catch {
    S.foods = [];
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
  // iOS gibt Audio nur bei Berührungen frei – bei jeder Berührung prüfen (z. B. nach dem Hintergrund)
  document.addEventListener('touchend', unlockAudio, { passive: true });
  document.addEventListener('click', unlockAudio);
  registerSW();
  requestPersistence();
  if (Object.keys(S.plans).length) store.set('welcomed', true);
  S.snapshots = await listSnapshots();
  // Planer-Verbesserungen (z. B. realistische Beilagen) einmalig auf die laufende Woche anwenden:
  // gleiche Gerichte, neu berechnete Mengen
  const cur = S.plans[currentWeek()];
  if (cur?.structure && (cur.pv || 0) < PLANNER_VERSION) {
    refitCurrent();
    S.plans[currentWeek()].pv = PLANNER_VERSION;
    savePlans();
  }
  render();
  hideSplash();
  // Automatische Sicherung: täglich eine Kopie auf dem Gerät, beim Verlassen der App aktualisiert
  autoSnapshot(exportAll, berlinNow().iso).then(async () => (S.snapshots = await listSnapshots()));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') autoSnapshot(exportAll, berlinNow().iso, true);
  });
  checkSchedule();
  setInterval(checkSchedule, 60_000);
  sendShares();
  addEventListener('online', () => sendShares());
}

/** Zutaten-Datenbank + eigene Zutaten (aus dem Rezept-Editor) */
function rebuildIngredients() {
  const cats = S.ingData.categories.filter((c) => c !== 'Eigene Zutaten');
  S.ingData = { ...S.ingData, items: [...S.ingBase, ...S.customIng], categories: S.customIng.length ? [...cats, 'Eigene Zutaten'] : cats };
  S.idx = buildIndex(S.ingData);
}
const fmtDateTime = (iso) => new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const saveCustomIng = () => {
  store.set('customIngredients', S.customIng);
  rebuildIngredients();
};
const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30);

/** Eingebaute Rezepte + eigene/KI-Rezepte (eigene Änderungen überschreiben das Original). */
function rebuildRecipes() {
  // Geteilte Rezepte, die inzwischen in der gemeinsamen Sammlung sind, nicht mehr doppelt lokal halten
  const builtinIds = new Set(S.builtin.map((r) => r.id));
  const before = S.custom.length;
  S.custom = S.custom.filter((r) => !(r.shared && builtinIds.has(r.id)));
  if (S.custom.length !== before) store.set('customRecipes', S.custom);
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
  shareRecipe(r);
  return r;
}

// --- Rezepte für alle Geräte teilen ---------------------------------------------
// Neue Rezepte werden als GitHub-Issue „Rezept: …“ eingereicht. Ein GitHub-Ablauf prüft sie und
// nimmt sie in data/recipes.json auf – danach erscheinen sie auf allen Geräten.
const REPO = 'erycainhd-michael/Wochenk-che';

function shareRecipe(r, announce = true) {
  const q = store.get('shareQueue', []).filter((x) => x.recipe.id !== r.id);
  // eigene Zutaten (mit Nährwerten) mitschicken, damit das Rezept überall berechnet werden kann
  const baseIds = new Set(S.ingBase.map((i) => i.id));
  const ingredients = r.ingredients
    .map((l) => S.customIng.find((i) => i.id === l.id))
    .filter((i) => i && !baseIds.has(i.id))
    .map(({ id, name, cat, kcal, p, c, f, fib, pack, price, shelf, piece, tags }) => ({ id, name, cat, kcal, p, c, f, fib, pack, price, shelf, piece, tags }));
  q.push({ recipe: r, ingredients, at: new Date().toISOString() });
  store.set('shareQueue', q);
  const own = S.custom.find((c) => c.id === r.id);
  if (own) {
    own.shared = true;
    store.set('customRecipes', S.custom);
  }
  sendShares(announce);
}

let sharing = false;
async function sendShares(announce = false) {
  const token = S.settings.shareToken;
  const q = store.get('shareQueue', []);
  if (!q.length || sharing) return;
  if (!token) {
    if (announce) toast('Rezept gespeichert – nur auf diesem Gerät', { icon: '📱', sub: 'Für alle Geräte: Freigabe-Schlüssel in den Einstellungen eintragen' });
    return;
  }
  if (navigator.onLine === false) return;
  sharing = true;
  try {
    while (q.length) {
      const item = q[0];
      const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Rezept: ${item.recipe.name}`.slice(0, 120),
          body: `Neues Rezept aus Mise (${S.settings.name || 'ohne Namen'}).\n\n\`\`\`json\n${JSON.stringify({ recipes: [item.recipe], ingredients: item.ingredients })}\n\`\`\`\n`,
        }),
      });
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        toast('Teilen hat nicht geklappt', { icon: '🔑', sub: 'Der Freigabe-Schlüssel ist ungültig oder abgelaufen', kind: 'warn' });
        break;
      }
      if (!res.ok) break;
      q.shift();
      store.set('shareQueue', q);
      if (announce) toast('Rezept wird für alle Geräte übernommen', { icon: '🌍', sub: 'In ein paar Minuten überall verfügbar' });
    }
  } catch {
    /* offline – später nochmal */
  } finally {
    sharing = false;
  }
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

// Nach Änderungen kurz warten, dann die heutige Sicherung auf dem Gerät aktualisieren
let snapTimer;
function scheduleSnapshot() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(async () => {
    if (await autoSnapshot(exportAll, berlinNow().iso, true)) S.snapshots = await listSnapshots();
  }, 3000);
}
const saveSettings = () => {
  store.set('settings', S.settings);
  scheduleSnapshot();
};
const savePlans = () => {
  store.set('plans', prunePlans(S.plans));
  scheduleSnapshot();
};
const saveNext = () => store.set('nextWeek', S.next);
// Erhöhen, wenn sich die Mengenberechnung des Planers ändert (laufende Woche wird dann neu berechnet)
const PLANNER_VERSION = 3;
const currentWeek = () => mondayOf();
const ing = (id) => S.idx.get(id);
const recipe = (id) => S.recipesById.get(id);
/** Kompakte Einheit ohne Leerzeichen, z. B. „181g“ */
const g_ = (x) => `${num(x)}g`;
/** Abwasch als dezenter Text statt Schwamm-Symbolen */
/** Abwasch = Töpfe, Pfannen, Schüsseln, Bleche … zusammen */
const dishesText = (n) => (!n ? 'kein Abwasch' : n === 1 ? '1 Teil Abwasch' : `${n} Teile Abwasch`);
/** Aufwendige Gerichte, Familienrezepte und Gourmet fühlen sich besonders an: orange statt grün */
const isFancy = (r) => !!r && (timeClass(r) === 'aufwendig' || catsOf(r.id).some((c) => c === 'Familienrezepte' || c === 'Gourmet'));
/** Kurzer Hinweis, warum ein Gericht besonders ist */
const fancyLabel = (r) => (isGourmet(r) ? 'Gourmet' : timeClass(r) === 'aufwendig' ? 'aufwendig' : 'Familienrezept');
/** Gourmet-Gerichte: Bordeauxrot mit Silber und Serifenschrift */
const isGourmet = (r) => !!r && catsOf(r.id).includes('Gourmet');
/** CSS-Klassen für besondere Gerichte: „fancy“ (orange) und zusätzlich „gourmet“ (bordeaux) */
const themeCls = (r) => (isGourmet(r) ? 'fancy gourmet' : isFancy(r) ? 'fancy' : '');
/** Mahlzeit am Wochenende-Mittag: „Kaffee & Kuchen“ (ältere Pläne: nur Sonntag) */
const isCake = (m) => !!(m?.cake || m?.sunday);
/** Personen, für die diese Mahlzeit gekocht wird (1 = nur du) */
const peopleOf = (m) => m?.people || 1;
/** Zutaten zum Kochen: beim Vorkochen die Gesamtmenge (schon inkl. Personen), sonst Portion × Personen */
function cookItems(plan, meal) {
  const cook = meal.cookId ? plan.cooks.find((c) => c.id === meal.cookId) : null;
  if (cook) return cook.items;
  const n = peopleOf(meal);
  return n === 1 ? meal.items : meal.items.map((it) => ({ ...it, g: it.g * n }));
}

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
    S.next = { v: 2, week: target, days: eatOutDays(S.settings.eatOut), items: [], start: 0 };
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

/** start = erster Tag mit Plan (0 = Montag). Davor ist man noch unterwegs: kein Plan, kein Einkauf. */
function createPlan({ pantry, eatOut, boost, start = 0 } = {}) {
  const ws = currentWeek();
  const away = Array.from({ length: start }, (_, i) => i);
  const plan = generatePlan(plannerInput({ pantry: pantry || {}, boost, away, settings: { ...S.settings, eatOut: eatOut || S.settings.eatOut } }));
  plan.done = {};
  plan.studi = !!S.settings.studi;
  plan.pv = PLANNER_VERSION;
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
  const plan = createPlan({ pantry, boost, eatOut: d ? daysToEatOut(d.days) : S.settings.eatOut, start: d?.start || 0 });
  S.next = null;
  saveNext();
  return plan;
}

/** Laufende Woche ab Tag `start` neu planen (Auswärtstage und Vorrat bleiben). false = abgebrochen */
async function replanWeek(plan, start) {
  if (Object.values(S.checks[plan.weekStart] || {}).some(Boolean) && !(await confirmBox('Woche neu planen?', 'Haken auf der Einkaufsliste werden zurückgesetzt.', 'Neu planen'))) return false;
  const eatOut = (plan.structure?.eatOut || []).map((k) => ({ day: Number(k.split('-')[0]), slot: k.split('-')[1] })).filter((x) => x.day >= start && !(plan.structure.away || []).includes(x.day));
  createPlan({ pantry: plan.pantryUsed || {}, eatOut, start });
  return true;
}

/** Laufenden Wochenplan an neue Ziele/Läden anpassen (gleiche Gerichte, neue Mengen) */
function refitCurrent() {
  const plan = S.plans[currentWeek()];
  if (!plan?.structure) return;
  S.plans[plan.weekStart] = refitPlan(plan, plannerInput({ weekStart: plan.weekStart }));
  savePlans();
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

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Meldung von oben: Symbol, Titel und optional eine zweite Zeile */
function toast(title, { icon = '✓', sub = '', kind = '' } = {}) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.innerHTML = `<span class="toast-icon">${e(icon)}</span><span class="toast-text"><b>${e(title)}</b>${sub ? `<small>${e(sub)}</small>` : ''}</span>`;
  document.body.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => {
    t.classList.remove('show');
    t.classList.add('hide');
    setTimeout(() => t.remove(), 400);
  }, 2800);
}

// --- Zahlen animiert verändern ------------------------------------------------

const COUNT_FMT = { int: (v) => num(v), g: (v) => g_(v), euro: (v) => euro(v) };
/** Antizipation: holt kurz in die Gegenrichtung aus, schießt leicht über und setzt sich */
const easeInOutBack = (x) => {
  const c2 = 1.70158 * 1.525;
  return x < 0.5 ? (Math.pow(2 * x, 2) * ((c2 + 1) * 2 * x - c2)) / 2 : (Math.pow(2 * x - 2, 2) * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2;
};
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

function applyCounts() {
  // Wochenwerte merken, damit sie auch nach einem Neustart animiert zum neuen Wert laufen
  S.ui.counts ||= store.get('counts', {});
  for (const el of document.querySelectorAll('[data-count]')) {
    const key = el.dataset.count;
    const to = Number(el.dataset.to);
    const fmt = COUNT_FMT[el.dataset.fmt] || COUNT_FMT.int;
    const from = S.ui.counts[key];
    S.ui.counts[key] = to;
    if (from == null || Math.abs(from - to) < 0.005 || reducedMotion()) continue;
    const back = el.dataset.ease === 'back';
    const ease = back ? easeInOutBack : easeOutCubic;
    const dur = back ? 1100 : 500;
    const t0 = performance.now();
    el.classList.add('counting');
    const step = (now) => {
      if (!el.isConnected) return;
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = fmt(from + (to - from) * ease(p));
      if (p < 1) requestAnimationFrame(step);
      else el.classList.remove('counting');
    };
    el.textContent = fmt(from);
    requestAnimationFrame(step);
  }
  store.set('counts', Object.fromEntries(Object.entries(S.ui.counts).filter(([k]) => k.startsWith('w-'))));
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
  toast('Dein neuer Wochenplan ist da', { icon: '🍽️', sub: 'Guten Appetit diese Woche!' });
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
  // Einladungslink (#/einladung/SCHLÜSSEL): Freigabe-Schlüssel übernehmen, dann normal weiter
  if (location.hash.startsWith('#/einladung/')) {
    const token = decodeURIComponent(location.hash.slice('#/einladung/'.length)).trim();
    if (token.length > 20) {
      S.settings.shareToken = token;
      saveSettings();
      toast('Rezepte werden jetzt mit allen Geräten geteilt', { icon: '🌍' });
      sendShares();
    }
    history.replaceState(null, '', '#/woche');
  }
  const r = route();
  if (lastRoute.startsWith('kochen/') && r.name !== 'kochen') keepAwake(false);
  const key = r.name + '/' + r.args.join('/');
  const changed = key !== lastRoute;
  // Wochenwechsel im Rückblick: Seite bleibt, wo sie ist (kein Sprung nach oben, kein Einblenden)
  const sameView = r.name === 'rueckblick' && lastRoute.startsWith('rueckblick/');
  const shownRecipe = routeRecipe(r);
  // Aufwendige Gerichte: magischer Swoosh statt Kochlöffel
  if (changed && r.name === 'kochen' && !lastRoute.startsWith('kochen/') && S.ui.cookActive !== r.args[0]) (isFancy(shownRecipe) ? sound.magicStart : sound.cookStart)();
  lastRoute = key;
  const views = {
    woche: viewWeek,
    einkauf: viewShopping,
    rueckblick: viewReview,
    planen: viewReview,
    einstellungen: viewSettings,
    start: viewStart,
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
  // Willkommensbildschirm beim allerersten Start: noch ohne Menü
  document.body.classList.toggle('no-nav', fn === viewWeek && !displayedPlan() && !store.get('welcomed'));
  if (changed && !sameView) {
    view.classList.remove('enter');
    void view.offsetWidth; // Animation neu starten
    view.classList.add('enter');
  }
  // Aufwendiges Gericht: Grün wird zu Orange, im Kochmodus läuft ein farbiger Rahmen um den Bildschirm
  const fancy = isFancy(shownRecipe) && ['rezept', 'mahlzeit', 'kochen'].includes(r.name);
  document.body.classList.toggle('fancy', fancy);
  document.body.classList.toggle('cook-on', r.name === 'kochen');
  document.body.classList.toggle('gourmet', fancy && isGourmet(shownRecipe));
  let frame = document.getElementById('magic-frame');
  if (fancy && r.name === 'kochen') {
    if (!frame) {
      frame = document.createElement('div');
      frame.id = 'magic-frame';
      frame.setAttribute('aria-hidden', 'true');
      frame.innerHTML = '<i></i><i class="glow"></i>';
      document.body.appendChild(frame);
    }
  } else frame?.remove();
  // Kochmodus läuft: oben rechts immer ein Weg zurück (auf Rezeptseiten steht „Weiter kochen“ schon oben)
  let resume = document.getElementById('cook-resume');
  const showResume = S.ui.cookActive && !['kochen', 'rezept', 'mahlzeit'].includes(r.name);
  document.body.classList.toggle('cooking', !!showResume);
  if (showResume) {
    if (!resume) {
      resume = document.createElement('div');
      resume.id = 'cook-resume';
      document.body.appendChild(resume);
    }
    const cr = cookRecipe(S.ui.cookActive);
    resume.classList.toggle('magic', isFancy(cr));
    resume.classList.toggle('gourmet', isGourmet(cr));
    resume.innerHTML = `<a href="#/kochen/${encodeURIComponent(S.ui.cookActive)}">👨‍🍳 Weiter kochen</a><button data-action="cook-end" aria-label="Kochmodus beenden">✕</button>`;
  } else resume?.remove();
  applyFx();
  applyCounts();
  if (changed) view.querySelector('.charts')?.classList.add('play');
  renderTimerDock();
  setupKwStrip();
  if (changed && !sameView) window.scrollTo(0, 0);
}

/** Rezept zu einem Kochmodus-Schlüssel („r:id“ oder Mahlzeit wie „2-abend“) */
function cookRecipe(key) {
  if (!key) return null;
  if (key.startsWith('r:')) return recipe(key.slice(2));
  const m = findMeal(displayedPlan(), key);
  return m?.recipeId ? recipe(m.recipeId) : null;
}

/** Rezept, das die aktuelle Seite zeigt (Rezept, Mahlzeit oder Kochmodus) */
function routeRecipe(r) {
  const [a] = r.args;
  if (!a) return null;
  if (r.name === 'rezept') return recipe(a);
  if (r.name === 'kochen' && a.startsWith('r:')) return recipe(a.slice(2));
  if (r.name === 'kochen' || r.name === 'mahlzeit') {
    const m = findMeal(displayedPlan(), a);
    return m?.recipeId ? recipe(m.recipeId) : null;
  }
  return null;
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

/** Großer Moment: Zielgewicht erreicht – Partytüte knallt, Bizeps spannt an */
function celebrate(kg) {
  sound.goal();
  haptic();
  const ov = document.createElement('div');
  ov.className = 'celebrate';
  ov.innerHTML = `<div class="cel-box">
      <div class="cel-stage"><span class="bicep">💪</span></div>
      <h2>Ziel erreicht!</h2>
      <p><b>${fmtKg(kg)} kg</b> – du hast es geschafft. Richtig stark!</p>
      <button class="btn primary block" data-close>Weiter so</button>
    </div>`;
  document.body.appendChild(ov);
  const close = () => {
    ov.classList.add('out');
    setTimeout(() => ov.remove(), 350);
  };
  ov.addEventListener('click', close);
  setTimeout(() => hapticBurst(3), 700);
  setTimeout(close, 6000);
}


const tabBtn = (id, label) =>
  `<a href="#/${id}" class="tab" data-tab="${id}" aria-label="${label}">${NAV_ICONS[id]}</a>`;

/** In den letzten 14 Tagen neu hinzugekommenes Rezept (z. B. von der wöchentlichen Rezept-Routine) */
const isFresh = (r) => r.addedAt && Date.now() - new Date(r.addedAt).getTime() < 14 * 864e5;

function bar(value, target, label, unit = '') {
  const pct = Math.min(100, (value / target) * 100);
  const ok = Math.abs(value - target) / target <= 0.05 || (label === 'Protein' && value >= target * 0.97);
  const fmt = (x) => (unit ? g_(x) : num(x));
  return `<div class="bar"><div class="bar-label"><span>${label}</span><span>${fmt(value)} / ${fmt(target)}</span></div>
    <div class="bar-track"><div class="bar-fill ${ok ? 'ok' : value < target ? 'low' : 'high'}" style="width:${pct}%"></div></div></div>`;
}

/** Passendes Gericht-Emoji für Kacheln (aus Name/Tags abgeleitet, eigenes `emoji`-Feld hat Vorrang) */
const DISH_EMOJI = [
  [/porridge|oats|quark-bowl|müsli|haferflocken/i, '🥣'],
  [/pfannkuchen|pancake/i, '🥞'],
  [/omelett|rührei|shakshuka|spiegelei/i, '🍳'],
  [/pizza|flammkuchen/i, '🍕'],
  [/pasta|spaghetti|nudel|tagliatelle|lasagne|carbonara|puttanesca|bolognese|gnocchi/i, '🍝'],
  [/curry|tikka|masala|butter chicken/i, '🍛'],
  [/wrap|döner/i, '🌯'],
  [/garnele/i, '🦐'],
  [/lachs|fisch|thunfisch|bordelaise/i, '🐟'],
  [/bowl|salat/i, '🥗'],
  [/kürbis/i, '🎃'],
  [/toast|brot|stulle/i, '🥪'],
  [/gefüllte paprika/i, '🫑'],
  [/pfanne|geschnetzeltes/i, '🥘'],
  [/hähnchen|chicken|cordon/i, '🍗'],
  [/hack|rind|bällchen/i, '🥩'],
  [/wok|reis/i, '🍚'],
  [/kartoffel|püree|rösti|bratkartoffeln/i, '🥔'],
  [/spargel|gemüse|rote bete/i, '🥦'],
  [/shake/i, '🥤'],
];
const recipeEmoji = (r) => r?.emoji || DISH_EMOJI.find(([re]) => re.test(r?.name || ''))?.[1] || '🍽️';

/** Überschrift mit kleiner Symbol-Kachel */
const H2 = (icon, text) => `<h2 class="ih"><span class="hi">${icon}</span>${text}</h2>`;

/** Begrüßung mit wechselndem, passendem Spruch (bleibt pro Tageszeit gleich, damit nichts flackert) */
function greeting() {
  const b = berlinNow();
  const h = b.hour;
  const n = (S.settings.name || '').trim();
  const nm = n ? ', ' + e(n) : '';
  const plan = displayedPlan();
  const today = plan?.weekStart === currentWeek() ? plan.structure?.sport?.[b.weekday] : null;
  let pool;
  if (today?.length) pool = [`Stark trainiert heute${nm} 💪`, `Sport erledigt${nm} – jetzt gut essen 🍽️`];
  else if (h < 5) pool = [`Noch wach${nm}? 🌙`, `Gute Nacht${nm} 🌙`];
  else if (h < 11)
    pool =
      b.weekday === 0
        ? [`Neue Woche, neuer Plan${nm} 🌱`, `Guten Start in die Woche${nm} ☀️`]
        : [`Guten Morgen${nm} 👋`, `Moin${nm}! Das Frühstück wartet 🥣`, `Guten Start in den Tag${nm} ☀️`];
  else if (h < 14) pool = [`Mahlzeit${nm}! 🥗`, `Hallo${nm} – Zeit für eine Pause 🌿`];
  else if (h < 17) pool = [`Schönen Nachmittag${nm} ☕`, `Hallo${nm} 👋`];
  else if (b.weekday === 4) pool = [`Wochenende in Sicht${nm} 🎉`, `Guten Abend${nm} 👋`];
  else if (b.weekday >= 5) pool = [`Schönes Wochenende${nm} ☀️`, `Entspannten Abend${nm} 🌙`];
  else pool = [`Guten Abend${nm} 👋`, `Feierabend${nm}! Was kochen wir? 🍳`, `Schönen Abend${nm} 🌙`];
  const seed = Number(b.iso.replace(/-/g, '')) + Math.floor(h / 6);
  return pool[seed % pool.length];
}

// --- Woche -------------------------------------------------------------------

// --- Einführung (erster Start) ------------------------------------------------

const profDraft = () => (S.ui.prof ||= { sex: '', age: '', height: '', weight: '', activity: 'wenig', goal: 'halten', goalWeight: '', ...(S.settings.profile || {}) });

/** Einführung: 0 Willkommen · 1 Über dich · 2 Alltag & Ziel · 3 Tagesziele · 4 Einkauf. edit = später aus den Einstellungen */
function viewStart(stepArg) {
  const edit = !!store.get('welcomed');
  const step = edit ? Math.min(3, Math.max(1, Number(stepArg) || 1)) : S.ui.ob || 0;
  const p = profDraft();
  const st = S.settings;
  const dots = `<div class="ob-dots">${[0, 1, 2, 3, 4]
    .filter((i) => !edit || (i >= 1 && i <= 3))
    .map((i) => `<i class="${i === step ? 'on' : i < step ? 'done' : ''}"></i>`)
    .join('')}</div>`;
  const nav = (label, next) =>
    `<div class="grid2 ob-nav">${step > (edit ? 1 : 0) ? `<button class="btn" data-action="ob-step" data-step="${step - 1}">Zurück</button>` : edit ? `<a class="btn" href="#/einstellungen">Abbrechen</a>` : '<span></span>'}<button class="btn primary" data-action="ob-step" data-step="${next}">${label}</button></div>`;
  const pills = (field, opts) =>
    `<div class="seg">${opts.map(([v, l]) => `<button class="pill ${p[field] === v ? 'on' : ''}" data-action="ob-set" data-field="${field}" data-val="${v}">${l}</button>`).join('')}</div>`;
  const inp = (field, label, ph, mode = 'numeric') => `<label class="field">${label}<input type="text" inputmode="${mode}" data-ob="${field}" value="${e(String(p[field] ?? ''))}" placeholder="${ph}"></label>`;
  let body = '';
  if (step === 0) {
    const snap = S.snapshots[0];
    const restore = snap
      ? `<section class="card accent"><h2>Sicherung gefunden</h2><p class="sub">Auf diesem iPhone liegt eine automatische Sicherung vom ${fmtDateTime(snap.savedAt)}. Möchtest du deine Daten zurückholen?</p>
        <select id="snap-pick" hidden><option value="${snap.day}"></option></select><button class="btn primary block" data-action="snap-restore">Wiederherstellen</button></section>`
      : '';
    body = `${restore}<div class="welcome"><img class="welcome-icon" src="icons/icon-512.png" alt=""><h2>Willkommen bei Mise!</h2>
        <p class="mise-word"><b>Mise en Place</b>, franz.: „alles an seinem Platz“</p></div>
      <section class="card"><p>Der Trick der Profiküche: Erst wird geschnippelt, abgewogen und bereitgestellt – dann wird ganz entspannt gekocht. 🧄🍋🌿</p>
        <p>Mise macht das für deine ganze Woche: Plan, Einkauf und Portionen stehen bereit, passend zu deinen Zielen – ganz ohne Kalorienzählen. Du musst nur noch kochen.</p>
        <p class="sub">In vier kurzen Schritten ist alles an seinem Platz.</p>
        <label class="field">Wie heißt du?<input type="text" autocomplete="given-name" data-set="name" value="${e(st.name || '')}" placeholder="Dein Vorname"></label>
        <p class="hint">Alles bleibt nur auf diesem Gerät.</p>${nav("Los geht's", 1)}</section>`;
  } else if (step === 1) {
    body = `<section class="card accent"><h2>Über dich</h2><p class="sub">Damit Mise deinen Bedarf berechnen kann.</p>
      <div class="field">Geschlecht${pills('sex', [['m', 'Mann'], ['w', 'Frau']])}</div>
      <div class="grid3">${inp('age', 'Alter', 'Jahre')}${inp('height', 'Größe', 'cm')}${inp('weight', 'Gewicht', 'kg', 'decimal')}</div>
      ${nav('Weiter', 2)}</section>`;
  } else if (step === 2) {
    body = `<section class="card accent"><h2>Alltag & Ziel</h2>
      <div class="field">Wie aktiv ist dein Alltag (ohne Sport)?${pills('activity', ACTIVITY.map(([v, l]) => [v, l]))}<p class="hint">${e(ACTIVITY.find((x) => x[0] === p.activity)?.[2] || '')}. Sport trägst du später pro Tag ein – dann gibt es an dem Tag mehr.</p></div>
      <div class="field">Was ist dein Ziel? <span class="sub">(Aufbauen = Muskeln aufbauen)</span>${pills('goal', GOALS.map(([v, l]) => [v, l]))}</div>
      ${p.goal !== 'halten' ? inp('goalWeight', 'Zielgewicht (optional)', 'kg', 'decimal') : ''}
      ${nav('Berechnen', 3)}</section>`;
  } else if (step === 3) {
    const field = (path, label) => `<label class="field">${label}<input type="number" inputmode="numeric" data-set="${path}" value="${getPath(st, path)}"></label>`;
    body = `<section class="card accent"><h2>Deine Tagesziele</h2>
      <p class="sub">Berechnet aus deinen Angaben. Du kannst sie hier oder später in den Einstellungen anpassen.</p>
      <div class="grid2">${field('goals.kcal', 'Kalorien (kcal)')}${field('goals.carbs', 'Kohlenhydrate (g)')}${field('goals.protein', 'Protein (g)')}${field('goals.fat', 'Fett (g)')}</div>
      ${edit ? `<div class="grid2 ob-nav"><button class="btn" data-action="ob-step" data-step="2">Zurück</button><button class="btn primary" data-action="ob-done">Übernehmen</button></div>` : nav('Weiter', 4)}</section>`;
  } else {
    body = `<section class="card accent"><h2>Einkauf & Alltag</h2>
      <label class="field">Wochenbudget<span class="unit-input"><input type="number" inputmode="numeric" step="1" data-set="budget" value="${st.budget}"><i>€</i></span></label>
      <label class="field">Wo kaufst du meistens ein?<select data-set="mainStore">${STORE_IDS.map((id) => `<option value="${id}" ${st.mainStore === id ? 'selected' : ''}>${e(STORES[id].short)}</option>`).join('')}</select></label>
      <div class="field">An welchen Abenden isst du meistens auswärts?${dayPills(eatOutDays(st.eatOut), 'eatout-day')}</div>
      <button class="btn primary block" data-action="first-plan">🍽️ Wochenplan erstellen</button>
      <button class="link" data-action="ob-step" data-step="3">‹ Zurück</button></section>`;
  }
  return `<div class="ob">${dots}${body}</div>`;
}

function viewWelcome() {
  return viewStart();
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
  const lastExp = store.get('lastExport');
  if (Object.keys(S.plans).length && (!lastExp || Date.now() - new Date(lastExp) > 7 * 864e5) && Date.now() > (store.get('exportSnooze') || 0)) {
    banners.push(`<div class="banner backup"><span>💾 Zeit für die wöchentliche Sicherung in iCloud – ein Tipp, dann „In Dateien sichern“.</span><span class="banner-btns"><button class="btn small primary" data-action="export">Sichern</button><button class="btn small" data-action="backup-later">Später</button></span></div>`);
  }
  if (isCurrent && b.weekday >= 5 && !feedbackFor(ws)) {
    banners.push(`<div class="banner">Wie war die Woche? Dein Feedback verbessert die nächsten Pläne. <a class="btn small" href="#/rueckblick">Feedback geben</a></div>`);
  }
  const todayIdx = isCurrent ? b.weekday : -1;
  const g = plan.goals;
  // Durchschnitt nur über Tage mit Plan (nicht über Tage „unterwegs“)
  const active = plan.days.filter((d) => !d.away);
  const nD = Math.max(1, active.length);
  const avgK = active.reduce((a, d) => a + d.totals.kcal, 0) / nD;
  const avgP = active.reduce((a, d) => a + d.totals.p, 0) / nD;
  const avgC = active.reduce((a, d) => a + d.totals.c, 0) / nD;
  const avgF = active.reduce((a, d) => a + d.totals.f, 0) / nD;
  const sportWeek = active.reduce((a, d) => a + (d.sportKcal || 0), 0);
  const avgGoal = g.kcal + sportWeek / nD;
  const firstDay = active[0]?.day ?? 0;
  // Zahlen zählen beim Öffnen animiert zum neuen Wert, wenn sich Ziele geändert haben
  const cnt = (key, v, fmt) => `<i data-count="${key}" data-to="${v}" data-fmt="${fmt}" data-ease="back">${COUNT_FMT[fmt](v)}</i>`;
  return `
    <div class="eyebrow greet">${greeting()}</div>
    <header class="top">
      <div><h1>KW ${isoWeek(plan.weekStart)}</h1><div class="sub">${formatDate(plan.weekStart)} – ${formatDate(addDays(plan.weekStart, 6), { day: 'numeric', month: 'long' })}</div></div>
      <a class="btn pill" href="#/rezepte">📖 Rezepte</a>
    </header>
    ${banners.join('')}
    <section class="card hero">
      <div class="hero-top">
        <div><span class="hero-label">Ø pro Tag</span><b class="hero-big">${cnt('w-k', avgK, 'int')}<small> kcal</small></b><span class="hero-sub">Ziel ${cnt('w-gk', avgGoal, 'int')} kcal${sportWeek ? ' inkl. Sport' : ''}</span></div>
        <div class="hero-right"><span class="hero-label">Einkauf</span><b class="hero-mid">${cnt('w-cost', plan.cost, 'euro')}</b><span class="hero-sub">Budget ${euro(S.settings.budget)}</span></div>
      </div>
      <div class="macro-bars">
        ${[
          ['Kohlenhydrate', avgC, g.carbs, 'w-c', 'w-gc'],
          ['Protein', avgP, g.protein, 'w-p', 'w-gp'],
          ['Fett', avgF, g.fat, 'w-f', 'w-gf'],
        ]
          .map(([l, v, t, k, kt]) => `<div class="mb"><span class="mb-l">${l}</span><span class="mb-v">${cnt(k, v, 'g')}<small> / ${cnt(kt, t, 'g')}</small></span><span class="mb-track"><i style="width:${Math.min(100, (v / t) * 100).toFixed(0)}%"></i></span></div>`)
          .join('')}
      </div>
      <button class="link hero-link" data-action="toggle-eval">${S.ui.evalOpen ? '▾' : '▸'} Bewertung des Plans</button>
      ${S.ui.evalOpen ? `<div class="hero-eval">${evaluationHtml(plan)}</div>` : ''}
    </section>
    ${isCurrent ? laterStart(plan, todayIdx, firstDay) : ''}
    ${daysHtml(plan, firstDay, todayIdx)}`;
}

/** Wird an diesem Tag gekocht? (Frühstück, Snacks, Reste vom Vortag und Auswärtsessen zählen nicht) */
const cooksOn = (d) => !d.away && d.meals.some((m) => m.kind === 'recipe' && !m.leftover && m.slot !== 'fruehstueck' && m.slot !== 'snack');

/** Tage ohne Kochen sind eingeklappt und über einen Knopf einblendbar (heute bleibt immer sichtbar) */
function daysHtml(plan, firstDay, todayIdx) {
  const quiet = plan.days.filter((d) => !cooksOn(d) && d.day !== todayIdx);
  const show = S.ui.showQuiet || !quiet.length;
  const cards = plan.days
    .filter((d) => show || !quiet.includes(d))
    .map((d) => dayCard(plan, d, S.ui.openDays[d.day] ?? d.day === Math.max(firstDay, todayIdx), d.day === todayIdx))
    .join('');
  const btn = quiet.length
    ? `<button class="hidden-days" data-action="toggle-quiet">${show ? '▾ Tage ohne Kochen ausblenden' : `▸ <b>${quiet.length} ${quiet.length === 1 ? 'Tag' : 'Tage'} ohne Kochen</b> einblenden (${quiet.map((d) => d.short).join(', ')})`}</button>`
    : '';
  return btn + cards;
}

/** „Woche später starten“: Plan ab einem gewählten Tag neu erstellen (z. B. nach dem Urlaub) */
function laterStart(plan, todayIdx, firstDay) {
  if (!S.ui.laterOpen) {
    return `<button class="link later-link" data-action="later-open">📅 ${firstDay ? `Plan startet am ${DAY_NAMES[firstDay]} – ändern` : 'Erst später in die Woche starten?'}</button>`;
  }
  const sel = S.ui.laterDay ?? (firstDay || Math.max(0, todayIdx));
  return `<section class="card later">
    <h2>Ab wann bist du da?</h2>
    <p class="sub">Mise plant die Woche ab diesem Tag neu und du kaufst nur für die restlichen Tage ein. „Mo“ plant wieder die ganze Woche. Haken auf der Einkaufsliste werden zurückgesetzt.</p>
    <div class="pills days">${DAY_SHORT.map((d, i) => `<button class="pill circle ${sel === i ? 'on' : ''}" data-action="later-day" data-day="${i}">${d}</button>`).join('')}</div>
    <div class="grid2"><button class="btn" data-action="later-cancel">Abbrechen</button><button class="btn primary" data-action="later-go" data-day="${sel}">${sel ? `Ab ${DAY_SHORT[sel]} planen` : 'Ganze Woche'}</button></div>
  </section>`;
}

function evaluationHtml(plan) {
  return `<ol class="eval">${(plan.evaluation || []).map((x) => `<li class="${x.level}"><b>${e(x.title)}</b><br>${e(x.text)}</li>`).join('')}</ol>`;
}

/** Bezeichnung der Mahlzeit, Wochenend-Mittag heißt „Kaffee & Kuchen“ */
const slotLabel = (m) => (isCake(m) ? 'Kaffee & Kuchen' : m.slot === 'snack' ? 'Snack' : SLOT_LABEL[m.slot]);

function mealRow(plan, m) {
  if (m.kind === 'eatout') {
    return `<li class="meal eatout"><span class="mi">${ICON.eatout}</span><div class="mt"><div class="ml">${SLOT_LABEL[m.slot]} · auswärts</div>
      <div class="mn">Auswärtsessen</div><div class="mm">≈ ${num(m.macros.kcal)} kcal · ≈ ${g_(m.macros.p)} Protein</div></div></li>`;
  }
  const r = recipe(m.recipeId);
  const cook = m.cookId ? plan.cooks.find((c) => c.id === m.cookId) : null;
  const badges = [];
  if (m.leftover) badges.push('<span class="badge">Portion von gestern</span>');
  else if (cook && cook.portions.length > 1) badges.push('<span class="badge">+ Portion für morgen</span>');
  if (isFancy(r)) badges.push(`<span class="badge ${themeCls(r)}">✨ ${fancyLabel(r)}</span>`);
  if (peopleOf(m) > 1) badges.push(`<span class="badge">für ${peopleOf(m)} Personen</span>`);
  if (r.source === 'ki' || isFresh(r)) badges.push('<span class="badge new">neu</span>');
  for (const a of m.addons || []) badges.push(`<span class="badge">+ ${e(recipe(a)?.name || a)}</span>`);
  const isSnack = m.slot === 'snack';
  return `<li class="meal ${themeCls(r)}" data-key="${m.key}">
    <a class="mt" href="#/mahlzeit/${m.key}">
      <div class="ml">${isCake(m) ? '☕' : ICON[isSnack ? 'snack' : m.slot]} ${slotLabel(m)} · ${r.time} Min.</div>
      <div class="mn">${e(r.name)}</div>
      <div class="mm">${num(m.macros.kcal)} kcal · ${g_(m.macros.p)} Protein</div>
      ${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}
    </a>
    <div class="meal-btns">
      <button class="round-btn" data-action="swap" data-key="${m.key}" aria-label="Neues Rezept vorschlagen">🔄</button>
      <a class="round-btn" href="#/waehlen/${m.key}" aria-label="Rezept aus der Sammlung wählen">🔎</a>
    </div>
  </li>`;
}

function dayCard(plan, d, open, isToday) {
  const g = plan.goals;
  if (d.away) {
    return `<section class="card day away" data-day="${d.day}"><div class="day-head"><b>${d.name} ${formatDate(d.date)}${isToday ? ' · heute' : ''}</b><span class="sub">✈️ Noch unterwegs – kein Plan, kein Einkauf</span></div></section>`;
  }
  return `<section class="card day ${isToday ? 'accent' : ''}" data-day="${d.day}">
    <button class="day-head" data-action="toggle-day" data-day="${d.day}" data-open="${open ? 1 : 0}">
      <b>${d.name} ${formatDate(d.date)}${isToday ? ' · heute' : ''}</b>
      <span class="sub">${num(d.totals.kcal)} kcal · ${g_(d.totals.p)} Protein${d.sportKcal ? ` · <span class="sport-tag">${sportIcons(plan, d.day)} +${num(d.sportKcal)} kcal</span>` : ''}</span>
    </button>
    ${
      open
        ? `<ul class="meals">${d.meals.map((m) => mealRow(plan, m)).join('')}</ul>
      <div class="bars">
        ${bar(d.totals.kcal, d.goalKcal || g.kcal, d.sportKcal ? `Kalorien (inkl. Sport +${num(d.sportKcal)})` : 'Kalorien')}
        ${bar(d.totals.c, g.carbs, 'Kohlenhydrate', 'g')}
        ${bar(d.totals.p, g.protein, 'Protein', 'g')}
        ${bar(d.totals.f, g.fat, 'Fett', 'g')}
        <div class="mini">Ballaststoffe ${g_(d.totals.fib)} · Gemüse/Obst ${g_(d.totals.veg)} · Warenwert ≈ ${euro(d.cost)}</div>
      </div>
      ${sportBlock(plan, d)}`
        : ''
    }
  </section>`;
}

// --- Sport ---------------------------------------------------------------------

/**
 * Körpergewicht für die Sport-Berechnung (kcal wachsen anteilig mit dem Gewicht):
 * im Sport-Formular geändert > zuletzt im Rückblick eingetragen > Einstellung > 80 kg
 */
function currentKg() {
  const fb = S.feedback.filter((f) => f.week?.weight > 0).sort((a, b) => a.weekStart.localeCompare(b.weekStart)).pop();
  const set = S.settings.bodyWeight;
  // Das zuletzt geänderte gewinnt
  if (set && (!fb || (S.settings.bodyWeightAt || '') >= (fb.updatedAt || ''))) return set;
  return fb?.week.weight || set || 80;
}
const sportIcons = (plan, d) => (plan.structure?.sport?.[d] || []).map((x) => sportById(x.type).icon).join('');

function sportBlock(plan, d) {
  const list = plan.structure?.sport?.[d.day] || [];
  const f = S.ui.sport?.day === d.day && S.ui.sport.week === plan.weekStart ? S.ui.sport : null;
  const rows = list
    .map(
      (x, i) => `<li class="sport-row"><span class="sport-ic">${sportById(x.type).icon}</span>
      <div class="sport-t"><b>${e(sportById(x.type).name)}</b><span class="sub">${x.min} Min. · ${LEVELS[x.level]} · +${num(x.kcal)} kcal</span></div>
      <button class="round-btn" data-action="sport-del" data-day="${d.day}" data-i="${i}" aria-label="Eintrag löschen">✕</button></li>`
    )
    .join('');
  let form = '';
  if (f) {
    const sp = sportById(f.type);
    const kg = currentKg();
    form = `<div class="sport-form">
      <label class="field">Sportart<select data-sport="type">${SPORTS.map((s) => `<option value="${s.id}" ${s.id === f.type ? 'selected' : ''}>${s.icon} ${e(s.name)}</option>`).join('')}</select></label>
      <div class="field">Intensität<div class="seg">${LEVELS.map((l, i) => `<button class="pill ${f.level === i ? 'on' : ''}" data-action="sport-level" data-val="${i}">${l}</button>`).join('')}</div>
        <p class="hint">${e(sp.hint[f.level])} · ${String(sp.met[f.level]).replace('.', ',')} MET</p></div>
      <div class="grid2">
        <label class="field">Dauer (Min.)<input type="number" inputmode="numeric" min="5" step="5" data-sport="min" value="${f.min}"></label>
        <label class="field">Dein Gewicht (kg)<input type="text" inputmode="decimal" data-sport="kg" value="${fmtKg(kg)}"></label>
      </div>
      <p class="sport-kcal">≈ <b>+${num(sportKcal(f.type, f.level, f.min, kg))} kcal</b> zusätzlich verbrannt</p>
      <div class="grid2"><button class="btn" data-action="sport-cancel">Abbrechen</button><button class="btn primary" data-action="sport-add" data-day="${d.day}">Eintragen</button></div>
      <p class="hint">Mise erhöht das Kalorienziel dieses Tages um diesen Wert und passt die Portionen an. Richtwerte nach dem Compendium of Physical Activities.</p>
    </div>`;
  }
  return `<div class="sport">${rows ? `<ul class="sport-list">${rows}</ul>` : ''}${form || `<button class="btn small pill sport-btn" data-action="sport-open" data-day="${d.day}">🏃 Sport eintragen</button>`}</div>`;
}

/** Sport ändern → Tagesziel und Portionen neu berechnen */
function saveSport(plan, fn) {
  plan.structure.sport ||= {};
  fn(plan.structure.sport);
  S.plans[plan.weekStart] = refitPlan(plan, plannerInput({ weekStart: plan.weekStart }));
  savePlans();
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
  const n = peopleOf(meal);
  let info = '';
  if (cook && cook.portions.length > 1) {
    const parts = cook.portions.map((p) => `${DAY_SHORT[p.day]} ${SLOT_LABEL[p.slot]}${(p.people || 1) > 1 ? ` (${p.people} Personen)` : ''}`).join(' + ');
    // Portionen sind auf die Tagesziele abgestimmt – bei deutlich unterschiedlicher Größe Aufteilung nennen
    const shares = cook.portions.map((p) => Math.round((p.factor / cook.totalFactor) * 100));
    const split = Math.abs(shares[0] - shares[1]) >= 10 ? ` Teile etwa ${shares.join(' : ')} auf.` : '';
    info = `<div class="banner info">🍱 Du kochst 2 Portionen: <b>${parts}</b>.${split} ${meal.leftover ? 'Heute isst du die vorgekochte Portion – nur aufwärmen.' : 'Füll die zweite Portion direkt in die Lunchbox.'}</div>`;
  }
  for (const a of meal.addons || []) {
    const ar = recipe(a);
    info += `<div class="banner info">💪 Dazu: <b>${e(ar.name)}</b> – ergänzt heute dein Protein. ${ar.steps.map((x) => e(x.t)).join(' ')}</div>`;
  }
  // Für die Tagesziele angepasstes Verhältnis von Beilage und Proteinquelle erklären
  const mx = meal.mix;
  if (mx && (Math.abs(mx.s - 1) >= 0.1 || Math.abs(mx.q - 1) >= 0.1)) {
    const pct = (f) => `${f > 1 ? '+' : '−'}${Math.round(Math.abs(f - 1) * 100)} %`;
    const parts = [];
    if (Math.abs(mx.s - 1) >= 0.1) parts.push(`${mx.s > 1 ? 'mehr' : 'weniger'} ${meal.slot === 'fruehstueck' ? 'Haferflocken bzw. Brot' : 'Beilage wie Reis, Nudeln oder Kartoffeln'} (${pct(mx.s)})`);
    if (Math.abs(mx.q - 1) >= 0.1) parts.push(`${mx.q > 1 ? 'mehr' : 'weniger'} Proteinquelle (${pct(mx.q)})`);
    info += `<div class="banner info">⚖️ Für deine Tagesziele angepasst: ${parts.join(' und ')} als im Grundrezept. Die Mengen unten sind schon umgerechnet.</div>`;
  }
  return recipeHtml(r, cookItems(plan, meal), meal.macros, `${DAY_NAMES[meal.key.split('-')[0]]} · ${slotLabel(meal)} · ${cook && cook.portions.length > 1 ? `${cook.portions.length} Portionen` : '1 Portion'}${n > 1 ? ` · für ${n} Personen` : ''}`, `<a class="back" href="#/woche">‹ Woche</a>`, info, key, 'people', n);
}

// Zeit-Filter der Rezeptliste
const TIME_FILTERS = [
  ['all', 'Alle'],
  ['kurz', 'Kurz'],
  ['mittel', 'Mittel'],
  ['aufwendig', 'Aufwendig'],
];
const timeClass = (r) => (r.effort === 3 || r.time > 30 ? 'aufwendig' : r.time <= 15 ? 'kurz' : 'mittel');
// Automatische Kategorien: ergeben sich aus den Rezeptdaten (Zuordnung im Rezept trotzdem änderbar)
const MEAT = new Set(['Geflügel', 'Schwein', 'Rind']);
const hasMeat = (r) => r.ingredients.some((l) => MEAT.has(ing(l.id)?.protein));
const hasFishIng = (r) => r.ingredients.some((l) => ing(l.id)?.protein === 'Fisch' || ing(l.id)?.tags?.includes('fisch'));
const hasTag = (r, t) => (r.tags || []).includes(t);
const AUTO_CATS = {
  'Wenig Abwasch': (r) => r.dishes <= 2,
  'Mehr Abwasch': (r) => r.dishes >= 3,
  Protein: (r, m) => (m.p * 4) / m.kcal >= 0.28,
  Carbs: (r, m) => (m.c * 4) / m.kcal >= 0.43,
  Fette: (r, m) => (m.f * 9) / m.kcal >= 0.37,
  Mahlzeiten: (r) => r.type === 'main',
  Frühstück: (r) => r.type === 'breakfast',
  Vorspeisen: (r) => hasTag(r, 'vorspeise'),
  Suppen: (r) => /suppe|eintopf|chowder|ramen/i.test(r.name) || hasTag(r, 'suppe'),
  Salate: (r) => /salat|bowl/i.test(r.name) || hasTag(r, 'salat'),
  Saucen: (r) => hasTag(r, 'sauce'),
  Kuchen: (r) => r.type === 'snack' || (r.tags || []).includes('kuchen') || (/kuchen|cake|muffin|brownie|tarte/i.test(r.name) && !/flammkuchen|pfannkuchen/i.test(r.name)),
  Desserts: (r) => /tiramisu|crumble|mousse|pudding|panna cotta|\beis\b|parfait/i.test(r.name) || hasTag(r, 'dessert'),
  Brot: (r) => /brot|toast|stulle|sandwich/i.test(r.name),
  Gourmet: (r) => (r.tags || []).includes('gourmet'),
  Fleisch: (r) => hasMeat(r),
  Fisch: (r) => hasFishIng(r),
  Vegetarisch: (r) => !hasMeat(r) && !hasFishIng(r),
};
// Filter-Gruppen der Rezeptliste (durch Linien getrennt). Innerhalb einer Gruppe gilt eine Auswahl,
// Gruppen lassen sich kombinieren, z. B. „Kurz“ + „Wenig Abwasch“ + „Vegetarisch“.
const CAT_GROUPS = [
  ['Favoriten'],
  ['Wenig Abwasch', 'Mehr Abwasch'],
  ['Mahlzeiten', 'Frühstück', 'Vorspeisen', 'Suppen', 'Salate', 'Saucen', 'Kuchen', 'Desserts', 'Brot'],
  ['Fleisch', 'Fisch', 'Vegetarisch'],
  ['Protein', 'Carbs', 'Fette'],
];
/** Gruppen mit den vorhandenen Kategorien; alles Übrige (Gourmet, eigene) kommt in die letzte Gruppe */
function catGroups() {
  const known = new Set(CAT_GROUPS.flat());
  const groups = CAT_GROUPS.map((g) => g.filter((n) => S.cats.names.includes(n)));
  groups.push(S.cats.names.filter((n) => !known.has(n)));
  return groups;
}
// Umbenannte Kategorien übernehmen (Hauptgerichte → Mahlzeiten, Salat → Salate)
for (const [from, to] of [['Hauptgerichte', 'Mahlzeiten'], ['Salat', 'Salate']]) {
  const ren = (list) => (list || []).map((n) => (n === from ? to : n));
  S.cats.names = [...new Set(ren(S.cats.names))];
  S.cats.removed = ren(S.cats.removed);
  for (const k of Object.keys(S.cats.map || {})) S.cats.map[k] = ren(S.cats.map[k]);
  for (const k of Object.keys(S.cats.off || {})) S.cats.off[k] = ren(S.cats.off[k]);
}
// Kategorien sind fest vorgegeben (Änderungen nur im Code): „Favoriten“ + automatische + „Familienrezepte“
S.cats.names = ['Favoriten', ...Object.keys(AUTO_CATS), 'Familienrezepte'];
S.cats.removed = [];
const autoCatsCache = new Map();
function autoCats(r) {
  if (!r) return [];
  if (!autoCatsCache.has(r)) {
    const m = macrosOf(r.ingredients.filter((l) => !l.opt));
    autoCatsCache.set(r, Object.entries(AUTO_CATS).filter(([, f]) => m.kcal > 0 && f(r, m)).map(([n]) => n));
  }
  return autoCatsCache.get(r);
}
/** Kategorien eines Rezepts: eigene Zuordnung + automatische, abzüglich abgewählter */
const catsOf = (id) => {
  const off = S.cats.off?.[id] || [];
  return [...new Set([...(S.cats.map[id] || []), ...autoCats(recipe(id))])].filter((n) => S.cats.names.includes(n) && !off.includes(n));
};
const saveCats = () => store.set('recipeCats', S.cats);
const isFav = (id) => catsOf(id).includes('Favoriten');
/** Stern-Knopf und Kategorie-Chip „Favoriten“ im Rezept auf denselben Stand bringen */
function syncFav(id) {
  const on = isFav(id);
  document.querySelectorAll(`[data-action="fav-toggle"][data-id="${CSS.escape(id)}"]`).forEach((b) => {
    b.classList.toggle('on', on);
    b.setAttribute('aria-label', on ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen');
  });
  document.querySelectorAll(`[data-action="rcat-toggle"][data-id="${CSS.escape(id)}"][data-val="Favoriten"]`).forEach((c) => {
    c.classList.toggle('on', on);
    c.textContent = (on ? '✓ ' : '') + 'Favoriten';
  });
}

/** Alle Rezepte in einer Liste – Frühstück, Hauptgericht & Co. sind Kategorien zum Filtern */
function viewRecipes() {
  const fbw = recipeWeights(S.feedback);
  const tf = S.ui.rTime || 'all';
  const groups = catGroups();
  // je Gruppe höchstens eine Auswahl
  const sel = (S.ui.rSel ||= {});
  groups.forEach((g, i) => {
    if (sel[i] && !g.includes(sel[i])) delete sel[i];
  });
  const all = S.recipes.filter((r) => r.type !== 'addon');
  // skip = Gruppe, die für die Zählung ausgelassen wird (zeigt, wie viele Rezepte ein Chip ergeben würde)
  const match = (r, skip = null, time = tf) =>
    (skip === 'time' || time === 'all' || timeClass(r) === time) && groups.every((_, i) => i === skip || !sel[i] || catsOf(r.id).includes(sel[i]));
  const list = all.filter((r) => match(r)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const any = tf !== 'all' || Object.keys(sel).length;
  const hints = { kurz: 'bis 15 Min.', mittel: '15–30 Min.', aufwendig: 'über 30 Min. oder aufwendig' };
  const sep = '<span class="chip-sep" aria-hidden="true"></span>';
  const timeChips = TIME_FILTERS.filter(([v]) => v !== 'all')
    .map(([v, l]) => `<button class="chip ${tf === v ? 'on' : ''}" data-action="rfilter-time" data-val="${v}" title="${hints[v]}">${l} <small>${all.filter((r) => match(r, 'time') && timeClass(r) === v).length}</small></button>`)
    .join('');
  const chipsOf = (g, i) =>
    g
      .map((n) => `<button class="chip ${sel[i] === n ? 'on' : ''}" data-action="rfilter-cat" data-group="${i}" data-val="${e(n)}">${n === 'Favoriten' ? '⭐ ' : ''}${e(n)} <small>${all.filter((r) => match(r, i) && catsOf(r.id).includes(n)).length}</small></button>`)
      .join('');
  // Gruppe 0 = „Favoriten“: steht in der ersten Zeile direkt neben „Alle“
  const groupChips = groups
    .map((g, i) => (i > 0 && g.length ? sep + chipsOf(g, i) : ''))
    .join('');
  return `<header class="top col"><a class="back" href="#/woche">‹ Woche</a><h1><span class="h-count">${list.length}</span> ${list.length === 1 ? 'Rezept' : 'Rezepte'}</h1></header>
    <section class="card accent filters">
      <div class="chips cats">
        <button class="chip ${!any ? 'on' : ''}" data-action="rfilter-all">Alle <small>${all.length}</small></button>${chipsOf(groups[0], 0)}
        ${sep}${timeChips}${groupChips}
      </div>
      ${tf !== 'all' ? `<p class="hint">${TIME_FILTERS.find(([v]) => v === tf)[1]}: ${hints[tf]}</p>` : ''}
    </section>
    <section class="card new-recipe">${H2('✏️', 'Neues Rezept')}
      <div class="add-row"><input placeholder="z. B. Pilzrisotto" data-new-title="main" value="${e(S.ui.newTitle.main || '')}"><button class="btn pill" data-action="new-recipe" data-type="main">Erstellen</button></div>
    </section>
    <section class="card">
      ${list.length ? '' : `<p class="sub">${Object.keys(sel).length ? 'Keine Rezepte für diese Auswahl – tippe eine Kategorie nochmal an, um sie aufzuheben.' : 'Keine Rezepte für diesen Filter.'}</p>`}
      <ul class="list">${list
        .map((r) => {
          const w = fbw[r.id]?.weight;
          const tag = r.source === 'ki' ? ' · ✨ KI' : isFresh(r) ? ' · ✨ neu' : r.source === 'eigen' ? ' · eigenes' : '';
          const m = macrosOf(r.ingredients.filter((l) => !l.opt || S.settings[l.opt]));
          const tags = catsOf(r.id).filter((c) => !/Abwasch/.test(c));
          return `<li class="${themeCls(r)}"><a href="#/rezept/${r.id}"><span class="rl-n">${isFancy(r) ? '✨ ' : ''}${e(r.name)}${w > 1.15 ? ' 👍' : w < 0.85 ? ' 👎' : ''}</span>
            <span class="rmeta">${r.time} Min. · ${dishesText(r.dishes)} · <b>${num(m.kcal)} kcal</b> · ${g_(m.c)} Kohlenhydrate · ${g_(m.p)} Protein · ${g_(m.f)} Fett${r.season ? ' · saisonal' : ''}${tag}</span>
            ${tags.length ? `<span class="rcats">${tags.map((c) => `<i>${e(c)}</i>`).join('')}</span>` : ''}</a></li>`;
        })
        .join('')}</ul>
    </section>`;
}

/** Bestätigen ohne System-Dialog (die werden in iPhone-Web-Apps teils nicht angezeigt) */
function confirmBox(title, text, okLabel = 'Löschen') {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'confirm-box';
    ov.innerHTML = `<div class="cb-card"><h2>${e(title)}</h2><p class="sub">${e(text)}</p><div class="grid2"><button class="btn" data-cb="0">Abbrechen</button><button class="btn primary danger-fill" data-cb="1">${e(okLabel)}</button></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-cb]');
      if (!b && ev.target !== ov) return;
      ev.stopPropagation();
      ov.remove();
      resolve(b?.dataset.cb === '1');
    });
  });
}

/** 🔎 Rezept aus der Sammlung für eine Mahlzeit auswählen */
function viewChoose(key) {
  const plan = displayedPlan();
  const meal = findMeal(plan, key);
  if (!meal) return `<div class="card">Mahlzeit nicht gefunden. <a href="#/woche">Zur Woche</a></div>`;
  const type = isCake(meal) ? 'snack' : meal.slot === 'snack' ? 'addon' : meal.slot === 'fruehstueck' ? 'breakfast' : 'main';
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
                (r) => `<li><button class="list-btn" data-action="choose" data-key="${key}" data-id="${r.id}"><span>${e(r.name)}</span><small>${r.time} Min. · ${dishesText(r.dishes)}${r.source === 'ki' ? ' · ✨ KI' : ''}</small></button></li>`
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
  const tools = stepTools(r);
  const isBuiltin = S.builtin.some((b) => b.id === r.id);
  const isCustom = S.custom.some((c) => c.id === r.id);
  const exists = !!recipe(r.id);
  return `<header class="top"><a class="back" href="${exists ? `#/rezept/${r.id}` : '#/rezepte'}" data-action="edit-cancel">‹ Abbrechen</a><button class="btn primary pill" data-action="edit-save">Speichern</button></header>
    <section class="card accent">
      <label class="field">Titel<input data-edit="name" value="${e(r.name)}"></label>
      <div class="grid2">
        <label class="field">Mahlzeit<select data-edit="type"><option value="main" ${r.type === 'main' ? 'selected' : ''}>Mittag/Abend</option><option value="breakfast" ${r.type === 'breakfast' ? 'selected' : ''}>Frühstück</option><option value="snack" ${r.type === 'snack' ? 'selected' : ''}>Kaffee & Kuchen</option></select></label>
        <label class="field">Zeit (Min.)<input type="number" inputmode="numeric" data-edit="time" value="${r.time}"></label>
        <label class="field">Abwasch (Teile)<input type="number" inputmode="numeric" data-edit="dishes" value="${tools.flat().length || r.dishes}"></label>
        <label class="field">Aufwand<select data-edit="effort">${[1, 2, 3].map((v) => `<option value="${v}" ${r.effort === v ? 'selected' : ''}>${['', 'einfach', 'normal', 'aufwendig'][v]}</option>`).join('')}</select></label>
      </div>
      <label class="row"><input type="checkbox" data-edit="mealPrep" ${r.mealPrep ? 'checked' : ''}> Schmeckt auch am nächsten Tag (Lunchbox)</label>
    </section>
    <section class="card"><h2>Zutaten <span class="sub">für 1 Portion</span></h2>
      <datalist id="ing-names">${ingNames()
        .map((n) => `<option value="${e(n)}"></option>`)
        .join('')}</datalist>
      <ul class="edit-list">${r.ingredients.map((l, n) => editIngRow(l, n)).join('')}</ul>
      <div class="edit-add"><button class="btn pill small" data-action="edit-add-ing">+ Zutat</button><button class="btn pill small" data-action="ing-scan-new">📷 Barcode scannen</button></div>
      <p class="hint">Name eintippen: Mise kennt Grundlebensmittel (z. B. Gurke, Kohl, Putenbrust) mit echten Nährwerten. Alles andere findest du online oder per Barcode.</p>
    </section>
    <section class="card"><h2>Anleitung</h2>
      <ol class="edit-steps">${r.steps
        .map(
          (st, n) => `<li><textarea rows="3" data-edit-step="${n}" data-f="t">${e(st.t)}</textarea>
          <label class="tools-field">🍳 <input data-edit-step="${n}" data-f="tools" value="${e((tools[n] || []).join(', '))}" placeholder="Geschirr, z. B. Pfanne, Schüssel"></label>
          <div class="step-meta"><span class="qty">⏱️ <input type="number" inputmode="decimal" step="0.5" min="0" data-edit-step="${n}" data-f="timer" value="${st.timer ? st.timer / 60 : ''}" placeholder="–"> Min.</span>
          <input data-edit-step="${n}" data-f="label" value="${e(st.label || '')}" placeholder="Timer-Name">
          <button class="round-btn" data-action="edit-del-step" data-n="${n}" aria-label="entfernen">✕</button></div></li>`
        )
        .join('')}</ol>
      <button class="btn pill small" data-action="edit-add-step">+ Schritt</button>
      ${S.settings.aiKey ? `<button class="btn pill small" data-action="edit-ai">✨ Mit KI ausfüllen</button>` : ''}
      <p class="hint">Geschirr: was in dem Schritt neu dazukommt. Daraus zählt Mise den Abwasch.</p>
    </section>
    <button class="btn primary block" data-action="edit-save">Speichern</button>
    ${isCustom ? `<button class="link danger" data-action="edit-delete">${isBuiltin ? 'Original wiederherstellen' : 'Rezept löschen'}</button>` : ''}`;
}

/** Namen für die Zutaten-Vorschläge: bekannte Zutaten + Grundlebensmittel (ohne Doppelte) */
function ingNames() {
  const have = new Set([...S.idx.values()].map((i) => i.name.toLowerCase()));
  return [...[...S.idx.values()].map((i) => i.name), ...S.foods.filter((f) => !have.has(f.name.toLowerCase())).map((f) => f.name)].sort((a, b) => a.localeCompare(b, 'de'));
}

const fmtNum = (v) => String(Math.round(v * 10) / 10).replace('.', ',');

/** Eine Zeile im Rezept-Editor; eigene Zutaten zeigen ihre Nährwerte und Wege, sie zu finden */
function editIngRow(l, n) {
  const i = ing(l.id);
  const own = i?.custom;
  const look = S.ui.lookup?.n === n ? S.ui.lookup : null;
  let extra = '';
  if (own) {
    const vals = `${fmtNum(i.kcal)} kcal · ${fmtNum(i.c)}g KH · ${fmtNum(i.p)}g Protein · ${fmtNum(i.f)}g Fett`;
    const source = i.needsData ? '' : `<span class="own-src">${e(i.source || 'eigene Werte')}${i.brand ? ' · ' + e(i.brand) : ''}</span>`;
    const results = look?.results
      ? look.results.length
        ? `<ul class="off-results">${look.results
            .map((x, k) => `<li><button class="list-btn" data-action="ing-pick" data-n="${n}" data-k="${k}"><span>${e(x.name)}${x.brand ? ` <small class="muted">${e(x.brand)}</small>` : ''}</span><small>${fmtNum(x.kcal)} kcal · ${fmtNum(x.p)}g Protein · ${x.pack}g</small></button></li>`)
            .join('')}</ul>`
        : '<p class="sub">Nichts gefunden – probier einen anderen Begriff oder scanne den Barcode.</p>'
      : '';
    extra = `<div class="own-ing ${i.needsData ? 'needs' : ''}">
      ${i.needsData ? `<b>Nährwerte für „${e(i.name)}“ finden</b>` : `<span class="sub">Pro 100g: ${vals}</span>${source}`}
      <div class="own-actions">
        <input type="search" data-lookup-q="${n}" value="${e(look?.q ?? i.name)}" placeholder="Produkt suchen" aria-label="Produkt suchen">
        <button class="btn small pill" data-action="ing-search" data-n="${n}">${look?.loading ? '…' : '🔎 Suchen'}</button>
        <button class="btn small pill" data-action="ing-scan" data-n="${n}">📷 Scannen</button>
      </div>
      ${look?.error ? `<p class="warn-text">${e(look.error)}</p>` : ''}
      ${results}
      <details ${S.ui.ownOpen === i.id ? 'open' : ''}><summary>Werte selbst ändern</summary>
        <div class="own-grid">${[
          ['kcal', 'kcal'],
          ['c', 'Kohlenhydrate'],
          ['p', 'Protein'],
          ['f', 'Fett'],
          ['pack', 'Packung (g)'],
          ['price', i.priceEst ? 'Preis (€, geschätzt)' : 'Preis (€)'],
        ]
          .map(([f, label]) => `<label>${label}<input type="text" inputmode="decimal" data-cing="${i.id}" data-f="${f}" value="${String(i[f]).replace('.', ',')}"></label>`)
          .join('')}</div></details></div>`;
  }
  return `<li class="${own ? 'own' : ''}"><input list="ing-names" data-edit-ing="${n}" data-f="name" value="${e(i?.name || '')}" placeholder="Zutat suchen oder neu eingeben">
    <span class="qty"><input type="number" inputmode="numeric" data-edit-ing="${n}" data-f="g" value="${l.g}"> g</span>
    <button class="round-btn" data-action="edit-del-ing" data-n="${n}" aria-label="entfernen">✕</button>${extra}</li>`;
}

/** Zutat zu einem eingetippten Namen: bekannt, Grundlebensmittel oder neu (dann Nährwerte online suchen) */
function resolveIngredient(name) {
  const low = name.toLowerCase();
  const all = [...S.idx.values()];
  // Teilwort: „Gurke“ → „Salatgurke“, „Eier“ → „Eier (Freiland, M)“ (erst ab 4 Buchstaben)
  const base = (n) => n.toLowerCase().replace(/\(.*?\)/g, '').split(/[,/]/)[0].trim();
  const part = (n) => low.length >= 4 && (base(n).startsWith(low) || base(n).endsWith(low));
  const known =
    all.find((i) => i.name.toLowerCase() === low) || all.find((i) => !i.custom && (i.kw || []).includes(low)) || all.find((i) => !i.custom && part(i.name));
  if (known) return { id: known.id };
  const food = S.foods.find((f) => f.name.toLowerCase() === low) || S.foods.find((f) => (f.kw || []).includes(low)) || S.foods.find((f) => part(f.name));
  if (food) {
    if (!S.customIng.some((x) => x.id === food.id)) {
      S.customIng.push({ ...food, custom: true, source: 'Mise-Grunddaten (BLS)' });
      saveCustomIng();
    }
    return { id: food.id };
  }
  const id = 'x_' + slugify(name);
  if (!S.customIng.some((i) => i.id === id)) {
    // vorläufige Werte, bis ein Produkt gewählt ist
    S.customIng.push({ id, name, cat: 'Eigene Zutaten', kcal: 100, p: 5, c: 15, f: 3, fib: 1, pack: 250, price: 2, priceEst: true, shelf: 7, custom: true, needsData: true });
    saveCustomIng();
  }
  return { id, search: true };
}

/** Gefundenes Produkt als Werte für eine eigene Zutat übernehmen */
function applyProduct(id, prod) {
  const i = S.customIng.find((x) => x.id === id);
  if (!i || !prod) return;
  const keepName = i.needsData ? i.name : prod.name;
  Object.assign(i, { kcal: prod.kcal, c: prod.c, p: prod.p, f: prod.f, fib: prod.fib, pack: prod.pack, price: prod.price, priceEst: prod.priceEst, shelf: prod.shelf, brand: prod.brand, code: prod.code, source: prod.source, name: keepName });
  if (prod.cat !== 'Eigene Zutaten') i.cat = prod.cat;
  delete i.needsData;
  saveCustomIng();
}

async function runLookup(n, q) {
  S.ui.lookup = { n, q, loading: true };
  render();
  try {
    const results = await searchProducts(q);
    if (S.ui.lookup?.n === n) S.ui.lookup = { n, q, results };
  } catch (err) {
    if (S.ui.lookup?.n === n) S.ui.lookup = { n, q, error: navigator.onLine === false ? 'Keine Internetverbindung – die Suche braucht Internet.' : 'Suche gerade nicht erreichbar. Bitte später nochmal versuchen.' };
  }
  if (location.hash.startsWith('#/bearbeiten')) render();
}

/** Barcode scannen und Produkt nachschlagen. Ergebnis: Produkt oder null */
async function scanProduct() {
  let code;
  try {
    code = await scanBarcode();
  } catch (err) {
    toast('Scanner geht gerade nicht', { icon: '📷', sub: err.message, kind: 'warn' });
    return null;
  }
  if (!code) return null;
  haptic();
  busy('Produkt wird nachgeschlagen …');
  try {
    const prod = await lookupBarcode(code);
    if (!prod) toast('Produkt nicht gefunden', { icon: '🔎', sub: `Barcode ${code} – such es per Namen`, kind: 'warn' });
    return prod;
  } catch {
    toast('Nachschlagen hat nicht geklappt', { icon: '⚠️', sub: 'Internetverbindung prüfen', kind: 'warn' });
    return null;
  } finally {
    busy(null);
  }
}

function viewRecipeBase(id) {
  const r = recipe(id);
  if (!r) return `<div class="card">Rezept nicht gefunden.</div>`;
  const n = S.ui.servings || 1;
  const items = r.ingredients.filter((l) => !l.opt || S.settings[l.opt]).map((l) => ({ id: l.id, g: l.g * n, note: l.note }));
  const per = macrosOf(items.map((it) => ({ ...it, g: it.g / n })));
  const back = S.ui.recipeFrom === 'einkauf' ? `<a class="back" href="#/einkauf">‹ Einkauf</a>` : `<a class="back" href="#/rezepte">‹ Rezepte</a>`;
  return recipeHtml(r, items, per, `Basisrezept · ${n === 1 ? '1 Portion' : n + ' Portionen'}`, back, '', 'r:' + id, true, n);
}

function recipeHtml(r, items, macros, subtitle, back, info, cookKey, withServings, cur = 1) {
  const cookHref = `#/kochen/${encodeURIComponent(cookKey)}`;
  // Läuft der Kochmodus schon, gibt es oben nur „Weiter kochen“
  const active = S.ui.cookActive;
  const resumeHref = active ? `#/kochen/${encodeURIComponent(active)}` : '';
  const ingList = items
    .map((it) => {
      const i = ing(it.id);
      const k = `${r.id}:${it.id}`;
      return `<li class="mep ${S.ui.mep?.[k] ? 'on' : ''}" data-action="mep" data-k="${e(k)}"><span class="mep-c" aria-hidden="true"></span><span class="mep-n">${e(i.name)}${it.note ? ` <small class="muted">${e(it.note)}</small>` : ''}${it.extra ? ` <small class="badge">+${Math.round(it.extra)}g Restverwertung</small>` : ''}</span><b>${amountText(i, it.g)}</b></li>`;
    })
    .join('');
  const tools = stepTools(r);
  const steps = r.steps
    .map(
      (s, n) =>
        `<li>${tools[n]?.length ? `<div class="step-tools">${tools[n].map((t) => `<span class="tool">${e(t)}</span>`).join('')}</div>` : ''}<p>${stepHtml(s.t, items)}</p>${s.timer ? `<button class="btn small pill timer-btn" data-action="timer" data-sec="${s.timer}" data-label="${e(s.label || 'Schritt ' + (n + 1))}" data-ctx="${e(r.name)}">⏱️ ${e(s.label || '')} ${fmtTime(s.timer)}</button>` : ''}</li>`
    )
    .join('');
  const allTools = tools.flat();
  // Portionen: im Basisrezept die Anzahl Portionen, im Wochenplan „für wie viele Personen“ (zählt für den Einkauf)
  const people = withServings === 'people';
  const servings = withServings
    ? `<section class="card">${H2('🍽️', people ? 'Für wie viele Personen?' : 'Portionen')}<div class="pills">${[1, 2, 3, 4, 5, 6]
        .map((n) => `<button class="pill circle ${cur === n ? 'on' : ''}" data-action="${people ? 'people' : 'servings'}" data-key="${e(cookKey)}" data-n="${n}">${n}</button>`)
        .join('')}</div>${people ? `<p class="hint">Weitere Personen bekommen dieselbe Menge wie du. Die Einkaufsliste rechnet sie automatisch mit.</p>` : ''}</section>`
    : '';
  const magic = isFancy(r) ? 'magic' : '';
  const startBtn = (cls) =>
    active === cookKey ? `<a class="btn primary ${magic} ${cls}" href="${cookHref}">👨‍🍳 Weiter kochen</a>` : `<a class="btn primary ${magic} ${cls}" href="${cookHref}">${magic ? '✨' : '👨‍🍳'} Kochmodus starten</a>`;
  const ar = active && cookRecipe(active);
  const activeMagic = isFancy(ar) ? `magic ${isGourmet(ar) ? 'gourmet' : ''}` : '';
  const fav = recipe(r.id) ? isFav(r.id) : null;
  const star =
    fav === null
      ? ''
      : `<button class="fav-btn ${fav ? 'on' : ''}" data-action="fav-toggle" data-id="${e(r.id)}" aria-label="${fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}">⭐</button>`;
  return `<header class="top">${back}<div class="top-actions">${star}${active ? `<a class="btn primary pill ${activeMagic}" href="${resumeHref}">👨‍🍳 Weiter kochen</a>` : startBtn('pill')}</div></header>
    <section class="card accent rhero">
      <div class="rhero-art slot-${r.type === 'breakfast' ? 'fruehstueck' : 'abend'}"><span>${recipeEmoji(r)}</span></div>
      <div class="card-head"><div class="sub">${e(subtitle)}</div><a class="btn small pill" href="#/bearbeiten/${r.id}">✏️ Ändern</a></div>
      <h1 class="rtitle">${e(r.name)}</h1>
      <div class="chips"><span class="chip on">⏱️ ${r.time} Min.</span><span class="chip">🧽 ${dishesText(allTools.length || r.dishes)}</span><span class="chip">${isFancy(r) ? `✨ ${fancyLabel(r)}` : ['', 'einfach', 'normal', 'aufwendig'][r.effort]}</span>${r.protein ? `<span class="chip">${e(r.protein)}</span>` : ''}</div>
      <div class="mtiles">
        <div class="mt-k"><b>${num(macros.kcal)}</b><span>kcal</span></div>
        <div><b>${g_(macros.c)}</b><span>Kohlenhydrate</span></div>
        <div><b>${g_(macros.p)}</b><span>Protein</span></div>
        <div><b>${g_(macros.f)}</b><span>Fett</span></div>
      </div>
    </section>
    <section class="card">${H2('🏷️', 'Kategorien')}
      <div class="chips cats">${S.cats.names
        .map((n) => `<button class="chip ${catsOf(r.id).includes(n) ? 'on' : ''}" data-action="rcat-toggle" data-id="${r.id}" data-val="${e(n)}">${catsOf(r.id).includes(n) ? '✓ ' : ''}${e(n)}</button>`)
        .join('')}</div>
    </section>
    ${info}
    ${servings}
    <section class="card">${H2('🧺', 'Zutaten')}<p class="hint">Antippen zum Abhaken, während du alles bereitlegst.</p><ul class="ings">${ingList}</ul></section>
    ${allTools.length ? `<section class="card">${H2('🍳', 'Das brauchst du')}<div class="chips tools">${allTools.map((t) => `<span class="chip">${e(t)}</span>`).join('')}</div><p class="hint">Bei der Zubereitung steht an jedem Schritt, was neu dazukommt.</p></section>` : ''}
    <section class="card">${H2('👨‍🍳', 'Zubereitung')}<ol class="steps tl">${steps}</ol>
      ${startBtn('block')}
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
      items = cookItems(plan, meal);
      backHref = `#/mahlzeit/${key}`;
    }
  }
  if (!r) return `<div class="card">Nicht gefunden.</div>`;
  keepAwake(true);
  S.ui.cookActive = key;
  const n = Math.min(S.ui.cookStep, r.steps.length - 1);
  const s = r.steps[n];
  const tools = stepTools(r)[n] || [];
  return `<div class="cook">
    <header class="top col"><a class="back" href="${backHref}">‹ Zurück</a></header>
    <div class="cook-head"><span class="mtile slot-abend">${recipeEmoji(r)}</span><a class="sub underline" href="${backHref}">${e(r.name)}</a></div>
    <div class="cook-progress" aria-hidden="true">${r.steps.map((_, i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>
    <div class="step-count">Schritt ${n + 1} von ${r.steps.length}</div>
    ${tools.length ? `<div class="cook-tools"><span>Du brauchst jetzt</span>${tools.map((t) => `<b class="tool">${e(t)}</b>`).join('')}</div>` : ''}
    <p class="step-text" data-step="${n}">${stepHtml(s.t, items)}</p>
    <div class="cook-actions">
      ${s.timer ? `<button class="btn primary block big" data-action="timer" data-sec="${s.timer}" data-label="${e(s.label || 'Schritt ' + (n + 1))}" data-ctx="${e(r.name)}">⏱️ Timer ${fmtTime(s.timer)} starten</button>` : ''}
    <div class="cook-nav">
      <button class="btn big" data-action="cook-step" data-d="-1" ${n === 0 ? 'disabled' : ''}>‹ Zurück</button>
      ${
        n === r.steps.length - 1
          ? `<button class="btn big primary ${isFancy(r) ? 'magic' : ''}" data-action="cook-done" data-back="${backHref}">Fertig ✓</button>`
          : `<button class="btn big primary" data-action="cook-step" data-d="1">Weiter ›</button>`
      }
    </div>
    </div>
  </div>`;
}

/**
 * Schritt-Text mit Mengen: Vor einer erwähnten Zutat steht ihre Menge (grau), z. B. „130 g Spaghetti“.
 * Zahlen, die schon im Text stehen (auch in eigenen Rezepten), werden genauso grau dargestellt.
 */
function stepHtml(text, items = []) {
  const norm = (w) => w.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  const terms = items.map((it) => {
    const i = ing(it.id);
    const raw = [i?.name || '', ...(i?.kw || [])].join(' ').replace(/\(.*?\)/g, ' ');
    const toks = raw.split(/[^A-Za-zÄÖÜäöüß]+/).filter((t) => t.length >= 4).map(norm);
    let amount = '';
    if (i) {
      if (i.piece && !i.staple && it.g >= i.piece * 0.6) amount = (Math.round((it.g / i.piece) * 2) / 2).toLocaleString('de-DE');
      else amount = `${it.g < 10 ? (Math.round(it.g * 2) / 2).toLocaleString('de-DE') : Math.round(it.g)}g`;
    }
    return { toks, amount, done: false };
  });
  // Wörter durchgehen und Mengen vor dem ersten Treffer je Zutat einsetzen (Platzhalter, damit sie nicht doppelt gefärbt werden)
  const slots = [];
  let out = text.replace(/[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß-]*/g, (word) => {
    const w = norm(word);
    if (w.length < 3) return word;
    const t = terms.find((x) => !x.done && x.amount && x.toks.some((tok) => (w.length >= 4 && tok.startsWith(w.slice(0, Math.max(4, w.length - 2)))) || (tok.length >= 4 && w.startsWith(tok))));
    if (!t) return word;
    t.done = true;
    slots.push(t.amount);
    return `\u0001${String.fromCharCode(65 + slots.length - 1)}\u0002${word}`;
  });
  // Zahl und Gramm (kg, ml) immer ohne Lücke: „250g“
  out = e(out).replace(/(\d+(?:[.,]\d+)?(?:\s?[–-]\s?\d+(?:[.,]\d+)?)?(?:\s?(?:g|kg|ml|l|EL|TL|Min\.?|Minuten|Std\.?|Stunden|°C|°|cm|Stück|%))?)(?![A-Za-zÄÖÜäöüß])/g, (m) => `<span class="amt">${m.replace(/(\d)\s(g|kg|ml)$/, '$1$2')}</span>`);
  return out.replace(/\u0001([A-Z])\u0002/g, (_, c) => `<span class="amt">${e(slots[c.charCodeAt(0) - 65])}</span> `);
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
      `${packText(it).replace(/(\d) g\b/g, '$1g').replace(/(\d) Liter\b/, '$1L')} · benötigt ${g_(it.need)}${it.have ? ` (davon ${g_(it.have)} Rest)` : ''}${it.offer ? ` · <span class="badge offer">Angebot${it.offerTitle ? ': ' + e(it.offerTitle) : ''}</span>` : ''}${it.note ? ` · ${e(it.note)}` : ''}${it.elsewhere ? ` · nur bei ${e(STORES[it.store]?.short || it.store)} erhältlich` : ''}`,
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
        <div><b data-count="s-open" data-to="${openCost}" data-fmt="euro">${euro(openCost)}</b><span>noch offen</span></div>
        <div><b><i data-count="s-done" data-to="${toBuy.filter((i) => checks[i.id]).length}" data-fmt="int">${toBuy.filter((i) => checks[i.id]).length}</i>/${toBuy.length}</b><span>erledigt</span></div>
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

/**
 * Liniendiagramm (SVG). weeks = x-Achse (inkl. Prognose-Wochen), series: [{ name, cls, marker, values[], forecast? }]
 * Beim Öffnen des Rückblicks zeichnen sich die Linien animiert (Klasse .play am Container).
 */
function lineChart({ weeks, series, min, max, ticks, fmt, labelFmt = fmt, goal, unit = '', forecastFrom = null }) {
  // flach genug, dass beide Diagramme in die feste Rückblick-Karte passen
  const W = 320, H = 112, L = 30, R = 46, T = 12, B = 22;
  const x = (i) => L + (i * (W - L - R)) / (weeks.length - 1);
  const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const grid = ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('');
  const xl = weeks.map((w, i) => `<text class="axis${forecastFrom != null && i >= forecastFrom ? ' fc-t' : ''}" x="${x(i)}" y="${H - 6}" text-anchor="middle">KW ${isoWeek(w)}</text>`).join('');
  // Prognose-Bereich leicht hinterlegt
  const fcZone =
    forecastFrom != null
      ? `<rect class="fc-zone" x="${(x(forecastFrom - 1) + x(forecastFrom)) / 2}" y="${T - 6}" width="${W - R - (x(forecastFrom - 1) + x(forecastFrom)) / 2 + 4}" height="${H - T - B + 10}" rx="8"/><text class="axis fc-t" x="${W - R}" y="${T + 2}" text-anchor="end">Prognose</text>`
      : '';
  const goalLine = goal != null ? `<line class="goal" x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}"/>` : '';
  let n = 0;
  // Beschriftungen am Linienende nicht übereinander: mindestens 11px Abstand
  const ends = series
    .filter((s) => !s.forecast)
    .map((s) => {
      const last = s.values.map((v, i) => [v, i]).filter(([v]) => v != null).pop();
      return last ? { s, y: y(last[0]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 11) ends[i].y = ends[i - 1].y + 11;
  const labelY = new Map(ends.map((x) => [x.s, x.y]));
  const marks = series
    .map((s) => {
      let path = '';
      s.values.forEach((v, i) => {
        if (v == null) return;
        path += `${i > 0 && s.values[i - 1] != null ? 'L' : 'M'}${x(i)} ${y(v)} `;
      });
      if (s.forecast) return path ? `<path class="ln fc ${s.cls}" d="${path}"/>` : '';
      const pts = s.values
        .map((v, i) => {
          if (v == null) return '';
          const tip = `KW ${isoWeek(weeks[i])} · ${s.name}: ${labelFmt(v)}${unit}`;
          const style = `style="--i:${n++}"`;
          const m =
            s.marker === 'square'
              ? `<rect class="pt ${s.cls}" ${style} x="${x(i) - 4}" y="${y(v) - 4}" width="8" height="8" rx="1.5"/>`
              : s.marker === 'diamond'
                ? `<path class="pt ${s.cls}" ${style} d="M${x(i)} ${y(v) - 5.5}L${x(i) + 5.5} ${y(v)}L${x(i)} ${y(v) + 5.5}L${x(i) - 5.5} ${y(v)}Z"/>`
                : `<circle class="pt ${s.cls}" ${style} cx="${x(i)}" cy="${y(v)}" r="4.5"/>`;
          return `${m}<circle class="hit" cx="${x(i)}" cy="${y(v)}" r="16" data-action="chart-tip" data-tip="${e(tip)}"/>`;
        })
        .join('');
      const last = s.values.map((v, i) => [v, i]).filter(([v]) => v != null).pop();
      // Mit Prognose steht die Beschriftung über dem Punkt, damit sie die gestrichelte Linie nicht verdeckt
      const label = !last ? '' : forecastFrom != null ? `<text class="dl" x="${x(last[1])}" y="${y(last[0]) - 11}" text-anchor="middle">${labelFmt(last[0])}</text>` : `<text class="dl" x="${x(last[1]) + 9}" y="${(labelY.get(s) ?? y(last[0])) + 4}">${labelFmt(last[0])}</text>`;
      return `<path class="ln ${s.cls}" pathLength="1" d="${path}"/>${pts}${label}`;
    })
    .join('');
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img">${fcZone}${grid}${xl}${goalLine}${marks}</svg>`;
}

/** Lineare Regression über die eingetragenen Gewichte → kg pro Woche */
function weightTrend(points) {
  if (points.length < 2) return null;
  const n = points.length;
  const mx = points.reduce((a, p) => a + p.i, 0) / n;
  const my = points.reduce((a, p) => a + p.v, 0) / n;
  const den = points.reduce((a, p) => a + (p.i - mx) ** 2, 0);
  if (!den) return null;
  return points.reduce((a, p) => a + (p.i - mx) * (p.v - my), 0) / den;
}

function trendCard(ws, rateWs = null) {
  const weeks = [-21, -14, -7, 0].map((d) => addDays(ws, d));
  const val = (w, f) => feedbackFor(w)?.week?.[f] ?? null;
  const sat = weeks.map((w) => val(w, 'satiety'));
  const en = weeks.map((w) => val(w, 'energy'));
  const mood = weeks.map((w) => val(w, 'mood'));
  const has = (arr) => arr.some((v) => v != null);
  const chart1 = has(sat) || has(en) || has(mood)
    ? lineChart({
        weeks,
        min: 1,
        max: 6,
        ticks: [1, 6],
        fmt: (v) => num(v),
        series: [
          { name: 'Sättigung', cls: 's1', marker: 'circle', values: sat },
          { name: 'Energie', cls: 's2', marker: 'square', values: en },
          { name: 'Stimmung', cls: 's3', marker: 'diamond', values: mood },
        ],
      })
    : `<p class="chart-empty">Noch keine Werte – tippe unten auf Sättigung, Energie und Stimmung.</p>`;

  // Gewicht: 4 Wochen Verlauf + 2 Wochen Prognose aus dem Trend
  const goal = S.settings.goalWeight;
  const kg = weeks.map((w) => val(w, 'weight'));
  // für den Trend auch ältere Einträge nutzen (bis 8 Wochen zurück)
  const trendPts = [-49, -42, -35, -28, -21, -14, -7, 0]
    .map((d, i) => ({ i, v: val(addDays(ws, d), 'weight') }))
    .filter((p) => p.v != null);
  const slope = weightTrend(trendPts);
  let chart2 = `<p class="chart-empty">Noch kein Gewicht eingetragen.</p>`;
  let trendText = '';
  let progress = '';
  if (has(kg)) {
    const lastIdx = kg.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).pop();
    const last = kg[lastIdx];
    const fcWeeks = slope != null ? [7, 14].map((d) => addDays(ws, d)) : [];
    const allWeeks = weeks.concat(fcWeeks);
    const fc = allWeeks.map((w, i) => (slope != null && i >= lastIdx ? Math.round((last + slope * (i - lastIdx)) * 10) / 10 : null));
    const vals = kg.filter((v) => v != null).concat(goal ? [goal] : [], fc.filter((v) => v != null));
    let lo = Math.floor(Math.min(...vals) - 0.5);
    let hi = Math.ceil(Math.max(...vals) + 0.5);
    if (hi - lo < 2) hi = lo + 2;
    const mid = Math.round(((lo + hi) / 2) * 2) / 2;
    chart2 = lineChart({
      weeks: allWeeks,
      min: lo,
      max: hi,
      ticks: [lo, mid, hi],
      fmt: (v) => fmtKg(v).replace(/,0$/, ''),
      labelFmt: fmtKg,
      unit: ' kg',
      goal,
      forecastFrom: fcWeeks.length ? weeks.length : null,
      series: [
        { name: 'Prognose', cls: 's1', forecast: true, values: fc },
        { name: 'Gewicht', cls: 's1', marker: 'circle', values: kg.concat(fcWeeks.map(() => null)) },
      ],
    });
    // Motivierender Ausblick
    if (slope != null) {
      const perWeek = `${slope > 0 ? '+' : '−'}${fmtKg(Math.abs(slope))} kg/Woche`;
      if (goal && Math.abs(goal - last) < 0.3) trendText = `🎯 Du bist am Ziel – jetzt geht es ums Halten.`;
      else if (goal && Math.abs(slope) >= 0.05 && Math.sign(goal - last) === Math.sign(slope)) {
        const weeksLeft = Math.ceil(Math.abs(goal - last) / Math.abs(slope));
        trendText = weeksLeft <= 52 ? `📈 Weiter so! Bei deinem Tempo (${perWeek}) erreichst du dein Ziel etwa in <b>KW ${isoWeek(addDays(weeks[lastIdx], 7 * weeksLeft))}</b>.` : `📈 Du bist auf dem richtigen Weg (${perWeek}).`;
      } else if (goal && Math.abs(slope) >= 0.05) trendText = `Trend: ${perWeek} – dein Ziel liegt in der anderen Richtung. Kleine Anpassungen bringen dich zurück auf Kurs.`;
      else trendText = `Trend: ${Math.abs(slope) < 0.05 ? 'stabil' : perWeek}.`;
    }
    // Fortschritt vom ersten eingetragenen Gewicht bis zum Ziel
    const first = S.feedback.filter((f) => f.week?.weight != null).sort((a, b) => a.weekStart.localeCompare(b.weekStart))[0]?.week.weight;
    if (goal && first != null && Math.abs(first - goal) >= 0.3) {
      const pct = Math.max(0, Math.min(1, (first - last) / (first - goal)));
      progress = `<div class="goal-progress"><div class="gp-bar"><i style="--p:${(pct * 100).toFixed(0)}%"></i></div><span>${Math.round(pct * 100)} % geschafft</span></div>`;
    }
  }
  return `<section class="card accent charts">
    <div class="chart">
      <div class="chart-head"><h2>Wie war die Woche?</h2>
        <div class="legend"><span><i class="sw s1"></i>Sättigung</span><span><i class="sw s2 sq"></i>Energie</span><span><i class="sw s3 dia"></i>Stimmung</span></div></div>
      ${chart1}
    </div>
    <div class="chart">
      <div class="chart-head"><h2>Gewicht <span class="sub">kg</span></h2>${goal ? `<div class="legend"><span><i class="sw goal"></i>Ziel ${fmtKg(goal)}</span></div>` : ''}</div>
      ${chart2}
      ${progress}
      ${trendText ? `<p class="trend-text">${trendText}</p>` : ''}
    </div>
    ${has(sat) || has(en) || has(mood) || has(kg) ? `<p class="chart-tip sub" aria-live="polite">Punkt antippen für Details</p>` : ''}
    ${rateWs ? weekRating(rateWs) : ''}
  </section>`;
}

/**
 * „Wie war die Woche?“ in einer Zeile: Sättigung und Energie zählen bei jedem Tippen hoch (1–6,
 * danach wieder leer), daneben Gewicht und Ziel.
 */
function weekRating(ws) {
  const wk = feedbackFor(ws)?.week || {};
  const rate = (field, label) => {
    const v = wk[field] || 0;
    return `<button class="rate-btn ${v ? 'on' : ''}" data-action="rate" data-week="${ws}" data-field="${field}" style="--p:${(v / 6) * 100}%" aria-label="${label}: ${v || 'nicht bewertet'} von 6">
      <span class="rate-ring"><b>${v || '–'}</b></span><small>${label}</small></button>`;
  };
  return `<div class="week-rate">
    ${rate('satiety', 'Sättigung')}
    ${rate('energy', 'Energie')}
    ${rate('mood', 'Stimmung')}
    <label class="mini-field"><small>Gewicht</small><input type="text" inputmode="decimal" placeholder="kg" data-weight data-week="${ws}" value="${fmtKg(wk.weight)}"></label>
    <label class="mini-field"><small>Ziel</small><input type="text" inputmode="decimal" placeholder="kg" data-goal-weight value="${fmtKg(S.settings.goalWeight)}"></label>
  </div>`;
}

/**
 * Wochen wählen: waagerecht wischbare KW-Leiste, die immer auf einer Woche einrastet
 * (bis zur nächsten zu planenden Woche). Ab der ersten Woche mit Daten, mindestens 12 Wochen zurück.
 */
function weekPager(ws, maxWeek) {
  const known = [...Object.keys(S.plans), ...S.feedback.map((f) => f.weekStart)].sort();
  let first = addDays(currentWeek(), -7 * 11);
  if (known[0] && known[0] < first) first = known[0] < addDays(currentWeek(), -7 * 52) ? addDays(currentWeek(), -7 * 52) : known[0];
  const weeks = [];
  for (let w = first; w <= maxWeek; w = addDays(w, 7)) weeks.push(w);
  if (!weeks.includes(ws)) weeks.push(ws);
  const tag = (w) => (w === currentWeek() ? 'jetzt' : w > currentWeek() ? 'nächste' : formatDate(w, { day: 'numeric', month: 'numeric' }));
  return `<nav class="kw-strip" data-kw-strip aria-label="Woche wählen">${weeks
    .map((w) => `<a class="kw ${w === ws ? 'cur' : ''}" href="#/rueckblick/${w}" data-week="${w}"><b>KW ${isoWeek(w)}</b><small>${tag(w)}${feedbackFor(w) ? ' ✓' : ''}</small></a>`)
    .join('')}</nav>`;
}

/** KW-Leiste: aktuelle Woche mittig zeigen, beim Wischen einrasten (mit Tippen), danach die Woche öffnen */
function setupKwStrip() {
  const strip = document.querySelector('[data-kw-strip]');
  if (!strip) return;
  const items = [...strip.querySelectorAll('.kw')];
  const cur = strip.querySelector('.kw.cur');
  const center = (el) => el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2;
  if (cur) strip.scrollLeft = center(cur);
  let last = cur;
  let timer;
  const centered = () => {
    const mid = strip.scrollLeft + strip.clientWidth / 2;
    return items.reduce((a, b) => (Math.abs(b.offsetLeft + b.offsetWidth / 2 - mid) < Math.abs(a.offsetLeft + a.offsetWidth / 2 - mid) ? b : a));
  };
  const settle = () => {
    // Leiste wurde inzwischen neu gezeichnet: alte Leiste darf nicht mehr umschalten
    if (!strip.isConnected) return;
    const el = centered();
    if (el && el !== cur) location.hash = `#/rueckblick/${el.dataset.week}`;
  };
  strip.addEventListener(
    'scroll',
    () => {
      if (!strip.isConnected) return clearTimeout(timer);
      const el = centered();
      if (el !== last) {
        last?.classList.remove('near');
        el.classList.add('near');
        last = el;
        haptic();
      }
      clearTimeout(timer);
      timer = setTimeout(settle, 180);
    },
    { passive: true }
  );
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
    <section class="card"><h2>Ab wann planen?</h2>
      <p class="sub">Kommst du erst später in der Woche zurück (KW ${isoWeek(draft.week)})? Dann plant Mise erst ab diesem Tag und du kaufst nur für die restlichen Tage ein.</p>
      <div class="pills days">${DAY_SHORT.map((d, i) => `<button class="pill circle ${(draft.start || 0) === i ? 'on' : ''}" data-action="draft-start" data-day="${i}">${d}</button>`).join('')}</div>
    </section>
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
  // Jede Woche ist anwählbar – auch ohne Plan (dann nur Sättigung, Energie und Gewicht)
  const maxWeek = draft.week > currentWeek() ? draft.week : currentWeek();
  const valid = (w) => /^\d{4}-\d{2}-\d{2}$/.test(w || '') && w <= maxWeek;
  const ws = valid(weekArg) ? mondayOf(new Date(weekArg + 'T12:00:00')) : weeks[0] || currentWeek();
  const plan = S.plans[ws];
  const head = `<header class="top col"><h1>Rückblick</h1></header>`;
  // Oben: Diagramme samt Wochenbewertung und KW-Leiste füllen genau den Bildschirm
  const top = (card) => `<div class="rb-top">${head}${card}${weekPager(ws, maxWeek)}</div>`;
  if (ws > currentWeek() && !plan) {
    return `${top(trendCard(currentWeek(), currentWeek()))}
      <section class="card tip"><p>🗓️ Der Plan für KW ${isoWeek(ws)} wird am Montag ab ${S.settings.planHour ?? 8}:00 Uhr erstellt. Hier kannst du ihn vorbereiten:</p></section>
      ${planningCards}`;
  }
  const fb = feedbackFor(ws) || { weekStart: ws, recipes: {}, week: {} };
  const hints = weekHints(S.feedback, S.settings.goals, S.settings.goalWeight);
  // Gerichte in der Reihenfolge der Woche, nach Tagen getrennt (jedes Gericht einmal, am ersten Tag)
  const byDay = [];
  const also = new Map();
  for (const d of plan?.days || []) {
    const list = [];
    for (const m of d.meals) {
      if (m.kind !== 'recipe') continue;
      if (also.has(m.recipeId)) {
        const a = also.get(m.recipeId);
        if (!a.includes(d.short) && a[0] !== d.short) a.push(d.short);
        continue;
      }
      also.set(m.recipeId, [d.short]);
      list.push(m.recipeId);
    }
    if (list.length) byDay.push({ short: d.short, list });
  }
  const icon = (id, field, val, emoji, label) => {
    const cur = fb.recipes[id]?.[field];
    const on = val === undefined ? !!cur : cur === val;
    return `<button class="pill circle ${on ? 'on' : ''}" data-action="fb" data-week="${ws}" data-id="${id}" data-field="${field}" data-val="${val ?? ''}" aria-label="${label}" title="${label}">${emoji}</button>`;
  };
  const dishesCard = () =>
    byDay.length
      ? `<section class="card"><h2>Gerichte der Woche</h2><ul class="fb-days">${byDay
          .map(
            (d) => `<li class="fb-day"><span class="day-dot">${d.short}</span><div class="fb-meals">${d.list
              .map((id) => {
                const more = also.get(id).slice(1);
                return `<div class="fb-meal"><div class="fb-name">${e(recipe(id)?.name || id)}${more.length ? ` <small class="muted">· auch ${more.join(', ')}</small>` : ''}</div><div class="pills">
          ${icon(id, 'rating', 1, '👍', 'War gut')}${icon(id, 'rating', -1, '👎', 'War schlecht')}${icon(id, 'dishes', undefined, '🧽', 'War zu viel Abwasch')}${icon(id, 'tooComplex', undefined, '⏱️', 'War zu aufwendig')}${icon(id, 'tooExpensive', undefined, '💸', 'War zu teuer')}
        </div></div>`;
              })
              .join('')}</div></li>`
          )
          .join('')}</ul></section>`
      : '';
  return `${top(trendCard(ws, ws))}
    ${hints.length ? `<section class="card tip">${hints.map((h) => `<p>💡 ${e(h)}</p>`).join('')}</section>` : ''}
    ${plan ? '' : `<p class="sub center">Für diese Woche gibt es keinen Plan – Sättigung, Energie und Gewicht kannst du trotzdem eintragen.</p>`}
    ${dishesCard()}
    ${ws === currentWeek() || ws === weeks[0] ? planningCards : ''}`;
}

/** Zielgewicht erreicht? (Gewicht hat das Ziel getroffen oder überschritten – egal ob ab- oder zunehmend) */
function checkGoal(before, now) {
  const goal = S.settings.goalWeight;
  if (!goal || now == null) return;
  const hit = Math.abs(now - goal) < 0.05 || (before != null && Math.abs(before - goal) >= 0.05 && (before - goal) * (now - goal) < 0);
  if (hit) return celebrate(now);
  // Schritt in Richtung Ziel: kurz bestärken
  if (before != null && Math.abs(now - goal) < Math.abs(before - goal) - 0.05) {
    sound.progress();
    haptic();
    toast(`${now < before ? '−' : '+'}${fmtKg(Math.abs(now - before))} kg – in die richtige Richtung`, { icon: '💪', sub: `Noch ${fmtKg(Math.abs(now - goal))} kg bis zum Ziel` });
  }
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
  scheduleSnapshot();
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
    <a class="btn small pill" href="#/start/1">🧮 Mit Assistent neu berechnen</a>
    <div class="grid2">
      ${field('goals.kcal', 'Kalorien (kcal)', 'step="50"')}
      ${field('goals.carbs', 'Kohlenhydrate (g)', 'step="5"')}
      ${field('goals.protein', 'Protein (g)', 'step="5"')}
      ${field('goals.fat', 'Fett (g)', 'step="5"')}
    </div>
    ${pl.ok ? '' : `<p class="warn-text">⚠️ ${e(pl.message)}</p>`}
    ${!pl.ok && pl.suggestedCarbs > 0 ? `<button class="btn small pill" data-action="fix-carbs" data-val="${pl.suggestedCarbs}">Kohlenhydrate auf ${pl.suggestedCarbs}g setzen</button>` : ''}
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
    <label class="field">Hauptladen<select data-set="mainStore">${STORE_IDS
      .map((id) => `<option value="${id}" ${st.mainStore === id ? 'selected' : ''}>${e(STORES[id].short)}</option>`)
      .join('')}</select></label>
    <p class="sub">Gekauft wird im Hauptladen. Nur wenn ein anderer ausgewählter Laden mindestens 10 % günstiger ist (z. B. durch ein Angebot) oder der Hauptladen den Artikel nicht führt, landet er dort – z. B. Spezielles wie grüne Tagliatelle bei Edeka. dm und Rossmann führen nur Trockenware, Nüsse & Co.</p>
    <div class="grid2 budget-row">
      <label class="field">Wochenbudget<span class="unit-input"><input type="number" inputmode="numeric" step="1" data-set="budget" value="${st.budget}"><i>€</i></span></label>
      <label class="studi-toggle"><input type="checkbox" class="big-check" data-set="studi" ${st.studi ? 'checked' : ''}><span>Studi-Modus</span></label>
    </div>
    ${S.plans[currentWeek()] && (S.plans[currentWeek()].studi ?? false) !== !!st.studi ? `<button class="btn small pill" data-action="replan-studi">Diese Woche ${st.studi ? 'im Studi-Modus ' : ''}neu planen</button>` : ''}
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
    <label class="field">Dein Name (für die Begrüßung)<input type="text" autocomplete="given-name" data-set="name" value="${e(st.name || '')}" placeholder="z. B. Michael"></label>
    ${field('planHour', 'Neuer Plan montags ab (Uhr)', 'min="0" max="23"')}
  </section>

  <section class="card"><h2>Rezepte für alle Geräte</h2>
    <p class="sub">Neue Rezepte – von dir, deiner Familie oder der KI – landen in der gemeinsamen Sammlung und erscheinen nach ein paar Minuten auf allen Geräten. Dafür braucht jedes Gerät einmal den Freigabe-Schlüssel.</p>
    <label class="field">Freigabe-Schlüssel<input type="password" autocomplete="off" placeholder="github_pat_…" data-set="shareToken" value="${e(st.shareToken || '')}"></label>
    <p class="hint">${st.shareToken ? `✓ Teilen ist aktiv.${store.get('shareQueue', []).length ? ` ${store.get('shareQueue', []).length} Rezept(e) warten auf Internet.` : ''}` : 'Ohne Schlüssel bleiben neue Rezepte nur auf diesem Gerät.'}</p>
    ${st.shareToken ? `<button class="btn small pill" data-action="share-invite">📨 Einladungslink für ein anderes Gerät</button>` : ''}
  </section>

  <section class="card"><h2>KI-Rezepte <span class="sub">(optional, kostenpflichtig)</span></h2>
    <p class="sub">Mit einem eigenen Claude-API-Schlüssel erfindet Mise neue Gerichte: jeden Montag eines für deinen Plan, bei ↻ in der Woche und wenn du unter „Rezepte“ nur einen Titel einträgst. Kosten: ca. 3–5 Cent pro Rezept auf deinem Anthropic-Konto. Der Schlüssel bleibt nur auf diesem Gerät.</p>
    <label class="field">API-Schlüssel<input type="password" autocomplete="off" placeholder="sk-ant-…" data-set="aiKey" value="${e(st.aiKey || '')}"></label>
    <p class="hint">${st.aiKey ? '✓ KI-Rezepte sind aktiv.' : 'Ohne Schlüssel schlägt Mise nur Rezepte aus der Sammlung vor.'} Schlüssel erstellen: console.anthropic.com → API Keys.</p>
  </section>

  <section class="card"><h2>Datensicherung</h2>
    <p class="sub"><b>Automatisch:</b> Mise legt jeden Tag eine Kopie deiner Daten auf diesem iPhone ab (die letzten 14 Tage). ${S.snapshots.length ? `Letzte Sicherung: ${fmtDateTime(S.snapshots[0].savedAt)}.` : 'Die erste Sicherung entsteht heute.'}</p>
    ${
      S.snapshots.length
        ? `<div class="snap-row"><select id="snap-pick">${S.snapshots.map((x) => `<option value="${x.day}">${fmtDateTime(x.savedAt)}</option>`).join('')}</select><button class="btn pill" data-action="snap-restore">Wiederherstellen</button></div>`
        : ''
    }
    <p class="sub"><b>In iCloud:</b> Gegen Verlust oder Wechsel des iPhones sichere einmal pro Woche mit einem Tipp in iCloud Drive (Teilen → „In Dateien sichern“). ${store.get('lastExport') ? `Zuletzt: ${fmtDateTime(store.get('lastExport'))}.` : 'Noch nie gesichert.'}</p>
    <div class="grid2"><button class="btn primary" data-action="export">☁️ Sichern</button>
    <label class="btn">Importieren<input type="file" accept="application/json,.json" id="import-file" hidden></label></div>
    <button class="link danger" data-action="reset-settings">Einstellungen zurücksetzen</button>
    <button class="link danger" data-action="reset-app">App zurücksetzen (alles löschen, neu beginnen)</button>
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
      (t) => `<div class="timer ${t.theme === 'gourmet' ? 'fancy gourmet' : t.theme || ''} ${t.done ? 'ringing' : ''} ${t.paused != null ? 'paused' : ''}">
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
  // Höhe der Timer merken: Im Kochmodus sitzen „Zurück/Weiter“ mit gleichem Abstand darüber
  document.documentElement.style.setProperty('--dock-h', timers.timers.length ? `${dock.offsetHeight + 8}px` : '0px');
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
    case 'mep': {
      S.ui.mep ||= {};
      const on = (S.ui.mep[el.dataset.k] = !S.ui.mep[el.dataset.k]);
      el.classList.toggle('on', on);
      if (on) sound.check();
      haptic();
      return;
    }
    case 'later-open':
      S.ui.laterOpen = true;
      S.ui.laterDay = null;
      return render();
    case 'later-cancel':
      S.ui.laterOpen = false;
      return render();
    case 'later-day':
      S.ui.laterDay = Number(el.dataset.day);
      return render();
    case 'later-go': {
      const start = Number(el.dataset.day);
      if (!(await replanWeek(plan, start))) return;
      S.ui.laterOpen = false;
      S.ui.openDays = {};
      toast(start ? `Plan ab ${DAY_NAMES[start]} erstellt` : 'Plan für die ganze Woche erstellt', { icon: '📅', sub: 'Einkaufsliste nur für die restlichen Tage' });
      return render();
    }
    case 'replan-studi': {
      const p = S.plans[currentWeek()];
      if (!p || !(await replanWeek(p, p.days.find((d) => !d.away)?.day || 0))) return;
      toast(S.settings.studi ? 'Woche im Studi-Modus neu geplant' : 'Woche neu geplant', { icon: S.settings.studi ? '🎓' : '📅', sub: `Einkauf jetzt ${euro(S.plans[currentWeek()].cost)}` });
      return render();
    }
    case 'draft-start':
      nextDraft().start = Number(el.dataset.day);
      saveNext();
      return render();
    case 'sport-open':
      S.ui.sport = { week: plan.weekStart, day: Number(el.dataset.day), type: S.ui.lastSport || 'laufen', level: 1, min: 45 };
      return render();
    case 'sport-level':
      S.ui.sport.level = Number(el.dataset.val);
      return render();
    case 'sport-cancel':
      S.ui.sport = null;
      return render();
    case 'sport-add': {
      const f = S.ui.sport;
      if (!f || !(f.min > 0)) return toast('Bitte eine Dauer eintragen', { icon: '⏱️', kind: 'warn' });
      const kcal = sportKcal(f.type, f.level, f.min, currentKg());
      saveSport(plan, (sp) => (sp[f.day] ||= []).push({ type: f.type, level: f.level, min: f.min, kg: currentKg(), kcal }));
      S.ui.lastSport = f.type;
      S.ui.sport = null;
      sound.check();
      haptic();
      toast(`+${num(kcal)} kcal am ${DAY_NAMES[f.day]}`, { icon: sportById(f.type).icon, sub: 'Kalorienziel und Portionen angepasst' });
      return render();
    }
    case 'sport-del': {
      const d = Number(el.dataset.day);
      saveSport(plan, (sp) => {
        sp[d].splice(Number(el.dataset.i), 1);
        if (!sp[d].length) delete sp[d];
      });
      return render();
    }
    case 'rfilter-all':
      S.ui.rTime = 'all';
      S.ui.rSel = {};
      return render();
    case 'rfilter-time':
      // nochmal antippen hebt den Zeitfilter wieder auf
      S.ui.rTime = S.ui.rTime === el.dataset.val ? 'all' : el.dataset.val;
      return render();
    case 'rfilter-cat': {
      // je Gruppe eine Auswahl; nochmal antippen hebt sie auf
      const sel = (S.ui.rSel ||= {});
      const g = el.dataset.group;
      if (sel[g] === el.dataset.val) delete sel[g];
      else sel[g] = el.dataset.val;
      return render();
    }
    case 'rcat-toggle': {
      const { id, val } = el.dataset;
      const has = catsOf(id).includes(val);
      const manual = S.cats.map[id] || [];
      const off = S.cats.off?.[id] || [];
      if (has) {
        S.cats.map[id] = manual.filter((n) => n !== val);
        // automatische Kategorie abwählen
        if (autoCats(recipe(id)).includes(val)) (S.cats.off ||= {})[id] = [...new Set([...off, val])];
      } else if (off.includes(val)) S.cats.off[id] = off.filter((n) => n !== val);
      else S.cats.map[id] = [...manual, val];
      if (!S.cats.map[id]?.length) delete S.cats.map[id];
      if (S.cats.off && !S.cats.off[id]?.length) delete S.cats.off[id];
      saveCats();
      const on = !has;
      el.classList.toggle('on', on);
      el.textContent = (on ? '✓ ' : '') + val;
      if (val === 'Favoriten') syncFav(id);
      return;
    }
    case 'fav-toggle': {
      const { id } = el.dataset;
      const on = !isFav(id);
      const manual = (S.cats.map[id] || []).filter((n) => n !== 'Favoriten');
      S.cats.map[id] = on ? [...manual, 'Favoriten'] : manual;
      if (!S.cats.map[id].length) delete S.cats.map[id];
      saveCats();
      syncFav(id);
      haptic();
      if (on) {
        sound.check();
        el.classList.remove('pop');
        void el.offsetWidth;
        el.classList.add('pop');
      } else sound.uncheck();
      return;
    }
    case 'toggle-quiet':
      S.ui.showQuiet = !S.ui.showQuiet;
      return render();
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
      // „Kaffee & Kuchen“ und Snacks: aus der Sammlung tauschen
      if (S.settings.aiKey && !isCake(findMeal(plan, key)) && !/-snack/.test(key)) {
        busy('Mise erfindet ein neues Rezept …');
        try {
          chosen = (await aiRecipe({ type })).id;
        } catch (err) {
          toast('Das hat nicht geklappt', { icon: '⚠️', sub: err.message, kind: 'warn' });
        } finally {
          busy(null);
        }
      }
      const next = swapMeal(plan, key, plannerInput({ weekStart: plan.weekStart }), chosen);
      next.done = plan.done || {};
      S.plans[plan.weekStart] = next;
      savePlans();
      toast(chosen ? 'Neues Rezept eingeplant' : 'Gericht getauscht', { icon: chosen ? '✨' : '🔄', sub: 'Einkaufsliste ist aktualisiert' });
      haptic();
      fx(`.meal[data-key="${key}"]`, 'swapped');
      return render();
    }
    case 'choose': {
      const next = swapMeal(plan, el.dataset.key, plannerInput({ weekStart: plan.weekStart }), el.dataset.id);
      next.done = plan.done || {};
      S.plans[plan.weekStart] = next;
      savePlans();
      S.ui.search = '';
      haptic();
      fx(`.meal[data-key="${el.dataset.key}"]`, 'swapped');
      location.hash = '#/woche';
      toast('Rezept übernommen', { icon: '🔄', sub: 'Einkaufsliste ist aktualisiert' });
      return;
    }
    case 'ob-set':
      profDraft()[el.dataset.field] = el.dataset.val;
      return render();
    case 'ob-step': {
      const p = profDraft();
      const to = Number(el.dataset.step);
      const cur = store.get('welcomed') ? Number(route().args[0]) || 1 : S.ui.ob || 0;
      // Angaben prüfen, bevor es weitergeht
      if (cur === 1 && to === 2) {
        if (!p.sex) return toast('Bitte Mann oder Frau wählen', { icon: '👤', kind: 'warn' });
        const ok = (v, lo, hi) => Number(v) >= lo && Number(v) <= hi;
        if (!ok(p.age, 14, 100) || !ok(p.height, 120, 230) || !ok(p.weight, 35, 250)) return toast('Bitte Alter, Größe und Gewicht eintragen', { icon: '✏️', kind: 'warn' });
      }
      if (cur === 2 && to === 3) {
        S.settings.goals = calcGoals(p);
        S.settings.profile = { ...p };
        S.settings.bodyWeight = Number(p.weight);
        S.settings.bodyWeightAt = new Date().toISOString();
        const gw = parseKg(p.goalWeight);
        if (gw) S.settings.goalWeight = gw;
        saveSettings();
      }
      haptic();
      if (store.get('welcomed')) location.hash = `#/start/${to}`;
      else {
        S.ui.ob = to;
        render();
        window.scrollTo(0, 0);
      }
      return;
    }
    case 'ob-done':
      refitCurrent();
      toast('Tagesziele übernommen', { icon: '🎯', sub: 'Dein Wochenplan ist angepasst' });
      location.hash = '#/einstellungen';
      return;
    case 'share-invite': {
      const url = `${location.origin}${location.pathname}#/einladung/${encodeURIComponent(S.settings.shareToken)}`;
      try {
        if (navigator.share) await navigator.share({ title: 'Mise', text: 'Öffne den Link auf deinem iPhone (in Mise bzw. Safari), dann teilt Mise neue Rezepte mit allen:', url });
        else {
          await navigator.clipboard.writeText(url);
          toast('Link kopiert', { icon: '📋' });
        }
      } catch {
        /* abgebrochen */
      }
      return;
    }
    case 'reset-app': {
      if (!(await confirmBox('Mise zurücksetzen?', 'Pläne, Einkaufslisten, Rückblick, eigene Rezepte und Einstellungen werden auf diesem Gerät gelöscht.', 'Weiter'))) return;
      if (!(await confirmBox('Ganz sicher?', 'Tipp: Vorher unter „Datensicherung“ sichern. Danach startet die Einführung neu.', 'Zurücksetzen'))) return;
      for (const k of store.keys()) store.del(k);
      location.hash = '#/woche';
      location.reload();
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
      toast('Dein Wochenplan ist fertig!', { icon: '🍽️' });
      return;
    case 'new-recipe': {
      const type = el.dataset.type;
      const title = (S.ui.newTitle[type] || '').trim();
      if (!title) return toast('Bitte zuerst einen Titel eintragen', { icon: '✏️', kind: 'warn' });
      S.ui.newTitle[type] = '';
      if (S.settings.aiKey) {
        busy(`Mise erfindet „${title}“ …`);
        try {
          const r = await aiRecipe({ title, type });
          location.hash = `#/rezept/${r.id}`;
        } catch (err) {
          toast('Das hat nicht geklappt', { icon: '⚠️', sub: err.message, kind: 'warn' });
        } finally {
          busy(null);
        }
        return;
      }
      S.ui.edit = { id: `u_${Date.now().toString(36)}`, name: title, type, time: 20, dishes: 1, effort: 1, mealPrep: false, tags: [], protein: '', ingredients: [], steps: [{ t: '' }], source: 'eigen' };
      location.hash = `#/bearbeiten/${S.ui.edit.id}`;
      return;
    }
    case 'ing-search': {
      const n = Number(el.dataset.n);
      const q = (document.querySelector(`[data-lookup-q="${n}"]`)?.value || '').trim();
      if (q.length < 2) return toast('Bitte einen Suchbegriff eintragen', { icon: '🔎', kind: 'warn' });
      if (S.ui.lookup?.n === n && S.ui.lookup.q === q && S.ui.lookup.loading) return;
      return runLookup(n, q);
    }
    case 'ing-pick': {
      const n = Number(el.dataset.n);
      const prod = S.ui.lookup?.results?.[Number(el.dataset.k)];
      const l = S.ui.edit?.ingredients[n];
      if (!prod || !l) return;
      applyProduct(l.id, prod);
      S.ui.lookup = null;
      haptic();
      toast('Nährwerte übernommen', { icon: '✓', sub: prod.name });
      return render();
    }
    case 'ing-scan': {
      const l = S.ui.edit?.ingredients[Number(el.dataset.n)];
      const prod = l && (await scanProduct());
      if (!prod) return;
      applyProduct(l.id, prod);
      S.ui.lookup = null;
      toast('Nährwerte übernommen', { icon: '📷', sub: prod.name });
      return render();
    }
    case 'ing-scan-new': {
      // Barcode scannen → neue Zeile mit dem Produkt
      const prod = await scanProduct();
      if (!prod || !S.ui.edit) return;
      const id = 'x_' + (prod.code ? 'ean' + prod.code : slugify(prod.name));
      if (!S.customIng.some((x) => x.id === id)) {
        S.customIng.push({ id, name: prod.name, cat: prod.cat, custom: true });
        saveCustomIng();
      }
      S.customIng.find((x) => x.id === id).needsData = false;
      applyProduct(id, prod);
      S.ui.edit.ingredients.push({ id, g: 100 });
      toast('Zutat hinzugefügt', { icon: '📷', sub: prod.name });
      return render();
    }
    case 'edit-add-ing':
      S.ui.edit.ingredients.push({ id: '', g: 100 });
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
      if (!d.name.trim()) return toast('Bitte zuerst einen Titel eintragen', { icon: '✏️', kind: 'warn' });
      busy(`Mise erfindet „${d.name}“ …`);
      try {
        const r = await inventRecipe({ apiKey: S.settings.aiKey, title: d.name, type: d.type, ingredients: [...S.idx.values()], avoid: [], dislikes: S.settings.dislikes });
        S.ui.edit = { ...r, id: d.id, name: d.name, source: d.source === 'eigen' ? 'ki' : d.source };
      } catch (err) {
        toast('Das hat nicht geklappt', { icon: '⚠️', sub: err.message, kind: 'warn' });
      } finally {
        busy(null);
      }
      return render();
    }
    case 'edit-save': {
      const d = S.ui.edit;
      const r = cleanRecipe(d, d.type, S.ingData.items);
      if (!r.ingredients.length) return toast('Bitte mindestens eine Zutat eintragen', { icon: '✏️', kind: 'warn' });
      if (!r.steps.length) return toast('Bitte mindestens einen Schritt eintragen', { icon: '✏️', kind: 'warn' });
      r.source = d.source || 'eigen';
      // Neue Rezepte (nicht Änderungen an vorhandenen) gehen in die gemeinsame Sammlung
      const isNew = !recipe(r.id) || (S.custom.find((c) => c.id === r.id)?.shared && !S.builtin.some((b) => b.id === r.id));
      saveCustom(r);
      if (isNew) shareRecipe(r, false);
      S.ui.edit = null;
      location.hash = `#/rezept/${r.id}`;
      toast('Rezept gespeichert', { icon: '📖', sub: !isNew ? 'Änderungen gelten auf diesem Gerät' : S.settings.shareToken ? 'Erscheint in ein paar Minuten auf allen Geräten' : 'Nur auf diesem Gerät – Freigabe-Schlüssel fehlt' });
      return;
    }
    case 'edit-delete': {
      const id = S.ui.edit.id;
      const builtin = S.builtin.some((b) => b.id === id);
      if (!(await confirmBox(builtin ? 'Original wiederherstellen?' : 'Rezept löschen?', builtin ? 'Deine Änderungen an diesem Rezept werden verworfen.' : 'Das Rezept wird von diesem Gerät gelöscht.', builtin ? 'Wiederherstellen' : 'Löschen'))) return;
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
      timers.start(el.dataset.label, Number(el.dataset.sec), el.dataset.ctx, document.body.classList.contains('gourmet') ? 'gourmet' : document.body.classList.contains('fancy') ? 'fancy' : '');
      sound.timerStart();
      haptic();
      toast(`Timer läuft`, { icon: '⏱️', sub: el.dataset.label });
      return;
    case 't-toggle':
      return timers.toggle(el.dataset.id);
    case 't-del':
      return timers.remove(el.dataset.id);
    case 'cook-step':
      S.ui.cookStep = Math.max(0, S.ui.cookStep + Number(el.dataset.d));
      haptic();
      fx('.step-text', Number(el.dataset.d) > 0 ? 'step-next' : 'step-prev');
      return render();
    case 'snap-restore': {
      const day = document.getElementById('snap-pick')?.value;
      const snap = day && (await getSnapshot(day));
      if (!snap) return toast('Sicherung nicht gefunden', { icon: '⚠️', kind: 'warn' });
      if (!(await confirmBox('Sicherung wiederherstellen?', `Daten auf den Stand vom ${fmtDateTime(snap.savedAt)} zurücksetzen? Neuere Änderungen gehen verloren.`, 'Wiederherstellen'))) return;
      importAll(snap.data);
      toast('Sicherung wiederhergestellt', { icon: '💾' });
      setTimeout(() => location.reload(), 700);
      return;
    }
    case 'backup-later':
      store.set('exportSnooze', Date.now() + 2 * 864e5);
      return render();
    case 'cook-end':
      S.ui.cookActive = null;
      return render();
    case 'cook-done': {
      const fancyDone = document.body.classList.contains('fancy');
      S.ui.cookActive = null;
      (fancyDone ? sound.magicDone : sound.cookDone)();
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
    case 'people': {
      // Personen für eine Mahlzeit im Wochenplan: Einkaufsliste und Kochmengen rechnen mit
      const key = el.dataset.key;
      const n = Number(el.dataset.n);
      if (!plan?.structure || peopleOf(findMeal(plan, key)) === n) return;
      const people = { ...(plan.structure.people || {}) };
      if (n > 1) people[key] = n;
      else delete people[key];
      S.plans[plan.weekStart] = refitPlan({ ...plan, structure: { ...plan.structure, people } }, plannerInput({ weekStart: plan.weekStart }));
      savePlans();
      haptic();
      toast(n > 1 ? `Für ${n} Personen` : 'Nur für dich', { icon: '🛒', sub: 'Einkaufsliste ist angepasst' });
      return render();
    }
    case 'check': {
      if (ev.target.closest('a')) return; // Link zum Rezept nicht als Abhaken werten
      const ws = plan.weekStart;
      S.checks[ws] ||= {};
      const on = (S.checks[ws][el.dataset.id] = !S.checks[ws][el.dataset.id]);
      store.set('checks', S.checks);
      haptic();
      // Letzter Artikel abgehakt: kleiner Erfolgsmoment
      const items = plan.shopping.items.filter((i) => i.packs > 0);
      const allDone = on && items.length && items.every((i) => S.checks[ws][i.id]);
      if (allDone) {
        sound.allDone();
        hapticBurst(2);
        toast('Alles eingekauft!', { icon: '🛒', sub: 'Die Woche kann kommen.' });
      } else if (on) sound.check();
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
      haptic();
      fx(`[data-action="fb"][data-id="${id}"][data-field="${field}"][data-val="${val}"].on`);
      return render();
    }
    case 'rate': {
      // Antippen zählt hoch: 1, 2 … 6, danach wieder leer
      const { week, field } = el.dataset;
      updateFeedback(week, (fb) => {
        fb.week ||= {};
        const v = (fb.week[field] || 0) + 1;
        if (v > 6) delete fb.week[field];
        else fb.week[field] = v;
      });
      haptic();
      sound.check();
      fx(`[data-action="rate"][data-field="${field}"] .rate-ring`);
      return render();
    }
    case 'fbw':
      updateFeedback(el.dataset.week, (fb) => {
        fb.week ||= {};
        fb.week[el.dataset.field] = Number(el.dataset.val);
      });
      haptic();
      fx(`[data-action="fbw"][data-field="${el.dataset.field}"].on`);
      return render();
    case 'fix-carbs':
      S.settings.goals.carbs = Number(el.dataset.val);
      saveSettings();
      refitCurrent();
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
      if (await confirmBox('Einstellungen zurücksetzen?', 'Alle Einstellungen gehen auf Standard. Pläne und Feedback bleiben erhalten.', 'Zurücksetzen')) {
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
  if (S.ui.edit && el.dataset.editIng !== undefined && el.dataset.f === 'name') {
    const l = S.ui.edit.ingredients[Number(el.dataset.editIng)];
    const name = el.value.trim();
    if (!name) return;
    const res = resolveIngredient(name);
    l.id = res.id;
    // Unbekannt: gleich online nach passenden Produkten suchen
    if (res.search) return runLookup(Number(el.dataset.editIng), name);
    if (S.ui.lookup?.n === Number(el.dataset.editIng)) S.ui.lookup = null;
    return render();
  }
  if (el.dataset.lookupQ !== undefined) {
    // Enter in der Produktsuche startet die Suche
    const q = el.value.trim();
    if (q.length >= 2 && q !== S.ui.lookup?.q) runLookup(Number(el.dataset.lookupQ), q);
    return;
  }
  if (el.dataset.cing) {
    const i = S.customIng.find((x) => x.id === el.dataset.cing);
    const v = parseFloat(String(el.value).replace(',', '.'));
    if (i && Number.isFinite(v) && v >= 0) {
      i[el.dataset.f] = v;
      if (el.dataset.f === 'price') delete i.priceEst;
      delete i.needsData;
      i.source = i.source || 'eigene Werte';
      S.ui.ownOpen = i.id;
      saveCustomIng();
    }
    return;
  }
  if (S.ui.edit && (el.dataset.edit || el.dataset.editIng !== undefined || el.dataset.editStep !== undefined)) return editField(el);
  if (el.dataset.set) {
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number') v = Number(v);
    setPath(S.settings, el.dataset.set, v);
    if (!STORE_IDS.some((id) => S.settings.stores[id])) S.settings.stores.lidl = true;
    // Hauptladen ist immer auch ausgewählt
    if (el.dataset.set === 'mainStore') S.settings.stores[S.settings.mainStore] = true;
    if (!S.settings.stores[S.settings.mainStore]) S.settings.mainStore = STORE_IDS.find((id) => S.settings.stores[id]);
    saveSettings();
    if (/^(goals\.|stores\.|mainStore$)/.test(el.dataset.set)) refitCurrent();
    if (el.dataset.set === 'theme') applyTheme();
    if (el.dataset.set === 'shareToken') {
      S.settings.shareToken = String(S.settings.shareToken || '').trim();
      saveSettings();
      sendShares(true);
    }
    render();
    return;
  }
  if (el.dataset.sport && S.ui.sport) {
    // Dauer/Gewicht werden schon beim Tippen übernommen – kein Neuzeichnen, sonst geht der Tipp auf „Eintragen“ verloren
    if (el.dataset.sport === 'min' || el.dataset.sport === 'kg') return;
    S.ui.sport[el.dataset.sport] = el.value;
    return render();
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
        toast('Sicherung importiert', { icon: '📦' });
        setTimeout(() => location.reload(), 600);
      } catch (err) {
        toast('Import hat nicht geklappt', { icon: '⚠️', sub: err.message, kind: 'warn' });
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
  if ((el.dataset.sport === 'min' || el.dataset.sport === 'kg') && S.ui.sport) {
    // Vorschau live aktualisieren, ohne das Feld neu zu zeichnen
    if (el.dataset.sport === 'kg') {
      const kg = parseKg(el.value);
      if (kg >= 30 && kg <= 250) {
        S.settings.bodyWeight = kg;
        S.settings.bodyWeightAt = new Date().toISOString();
        saveSettings();
      }
    } else S.ui.sport.min = Number(el.value);
    const b = document.querySelector('.sport-kcal b');
    if (b) b.textContent = `+${num(sportKcal(S.ui.sport.type, S.ui.sport.level, S.ui.sport.min, currentKg()))} kcal`;
    return;
  }
  if (el.dataset.ob) {
    profDraft()[el.dataset.ob] = el.value.replace(',', '.').trim();
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
    if (el.dataset.f === 'name') return; // wird bei „change“ aufgelöst (bekannte oder eigene Zutat)
    l[el.dataset.f] = el.dataset.f === 'g' ? Number(el.value) : el.value;
  } else if (el.dataset.editStep !== undefined) {
    const st = d.steps[Number(el.dataset.editStep)];
    if (el.dataset.f === 'timer') {
      const min = Number(String(el.value).replace(',', '.'));
      if (min > 0) st.timer = Math.round(min * 60);
      else delete st.timer;
    } else if (el.dataset.f === 'tools') {
      // Geschirr je Schritt; sobald irgendwo eingetragen, gilt die Angabe für das ganze Rezept
      for (const [i, t] of stepTools(d).entries()) if (!Array.isArray(d.steps[i].tools)) d.steps[i].tools = t;
      st.tools = el.value.split(',').map((x) => x.trim()).filter(Boolean);
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
      store.set('lastExport', new Date().toISOString());
      return render();
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
  store.set('lastExport', new Date().toISOString());
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Kochmodus beginnt bei Schritt 1; Rezeptansicht startet mit 1 Portion
window.addEventListener('hashchange', (ev) => {
  // Woher kam man ins Rezept? (Zurück führt dann z. B. wieder zur Einkaufsliste)
  const from = (ev.oldURL || '').split('#/')[1]?.split('/')[0] || '';
  if (location.hash.startsWith('#/rezept/') && !['rezept', 'kochen', 'bearbeiten'].includes(from)) S.ui.recipeFrom = from;
  if (location.hash.startsWith('#/kochen') && decodeURIComponent(location.hash.slice(9)) !== S.ui.cookActive) S.ui.cookStep = 0;
  if (location.hash.startsWith('#/mahlzeit/') && from !== 'kochen') S.ui.servings = 1;
  if (location.hash.startsWith('#/rezept/')) S.ui.servings = S.ui.servings || 1;
  if (location.hash.startsWith('#/rezepte')) S.ui.servings = 1;
  if (location.hash.startsWith('#/waehlen')) S.ui.search = '';
});

init();
