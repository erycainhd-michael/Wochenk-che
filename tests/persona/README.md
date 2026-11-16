# Persona-Tiefenprüfung

Skripte zum Bericht „Mise Tiefenprüfung“ (KW 47/2026). Sie laufen nicht mit `npm test`.

- `personas.mjs` – die 15 Personas mit Risikohypothese
- `sim.mjs [Wochen] [Persona-ID]` – 26 Wochen echter Planer je Persona, schreibt `results.json`
- `fuzz.mjs [Anzahl]` – Zufallspläne mit Invarianten-Prüfung, schreibt `fuzz.json`
- `flows.cjs <Ordner>` – Einführung und Kernaufgaben im Browser (Server auf Port 8765)
- `longrun.cjs <Ordner> P01,P14 16` – mehrmonatige Nutzung im Browser mit vorgestellter Uhr

Beispiel: `node tests/persona/sim.mjs 26`, Browser-Skripte: `python3 -m http.server 8765` und dann `node tests/persona/flows.cjs "$PWD/tests/persona"`.
Ausgabedateien (`*.json`, `*.png`) nicht einchecken.
