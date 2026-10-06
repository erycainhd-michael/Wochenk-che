// Lokale Datenhaltung (localStorage). Keine Accounts, kein Server.
const NS = 'mf1:';
const APP_ID = 'michael-food';

export const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(NS + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(NS + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('Speichern fehlgeschlagen', e);
      return false;
    }
  },
  del(key) {
    try {
      localStorage.removeItem(NS + key);
    } catch {
      /* ignorieren */
    }
  },
  keys() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(NS)) out.push(k.slice(NS.length));
      }
    } catch {
      /* ignorieren */
    }
    return out;
  },
};

export function exportAll() {
  const data = {};
  for (const k of store.keys()) data[k] = store.get(k);
  return { app: APP_ID, version: 1, exportedAt: new Date().toISOString(), data };
}

export function importAll(obj) {
  if (!obj || obj.app !== APP_ID || typeof obj.data !== 'object') {
    throw new Error('Das ist keine Michael-Food-Sicherung.');
  }
  for (const k of store.keys()) store.del(k);
  for (const [k, v] of Object.entries(obj.data)) store.set(k, v);
}

/** Alte Pläne aufräumen, damit der Speicher klein bleibt (die letzten 10 Wochen bleiben). */
export function prunePlans(plans, keep = 10) {
  const weeks = Object.keys(plans).sort();
  for (const w of weeks.slice(0, Math.max(0, weeks.length - keep))) delete plans[w];
  return plans;
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* nicht unterstützt */
  }
}
