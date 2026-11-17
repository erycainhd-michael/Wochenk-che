#!/usr/bin/env node
// Prüft jedes Rezept auf Fehler, die man erst beim Kochen merkt, und auf Geschmack.
//   node scripts/audit-recipes.mjs            → alle Befunde
//   node scripts/audit-recipes.mjs --summary  → nur Zahlen
// Fehler: Zutat wird in keinem Schritt verwendet, Zeitangabe kürzer als die Timer, Werte unplausibel.
// Geschmack („Gusto“): Salz/Würze, Säure, Aroma (Knoblauch, Zwiebel, Kräuter, Gewürze), Umami, Biss.
import fs from 'node:fs';
import { buildIndex, recipeMacros } from '../js/nutrition.js';
import { recipeMatches, stepTerms } from '../js/steps.js';
import { spiceNames } from '../js/shopping.js';

const ing = JSON.parse(fs.readFileSync('data/ingredients.json', 'utf8'));
const recipes = JSON.parse(fs.readFileSync('data/recipes.json', 'utf8')).recipes;
const idx = buildIndex(ing);
const summary = process.argv.includes('--summary');

const has = (r, re) => re.test(allText(r));
const allText = (r) =>
  [r.name, ...r.steps.map((s) => s.t), r.tip, ...r.ingredients.map((l) => `${idx.get(l.id)?.name || l.id} ${l.note || ''}`)].join(' ').toLowerCase();

// Geschmacks-Bausteine (Wörter in Zutaten, Notizen oder Schritten)
const FLAVOR = {
  salz: /\bsalz|räucher|muschel|sojasauce|fischsauce|miso|brühe|bruehe|feta|parmesan|pecorino|speck|schinken|kapern|oliven|sardellen|teriyaki|pesto|gewürzgurke|sauerkraut|halloumi/,
  saeure: /zitrone|weißwein|weisswein|rotwein|limette|essig|balsamico|weißwein|weisswein|joghurt|skyr|quark|crème fraîche|creme fraiche|schmand|saure sahne|tomate|kapern|gewürzgurke|sauerkraut|kimchi|senf|apfel|orange|beeren|granatapfel|preiselbeer|mango|ananas|frischkäse|buttermilch|kefir|ricotta/,
  aroma: /knoblauch|zwiebel|schalotte|ingwer|frühlingszwiebel|porree|lauch|chili|curry|kreuzkümmel|kumin|paprika|zimt|vanille|kräuter|petersilie|basilikum|koriander|schnittlauch|dill|minze|rosmarin|thymian|oregano|salbei|majoran|muskat|garam|ras el|za.?atar|pfeffer|harissa|sesam|kakao|pesto|gyros|senf|lorbeer|kardamom|nelke|piment|tikka|kurkuma|sumach|chipotle|cajun|taco/,
  umami: /parmesan|pecorino|tomatenmark|sojasauce|miso|pilz|champignon|speck|schinken|sardellen|anchovis|fischsauce|teriyaki|brühe|bruehe|käse|kaese|gouda|cheddar|bergkäse|gruyère|gruyere|tomate|ei\b|eier|hack|rind|hähnchen|lachs|thunfisch|garnelen|fisch|erdnuss|tahin|nüsse|walnuss|oliven|röst/,
  biss: /nüsse|nuss|mandel|walnuss|cashew|erdnüsse|pinien|kerne|sesam|samen|knusprig|kross|croûton|crouton|röst|rucola|gurke|paprika|radieschen|frühlingszwiebel|salat|apfel|granola|crunch|knäcke|toast|brot|zwieback|nachos|chips|kruste|gratin|überbacken|anbraten|braten/,
};
const SWEET = (r) => r.type === 'breakfast' && /süß|porridge|pfannkuchen|müsli|muesli|overnight|grieß|griess|joghurt|skyr|quark|bowl/.test(allText(r)) && !/ei\b|eier|rührei|spiegelei|omelett|toast|brot|wrap|frittata|hash/.test(allText(r));

const findings = [];
const add = (r, kind, msg) => findings.push({ id: r.id, name: r.name, src: r.source || (r.tags.includes('familie') ? 'mappe' : 'claude'), kind, msg });

