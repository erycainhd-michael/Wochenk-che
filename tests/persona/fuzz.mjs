import fs from 'node:fs';
const R = new URL('../../', import.meta.url).pathname;
const { buildIndex } = await import(R + 'js/nutrition.js');
const { generatePlan } = await import(R + 'js/planner.js');
const { DEFAULT_SETTINGS, calcGoals } = await import(R + 'js/settings.js');
const idx = buildIndex(JSON.parse(fs.readFileSync(R + 'data/ingredients.json', 'utf8')));
const recipes = JSON.parse(fs.readFileSync(R + 'data/recipes.json', 'utf8')).recipes;
const N = Number(process.argv[2] || 300);
let s = 4242; const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(r() * a.length)];
const DIS = ['Pilze', 'Koriander', 'Lachs', 'Thunfisch', 'Hähnchen', 'Schwein', 'Rind', 'Feta', 'Tofu', 'Linsen', 'Kichererbsen', 'Spinat', 'Paprika', 'Zwiebel', 'Knoblauch', 'Brokkoli', 'Quark', 'Reis', 'Nudeln', 'Kartoffel', 'Ei'];
const fails = {}; const add = (k, v) => ((fails[k] ||= []).length < 6 && fails[k].push(v), (fails[k].n = (fails[k].n || 0) + 1));
const badNum = (o) => (typeof o === 'number' ? !Number.isFinite(o) : o && typeof o === 'object' ? Object.values(o).some(badNum) : false);
let t = Date.now();
for (let i = 0; i < N; i++) {
  const prof = { sex: pick(['m', 'w']), age: 18 + Math.floor(r() * 60), height: 150 + Math.floor(r() * 45), weight: 45 + Math.floor(r() * 80), activity: pick(['wenig', 'mittel', 'viel']), goal: pick(['abnehmen', 'halten', 'aufbauen']) };
  const st = { ...structuredClone(DEFAULT_SETTINGS), profile: prof, goals: calcGoals(prof), budget: 20 + Math.floor(r() * 130), studi: r() < 0.2, shopTwice: r() < 0.3, complexPerWeek: Math.floor(r() * 4),
    dislikes: Array.from({ length: Math.floor(r() * 4) }, () => pick(DIS)), eatOut: [0, 1, 2, 3, 4, 5, 6].filter(() => r() < 0.2).map((day) => ({ day, slot: 'abend' })),
    readyMeals: { meals: r() < 0.5, pizza: r() < 0.5, soup: r() < 0.5 }, sliders: { simple: Math.floor(r() * 100), dishes: Math.floor(r() * 100), offers: Math.floor(r() * 100), variety: Math.floor(r() * 100) } };
  const away = [0, 1, 2, 3, 4, 5, 6].filter(() => r() < 0.12);
  const ws = pick(['2026-11-16', '2026-12-28', '2027-03-29', '2027-06-14']);
  const tag = `#${i} ${prof.sex}${prof.age} ${prof.weight}kg ${prof.goal} ${st.budget}€ dis=${st.dislikes.join('/')} away=${away} eat=${st.eatOut.map((e) => e.day)} ${ws}`;
  let p;
  try { p = generatePlan({ recipes, idx, settings: st, weekStart: ws, seed: i, candidates: 8, away }); } catch (e) { add('Absturz', tag + ' → ' + e.message); continue; }
  if (badNum(p.days) || badNum(p.shopping) || !Number.isFinite(p.cost)) add('NaN/Infinity im Plan', tag);
  const days = p.days.filter((d) => !d.away);
  if (days.length !== 7 - away.length) add('Tage fehlen', tag);
  for (const d of days) {
    const bf = d.meals.find((m) => m.slot === 'fruehstueck');
    if (!bf) add('Tag ohne Frühstück', `${tag} Tag ${d.day}`);
    for (const sl of ['mittag', 'abend']) if (!d.meals.some((m) => m.slot === sl)) add(`Tag ohne ${sl}`, `${tag} Tag ${d.day}`);
  }
  const off = days.filter((d) => Math.abs(d.totals.kcal - d.goalKcal) / d.goalKcal > 0.1).length;
  if (off >= 2) add('≥2 Tage >10 % neben dem Kalorienziel', `${tag} (${off} Tage, Ziel ${st.goals.kcal}, z. B. ${Math.round(days.find((d) => Math.abs(d.totals.kcal - d.goalKcal) / d.goalKcal > 0.1).totals.kcal)})`);
  const pr = days.reduce((a, d) => a + d.totals.p, 0) / days.length / st.goals.protein;
  if (pr < 0.85) add('Protein < 85 % des Ziels', `${tag} (${Math.round(pr * 100)} %)`);
  for (const d of days) for (const m of d.meals) {
    if (m.kind !== 'recipe') continue;
    const rec = recipes.find((x) => x.id === m.recipeId);
    const texts = [rec.name, ...(m.items || []).map((x) => idx.get(x.id)?.name || '')].map((x) => x.toLowerCase());
    for (const dl of st.dislikes) if (texts.some((x) => x.includes(dl.toLowerCase()))) add('Abneigung trotzdem im Plan', `${tag} → ${rec.name} (${dl})`);
  }
  for (const it of p.shopping.items) { const ing = idx.get(it.id); if (it.trip !== 2 && it.have + it.packs * ing.pack < it.need - 0.06 * ing.pack - 1) add('Einkauf reicht nicht', `${tag} ${it.id}`); }
  if (p.cost > st.budget * 1.25 && !p.budgetInfo) add('Budget >25 % überschritten ohne Hinweis', `${tag} ${p.cost.toFixed(0)}€`);
  if (p.cost > st.budget * 1.5) add('Budget >50 % überschritten', `${tag} ${p.cost.toFixed(0)}€`);
}
console.log(`${N} Pläne in ${Math.round((Date.now() - t) / 1000)} s`);
for (const [k, v] of Object.entries(fails)) console.log(`\n${k}: ${v.n}×\n  ` + v.join('\n  '));
fs.writeFileSync(new URL('./fuzz.json', import.meta.url), JSON.stringify(Object.fromEntries(Object.entries(fails).map(([k, v]) => [k, { n: v.n, ex: [...v] }])), null, 1));
