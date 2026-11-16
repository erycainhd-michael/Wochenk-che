import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Offline-Fähigkeit: Jede JS-Datei, die die App lädt (Importe, Worker), muss im Service-Worker-Cache stehen –
// sonst startet die App ohne Netz nicht (passiert beim Hinzufügen von diet.js).
test('Service Worker: alle App-Module sind offline verfügbar', () => {
  const sw = fs.readFileSync('sw.js', 'utf8');
  const files = new Set(['js/app.js']);
  const queue = ['js/app.js'];
  while (queue.length) {
    const f = queue.pop();
    const src = fs.readFileSync(f, 'utf8');
    const refs = [...src.matchAll(/(?:from\s+|import\(\s*)'\.\/([\w-]+\.js)'/g), ...src.matchAll(/new Worker\('js\/([\w-]+\.js)'/g)].map((m) => 'js/' + m[1]);
    for (const r of refs) if (!files.has(r)) (files.add(r), queue.push(r));
  }
  for (const f of files) assert.ok(sw.includes(`'./${f}'`), `${f} fehlt in sw.js`);
});