for (const r of recipes) {
  const items = r.ingredients.filter((l) => l.id !== 'gewuerze');
  // 1. Zutat in keinem Schritt erwähnt → beim Kochen vergessen
  const terms = stepTerms(items, (id) => idx.get(id));
  const hits = recipeMatches(r.steps.map((s) => s.t), terms, r.steps.map((s) => s.amt));
  const used = new Set(hits.flat().map((h) => h.idx));
  const ready = r.tags.includes('fertiggericht') && items.length === 1;
  for (const t of terms) if (!used.has(t.idx) && !ready) add(r, 'fehler', `Zutat „${idx.get(t.id)?.name || t.id}“ kommt in keinem Schritt vor`);
  // Gewürze-Notiz: jedes Gewürz sollte irgendwo im Text auftauchen (Salz/Pfeffer gelten über „würzen/abschmecken“)
  const sp = r.ingredients.find((l) => l.id === 'gewuerze');
  if (sp) {
    const st = r.steps.map((s) => s.t).join(' ').toLowerCase();
    const generic = /würz|abschmeck|gewürz/.test(st);
    const missing = spiceNames(sp.note).filter((n) => !st.includes(n.toLowerCase().split(/[\s-]/)[0].slice(0, 5)) && !(generic && /^(salz|pfeffer)/i.test(n)));
    if (missing.length) add(r, 'fehler', `Gewürz ${missing.join(', ')} steht in keinem Schritt`);
  }
  // 2. Zeit: Summe der Timer (parallel laufende nicht doppelt – grob: größter Timer + die Hälfte der anderen)
  const timers = r.steps.filter((s) => !/kalt stellen|vortag|über nacht|tiefkühl|ziehen lassen/i.test(s.t)).map((s) => s.timer || 0).filter(Boolean).sort((a, b) => b - a);
  const minT = timers.length ? Math.round((timers[0] + timers.slice(1).reduce((a, b) => a + b, 0) * 0.5) / 60) : 0;
  if (!['extra', 'addon'].includes(r.type) && minT > r.time * 1.15 + 2) add(r, 'zeit', `Angabe ${r.time} Min., die Timer allein ergeben ca. ${minT} Min.`);
  // 3. Leere oder sehr kurze Schritte, Schritte ohne Verb
  r.steps.forEach((s, n) => { if (!s.t || s.t.trim().length < 8) add(r, 'fehler', `Schritt ${n + 1} ist leer oder zu kurz`); });
  if (r.steps.length < 2 && !['extra', 'addon'].includes(r.type) && !r.tags.includes('fertiggericht')) add(r, 'fehler', 'nur ein Schritt');
  // 4. Werte
  const m = recipeMacros(r, idx, {}, 1);
  if (r.type === 'main' && !r.tags.includes('eiweissarm') && (m.kcal < 350 || m.kcal > 1300)) add(r, 'werte', `${Math.round(m.kcal)} kcal pro Portion`);
  // 5. Geschmack – nur für Gerichte, nicht für Beilagen/Dressings/Fertiggerichte
  if (['main', 'breakfast'].includes(r.type) && !r.tags.includes('fertiggericht')) {
    const miss = Object.keys(FLAVOR).filter((k) => !has(r, FLAVOR[k]));
    const sweet = SWEET(r) || r.tags.includes('süß');
    const relevant = miss.filter((k) => !(sweet && (k === 'salz' || k === 'umami')));
    const hard = relevant.filter((k) => k !== 'biss');
    if (hard.length) add(r, 'gusto', `fehlt: ${hard.join(', ')}`);
    else if (relevant.includes('biss') && !summary) add(r, 'hinweis', 'nichts Knuspriges/Frisches (optional)');
    if (!sweet && !sp && !/salz|würz|abschmeck|sojasauce|brühe|feta|parmesan|speck|schinken|kapern|pesto/i.test(allText(r))) add(r, 'gusto', 'nirgends gesalzen oder abgeschmeckt');
  }
}

const by = (k) => findings.filter((f) => f.kind === k);
if (!summary) {
  for (const k of ['fehler', 'zeit', 'werte', 'gusto', 'hinweis']) {
    const list = by(k);
    if (!list.length) continue;
    console.log(`\n## ${k} (${list.length})`);
    for (const f of list) console.log(`- [${f.src}] ${f.id}: ${f.msg}`);
  }
}
console.log(`\n${recipes.length} Rezepte geprüft · Fehler ${by('fehler').length} · Zeit ${by('zeit').length} · Werte ${by('werte').length} · Geschmack ${by('gusto').length}`);
if (process.argv.includes('--strict') && by('fehler').length) process.exit(1);
