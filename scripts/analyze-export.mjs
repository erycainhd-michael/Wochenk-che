#!/usr/bin/env node
// Wertet Mise-Sicherungen (.json aus Einstellungen → Datensicherung → Sichern) aus – eine oder viele Testpersonen.
//
//   node scripts/analyze-export.mjs sicherung1.json sicherung2.json …
//   node scripts/analyze-export.mjs ordner-mit-sicherungen/
//
// Liefert je Person und als Summe: aktive Tage, wie weit der Plan genutzt wurde (gekocht, abgehakt, getauscht),
// welche Bereiche nie geöffnet wurden, „Gefällt mir nicht“, Fehlerprotokoll. Nur lokale Auswertung –
// die Dateien enthalten Gesundheitsangaben: nicht hochladen, nach der Auswertung löschen.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (!args.length) {
  console.log('Aufruf: node scripts/analyze-export.mjs <sicherung.json | ordner> …');
  process.exit(1);
}
const files = args.flatMap((a) => (fs.statSync(a).isDirectory() ? fs.readdirSync(a).filter((f) => f.endsWith('.json')).map((f) => path.join(a, f)) : [a]));

// Bereiche der App, die es zu entdecken gibt (Seiten-Namen wie im Nutzungszähler)
const AREAS = {
  woche: 'Wochenplan',
  mahlzeit: 'Mahlzeit / Rezept aus dem Plan',
  kochen: 'Kochmodus',
  einkauf: 'Einkaufsliste',
  rezepte: 'Rezeptsammlung',
  rueckblick: 'Rückblick',
  einstellungen: 'Einstellungen',
};
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)} %` : '–');

const people = [];
for (const f of files) {
  let obj;
  try {
    obj = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    console.warn(`übersprungen (kein JSON): ${f}`);
    continue;
  }
  const d = obj.data || {};
  const plans = Object.values(d.plans || {});
  const meals = plans.flatMap((p) => p.days.flatMap((day) => day.meals.filter((m) => m.kind === 'recipe' && m.slot !== 'snack')));
  const doneMarks = plans.reduce((a, p) => a + Object.values(p.done || {}).filter(Boolean).length, 0);
  const checks = Object.values(d.checks || {});
  const checked = checks.reduce((a, c) => a + Object.values(c).filter(Boolean).length, 0);
  const usage = d.usage || { days: [], routes: {}, actions: {} };
  const routes = usage.routes || {};
  const actions = usage.actions || {};
  const dislikes = (d.feedback || []).flatMap((fb) => Object.entries(fb.recipes || {}).filter(([, r]) => r.rating === -1).map(([id]) => id));
  const weights = (d.feedback || []).filter((fb) => fb.week?.weight > 0).map((fb) => [fb.weekStart, fb.week.weight]).sort();
  people.push({
    file: path.basename(f),
    since: usage.since?.slice(0, 10) || '–',
    activeDays: (usage.days || []).length,
    weeks: plans.length,
    meals: meals.length,
    cookedMarks: (d.cooked || []).length + doneMarks,
    checked,
    swaps: (actions.swap || 0) + (actions.choose || 0),
    neverOpened: Object.keys(AREAS).filter((k) => !routes[k] && !Object.keys(routes).some((r) => r.startsWith(k + '/'))),
    settingsPages: Object.keys(routes).filter((r) => r.startsWith('einstellungen/')),
    quickstart: !!d.settings?.quickstart && !d.settings?.profile?.height,
    weighIns: weights.length,
    weightChange: weights.length > 1 ? Math.round((weights.at(-1)[1] - weights[0][1]) * 10) / 10 : null,
    dislikes,
    errors: d.errlog || [],
    topActions: Object.entries(actions).sort((a, b) => b[1] - a[1]).slice(0, 8),
  });
}

for (const p of people) {
  console.log(`\n=== ${p.file} (Zähler seit ${p.since})`);
  console.log(`Aktive Tage: ${p.activeDays} · Wochenpläne: ${p.weeks} · Hauptmahlzeiten geplant: ${p.meals}`);
  console.log(`Als gekocht markiert: ${p.cookedMarks} (${pct(p.cookedMarks, p.meals)} der Hauptmahlzeiten) · Einkauf abgehakt: ${p.checked} · getauscht: ${p.swaps}`);
  console.log(`Nie geöffnet: ${p.neverOpened.map((k) => AREAS[k]).join(', ') || '– (alles genutzt)'}`);
  console.log(`Einstellungen besucht: ${p.settingsPages.map((r) => r.split('/')[1]).join(', ') || '–'}`);
  console.log(`Schnellstart ohne Profil: ${p.quickstart ? 'ja (nie zugeschnitten)' : 'nein'} · Wochen-Checks: ${p.weighIns}${p.weightChange != null ? ` · Veränderung ${p.weightChange > 0 ? '+' : ''}${p.weightChange} kg` : ''}`);
  console.log(`„Gefällt mir nicht“: ${p.dislikes.join(', ') || '–'}`);
  console.log(`Häufigste Aktionen: ${p.topActions.map(([a, n]) => `${a} ${n}×`).join(', ') || '–'}`);
  if (p.errors.length) {
    console.log(`Fehler (${p.errors.length}):`);
    for (const er of p.errors.slice(-5)) console.log(`  ${er.at.slice(0, 16)} ${er.route} – ${er.msg} (${er.where})`);
  }
}

if (people.length > 1) {
  const n = people.length;
  const sum = (k) => people.reduce((a, p) => a + p[k], 0);
  console.log(`\n=== Summe über ${n} Personen`);
  console.log(`Ø aktive Tage: ${(sum('activeDays') / n).toFixed(1)} · Ø gekocht-Quote: ${pct(sum('cookedMarks'), sum('meals'))} · Ø Tauschvorgänge: ${(sum('swaps') / n).toFixed(1)}`);
  const never = {};
  for (const p of people) for (const k of p.neverOpened) never[k] = (never[k] || 0) + 1;
  console.log(`Nie geöffnet (Anzahl Personen): ${Object.entries(never).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${AREAS[k]} ${c}/${n}`).join(', ') || '–'}`);
  const dis = {};
  for (const p of people) for (const id of p.dislikes) dis[id] = (dis[id] || 0) + 1;
  console.log(`Am häufigsten „Gefällt mir nicht“: ${Object.entries(dis).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, c]) => `${id} (${c})`).join(', ') || '–'}`);
  console.log(`Personen mit Fehlern: ${people.filter((p) => p.errors.length).length}/${n}`);
}
