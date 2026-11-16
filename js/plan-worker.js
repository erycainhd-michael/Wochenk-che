// Wochenplan im Hintergrund berechnen: Die App bleibt bedienbar (Animationen, Scrollen), während der
// Planer einige Sekunden rechnet. Eingabe = plannerInput() der App (nur Daten, keine Funktionen).
import { generatePlan } from './planner.js';

self.onmessage = (ev) => {
  const { id, input } = ev.data;
  try {
    self.postMessage({ id, plan: generatePlan(input) });
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  }
};
