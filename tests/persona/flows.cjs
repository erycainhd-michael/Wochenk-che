// Browser-Abläufe je Persona: Einführung (echte Eingaben), erster Plan auf gedrosselter CPU, Kernaufgaben, Fehler/NaN
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const SP = process.argv[2];
(async () => {
  const { PERSONAS } = await import(SP + '/personas.mjs');
  const b = await chromium.launch();
  const results = [];
  for (const P of PERSONAS) {
    const ctx = await b.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    const errs = []; const cons = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => m.type() === 'error' && cons.push(m.text().slice(0, 120)));
    const toasts = [];
    await page.exposeFunction('__toast', (t) => toasts.push(t));
    await page.addInitScript(() => { new MutationObserver(() => document.querySelectorAll('.toast').forEach((t) => { if (!t.__seen) { t.__seen = 1; window.__toast(t.innerText.replace(/\n/g, ' ')); } })).observe(document, { childList: true, subtree: true }); });
    await page.clock.install({ time: new Date('2026-11-16T09:30:00+01:00') });
    if (P.textScale) await page.addInitScript((s) => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = 16 * s + 'px'; document.documentElement.classList.add('large-text'); }); }, P.textScale);
    await page.goto('http://localhost:8765/'); await page.waitForTimeout(3000); await page.clock.runFor(4000);
    const R = { id: P.id, steps: [] };
    const waitSel = async (sel) => { for (let i = 0; i < 60; i++) { if (await page.$(sel)) return true; await page.clock.runFor(300); await page.waitForTimeout(150); } return false; };
    await waitSel('[data-set=name]');
    const note = (s) => R.steps.push(s);
    // Schritt 0: Name
    await page.fill('[data-set=name]', P.name.split(/[ ,]/)[0]).catch(() => note('Namensfeld fehlt'));
    await page.dispatchEvent('[data-set=name]', 'change'); await page.waitForTimeout(300);
    if (!(await page.$('[data-field=sex]'))) await page.click('.ob-nav .btn.primary'); await page.waitForTimeout(400);
    await waitSel('[data-field=sex]');
    // Schritt 1: über dich
    await page.click(`[data-action=ob-set][data-field=sex][data-val=${P.sex}]`);
    for (const [f, v] of [['age', P.age], ['height', P.height], ['weight', String(P.weight).replace('.', ',')]]) { await page.fill(`[data-ob=${f}]`, String(v)); await page.dispatchEvent(`[data-ob=${f}]`, 'change'); }
    await page.click('.ob-nav .btn.primary'); await page.waitForTimeout(500);
    const step1Blocked = await page.$(`[data-ob=age]`);
    note(step1Blocked ? `Schritt 1 blockiert: ${toasts.at(-1)}` : 'Schritt 1 ok');
    if (step1Blocked) { results.push(R); await ctx.close(); continue; }
    // Schritt 2: Aktivität & Ziel
    await page.click(`[data-action=ob-set][data-field=activity][data-val=${P.activity}]`);
    await page.click(`[data-action=ob-set][data-field=goal][data-val=${P.goal}]`, { force: true });
    if (P.goalWeight) { await page.fill('[data-ob=goalWeight]', String(P.goalWeight)).catch(() => {}); await page.dispatchEvent('[data-ob=goalWeight]', 'change').catch(() => {}); }
    const txt2 = await page.evaluate(() => document.body.innerText);
    await page.click('.ob-nav .btn.primary'); await page.waitForTimeout(500);
    // Schritt 3: Ziele
    const goals = await page.$$eval('.ob input[data-set^="goals."]', (x) => x.map((i) => i.dataset.set.split('.')[1] + '=' + i.value).join(' '));
    const txt3 = await page.evaluate(() => document.body.innerText);
    R.goals = goals;
    R.warnings = /untergewicht|essstörung|ärzt|minderjährig|jugendlich|schwanger|vorsicht|hinweis/i.test(txt2 + txt3) ? 'Warnung sichtbar' : 'keine Warnung';
    if (P.proteinOverride) { await page.fill('[data-set="goals.protein"]', String(P.proteinOverride)); await page.dispatchEvent('[data-set="goals.protein"]', 'change'); }
    await page.click('.ob-nav .btn.primary'); await page.waitForTimeout(400);
    // Schritt 4: Budget, Laden, Auswärts
    const hasAllergyStep = /allergi|unverträglich|vegan|vegetar|abneigung/i.test(await page.evaluate(() => document.body.innerText));
    R.allergyInOnboarding = hasAllergyStep;
    await page.fill('[data-set=budget]', String(P.budget)); await page.dispatchEvent('[data-set=budget]', 'change');
    for (const d of P.eatOut || []) { await page.click(`[data-action=eatout-day][data-day="${d}"]`); await page.waitForTimeout(150); }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const t0 = Date.now();
    await page.click('[data-action=first-plan]');
    for (let i = 0; i < 60; i++) { await page.clock.runFor(500); await page.waitForTimeout(200); if (await page.$('.card.hero')) break; }
    R.firstPlanMs = Date.now() - t0;
    const body = await page.evaluate(() => document.body.innerText);
    R.nanInText = (body.match(/NaN|undefined|Infinity|\[object/g) || []).length;
    R.hero = (body.match(/Ø PRO TAG[\s\S]{0,120}/) || [''])[0].replace(/\n/g, ' ');
    // Kernaufgaben
    const go = async (h) => { await page.evaluate((h) => { location.hash = h; }, h); await page.waitForTimeout(700); await page.clock.runFor(300); };
    await go('#/einkauf'); const shop = await page.evaluate(() => document.body.innerText); R.shopNan = (shop.match(/NaN|undefined/g) || []).length;
    R.shopItems = await page.$$eval('.shop-item', (x) => x.length);
    await go('#/woche');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const firstMeal = await page.$('.meal [data-action="swap"], [data-action=swap]');
    if (firstMeal) { await firstMeal.click(); await page.waitForTimeout(1500); await page.clock.runFor(2000); note('Tauschen ok: ' + (toasts.at(-1) || '')); } else note('kein Tauschen-Button gefunden');
    // Abneigung nachträglich (Allergie-/Diät-Personas)
    if (P.dislikes) {
      await go('#/einstellungen/gerichte');
      for (const d of P.dislikes) { await page.fill('#dislike-new', d); await page.click('[data-action=add-dislike]'); await page.waitForTimeout(150); }
      note('Abneigungen eingetragen: ' + P.dislikes.join(', ') + ' → Toast: ' + (toasts.at(-1) || '–'));
      const planAfter = await page.evaluate(() => JSON.stringify(Object.values(JSON.parse(localStorage.getItem('mf1:plans')))[0].days.map((d) => d.meals.map((m) => m.recipeId))));
      R.planChangedAfterDislike = planAfter;
    }
    // Rezept öffnen + Kochmodus
    await go('#/woche');
    const rlink = await page.$('[data-action=open-meal], .meal-title, .meal a');
    R.errors = errs; R.consoleErrors = cons.slice(0, 5); R.toasts = toasts;
    R.lsBytes = await page.evaluate(() => Object.keys(localStorage).reduce((a, k) => a + (localStorage.getItem(k) || '').length, 0));
    await page.screenshot({ path: `${SP}/shot-${P.id}.png` });
    results.push(R);
    console.log(P.id, R.goals, '|', R.warnings, '| Allergie-Schritt:', R.allergyInOnboarding, '| 1. Plan', R.firstPlanMs + 'ms', '| NaN', R.nanInText, R.shopNan, '| Fehler', errs.length, cons.length, '|', R.steps.join(' / ').slice(0, 160));
    await ctx.close();
  }
  fs.writeFileSync(SP + '/flows.json', JSON.stringify(results, null, 1));
  await b.close();
})();
