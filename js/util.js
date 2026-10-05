// Kleine, reine Hilfsfunktionen (laufen im Browser und in Node für Tests).

export const DAY_NAMES = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const SLOT_LABEL = { fruehstueck: 'Frühstück', mittag: 'Mittag', abend: 'Abend', snack: 'Snack' };

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const round = (x, step = 1) => Number((Math.round(x / step) * step).toFixed(6));
export const sum = (arr, fn = (x) => x) => arr.reduce((a, b) => a + fn(b), 0);
export const avg = (arr, fn) => (arr.length ? sum(arr, fn) / arr.length : 0);

// Deterministischer Zufallsgenerator, damit ein Plan mit gleichem Seed reproduzierbar ist.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickWeighted(items, weights, rng) {
  const total = sum(weights);
  if (!(total > 0)) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// --- Zeit in Europe/Berlin -------------------------------------------------

const berlinFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
});
const WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** Liefert Datum/Uhrzeit in Berlin. weekday: 0 = Montag … 6 = Sonntag */
export function berlinNow(date = new Date()) {
  const parts = Object.fromEntries(berlinFmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    iso: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WD[parts.weekday],
  };
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Montag der Woche (Berliner Zeit) als ISO-Datum */
export function mondayOf(date = new Date()) {
  const b = berlinNow(date);
  return addDays(b.iso, -b.weekday);
}

export function formatDate(iso, opts = { day: 'numeric', month: 'numeric' }) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('de-DE', { timeZone: 'UTC', ...opts });
}

export function isoWeek(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return week;
}

// --- Formatierung ----------------------------------------------------------

const euroFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export const euro = (x) => euroFmt.format(x || 0);
export const num = (x, digits = 0) =>
  (x || 0).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function factorLabel(f) {
  return (Math.round(f * 100) / 100).toLocaleString('de-DE') + '×';
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
