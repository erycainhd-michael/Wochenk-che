// Mehrmonatige Nutzung im Browser: Wochenwechsel per Uhr, Gewicht im Rückblick, Einkauf abhaken, Pause von 3 Wochen
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const SP = process.argv[2];
const WHO = (process.argv[3] || 'P01').split(',');
const WEEKS = Number(process.argv[4] || 14);
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
(async () => {
  const { PERSONAS } = await import(SP + '/personas.mjs');
  const b = await chromium.launch();
  const all = [];
  for (const P of PERSONAS.filter((p) => WHO.includes(p.id))) {
    const ctx = await b.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errs = []; const toasts = [];
    page.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
    await page.exposeFunction('__toast', (t) => toasts.push(t));
    await page.addInitScript(() => { new MutationObserver(() => document.querySelectorAll('.toast').forEach((t) => { if (!t.__seen) { t.__seen = 1; window.__toast(t.innerText.replace(/\n/g, ' ')); } })).observe(document, { childList: true, subtree: true }); });
    let now = new Date('2026-11-16T09:30:00+01:00');
    await page.clock.install({ time: now });
    await page.goto('http://localhost:8765/'); await page.waitForTimeout(2500); await page.clock.runFor(3000);
    const waitSel = async (sel, n = 60) => { for (let i = 0; i < n; i++) { if (await page.$(sel)) return true; await page.clock.runFor(400); await page.waitForTimeout(150); } return false; };
    await waitSel('[data-set=name]'); await page.click('.ob-nav .btn.primary'); await waitSel('[data-field=sex]');
    await page.click(`[data-action=ob-set][data-field=sex][data-val=${P.sex}]`);
    for (const [f, v] of [['age', P.age], ['height', P.height], ['weight', P.weight]]) { await page.fill(`[data-ob=${f}]`, String(v)); await page.dispatchEvent(`[data-ob=${f}]`, 'change'); }
    await page.click('.ob-nav .btn.primary'); await waitSel('[data-field=activity]');
    await page.click(`[data-action=ob-set][data-field=activity][data-val=${P.activity}]`); await page.click(`[data-action=ob-set][data-field=goal][data-val=${P.goal}]`);
    if (P.goalWeight) { await page.fill('[data-ob=goalWeight]', String(P.goalWeight)); await page.dispatchEvent('[data-ob=goalWeight]', 'change'); }
    await page.click('.ob-nav .btn.primary'); await page.waitForTimeout(300); await page.click('.ob-nav .btn.primary'); await waitSel('[data-set=budget]');
    await page.fill('[data-set=budget]', String(P.budget)); await page.dispatchEvent('[data-set=budget]', 'change');
    for (const d of P.eatOut || []) await page.click(`[data-action=eatout-day][data-day="${d}"]`);
    await page.click('[data-action=first-plan]'); await waitSel('.card.hero');
    const goals0 = await page.evaluate(() => JSON.parse(localStorage.getItem('mf1:settings')).goals);
    let weight = P.weight;
    const log = [];
    for (let w = 0; w < WEEKS; w++) {
      const ws = addDays('2026-11-16', 7 * w);
      const pause = w >= 8 && w <= 10;
      if (w > 0) {
        if (pause) { log.push({ ws, pause: true }); continue; }
        now = new Date(ws + 'T09:30:00+01:00');
        await page.clock.setSystemTime(now);
        await page.reload(); await page.waitForTimeout(1500); await page.clock.runFor(4000);
        await waitSel('.card.hero', 80);
      }
      const st = await page.evaluate(() => {
        const plans = JSON.parse(localStorage.getItem('mf1:plans') || '{}');
        const s = JSON.parse(localStorage.getItem('mf1:settings'));
        const bytes = Object.keys(localStorage).reduce((a, k) => a + (localStorage.getItem(k) || '').length, 0);
        return { planWeeks: Object.keys(plans).sort(), goals: s.goals, bytes, title: document.querySelector('#view h1') ? document.querySelector('#view h1').textContent : '', body: document.body.innerText.slice(0, 2000) };
      });
      weight = +(weight + (P.goal === 'abnehmen' ? -0.45 : P.goal === 'aufbauen' ? 0.2 : 0)).toFixed(1);
      await page.evaluate(() => { location.hash = '#/rueckblick'; }); await page.waitForTimeout(800); await page.clock.runFor(500);
      const wIn = await page.$('input[data-weight]');
      if (wIn) { await wIn.fill(String(weight).replace('.', ',')); await wIn.dispatchEvent('change'); await page.waitForTimeout(300); }
      const review = (await page.evaluate(() => document.body.innerText)).slice(0, 600).split('\n').join(' | ');
      await page.evaluate(() => { location.hash = '#/einkauf'; }); await page.waitForTimeout(700); await page.clock.runFor(400);
      const n = await page.$$eval('.shop-item .check', (x) => x.length);
      for (let i = 0; i < Math.min(n, 40); i++) { const c = (await page.$$('.shop-item .check:not(.on)'))[0]; if (!c) break; await c.click(); await page.waitForTimeout(40); }
      const nan = (st.body.match(/NaN|undefined|Infinity/g) || []).length;
      log.push({ ws, title: st.title, planWeeks: st.planWeeks.length, lastPlan: st.planWeeks[st.planWeeks.length - 1], goals: st.goals, bytes: st.bytes, weightIn: !!wIn, weight, shopN: n, nan, review: review.slice(0, 220) });
      console.log(P.id, ws, st.title, 'Pläne', st.planWeeks.length, 'letzter', st.planWeeks[st.planWeeks.length - 1], 'kcal-Ziel', st.goals.kcal, 'Gewicht', weight, 'LS', Math.round(st.bytes / 1024) + 'KB', 'Einkauf', n, 'NaN', nan, 'Gewichtsfeld', !!wIn);
    }
    const final = await page.evaluate(() => ({ fb: JSON.parse(localStorage.getItem('mf1:feedback') || '[]').map((f) => [f.weekStart, f.week && f.week.weight]) }));
    all.push({ id: P.id, goals0, log, errs, toasts: toasts.slice(-40), final });
    await page.screenshot({ path: `${SP}/long-${P.id}.png` });
    await ctx.close();
  }
  fs.writeFileSync(`${SP}/longrun-${WHO.join('_')}.json`, JSON.stringify(all, null, 1));
  await b.close();
})();
