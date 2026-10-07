// Automatische Datensicherung auf dem Gerät: einmal täglich eine Kopie aller Daten in IndexedDB
// (getrennt vom localStorage). Die letzten 14 Kopien bleiben erhalten. Fehlt der localStorage einmal
// (z. B. gelöscht oder beschädigt), kann Mise daraus wiederherstellen.

const DB = 'mise-backup';
const STORE = 'snapshots';
const KEEP = 14;

function open() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('Kein IndexedDB'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'day' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const st = t.objectStore(STORE);
    const out = fn(st);
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

/** Alle Sicherungen, neueste zuerst: [{ day, savedAt, data, size }] */
export async function listSnapshots() {
  try {
    const db = await open();
    const all = await tx(db, 'readonly', (st) => st.getAll());
    return (all || []).sort((a, b) => b.day.localeCompare(a.day));
  } catch {
    return [];
  }
}

/** Heute schon gesichert? Sonst Kopie anlegen und alte aufräumen. force = jetzt neu sichern */
export async function autoSnapshot(getData, day, force = false) {
  try {
    const db = await open();
    const existing = await tx(db, 'readonly', (st) => st.get(day));
    if (existing && !force) return false;
    const data = getData();
    // nichts Sinnvolles zum Sichern (z. B. ganz neue App)
    if (!data?.data || !Object.keys(data.data).some((k) => /plans|feedback|settings/.test(k))) return false;
    await tx(db, 'readwrite', (st) => st.put({ day, savedAt: new Date().toISOString(), data, size: JSON.stringify(data).length }));
    const all = await listSnapshots();
    const old = all.slice(KEEP);
    if (old.length) await tx(db, 'readwrite', (st) => old.forEach((o) => st.delete(o.day)));
    return true;
  } catch {
    return false;
  }
}

export async function getSnapshot(day) {
  try {
    const db = await open();
    return await tx(db, 'readonly', (st) => st.get(day));
  } catch {
    return null;
  }
}
