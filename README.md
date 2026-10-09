# Mise – Wochenküche

Deine persönliche Ernährungs-App fürs iPhone. Sie plant die Woche so, dass **der Einkauf deine Kalorien- und Proteinziele schon erfüllt** – du kochst nach Plan, hakst ab und musst nichts tracken.

- Wochenplan mit Frühstück, Mittag, Abend, Snacks und Auswärtsessen (Pauschale)
- Portionen werden automatisch auf dein Tagesziel (±5 %) skaliert, Makros werden aus der Zutaten-Datenbank **berechnet**, nicht geschätzt
- Einkaufsliste nach Laden und Supermarkt-Bereich, abhakbar (bleibt gespeichert), mit Vermerk „für welches Gericht“, Angebotsmarkierung und Gesamtkosten
- Rezepte mit skalierten Zutaten, Schritt-für-Schritt-Anleitung, mehreren parallelen Timern und Kochmodus (Bildschirm bleibt an)
- Reste-Abfrage am Montag, Feedback am Sonntag – beides fließt in die nächsten Pläne ein
- Läuft offline als App auf dem Home-Bildschirm. Keine Accounts, kein Server, keine laufenden Kosten

---

## 1. Architektur

```
GitHub-Repository (kostenlos)
├── GitHub Pages  → liefert die App aus (statische Dateien)
├── GitHub Action „Angebote holen“      (Mo 6:00)  → schreibt data/offers.json
├── Claude-Routine (So abends) → erfindet neue Rezepte und ergänzt data/recipes.json
└── GitHub Action „Tests“ → prüft Daten und Planer bei jeder Änderung

iPhone (Safari → „Zum Home-Bildschirm“)
└── App (HTML/CSS/JavaScript, Service Worker für offline)
    ├── Planer läuft komplett im Browser
    └── Deine Daten (Einstellungen, Pläne, Häkchen, Feedback, Reste) liegen nur lokal auf dem iPhone
```

**Warum der Planer im Browser läuft und nicht in der Action:** Reste, Feedback und Einstellungen liegen auf deinem iPhone. Würde die Action planen, müssten diese Daten ins (öffentliche) Repo. So bleibt alles privat. Die Action liefert nur, was sie besser kann: Angebote abholen und dich wecken.

**Kein Build-Schritt:** Die App besteht aus normalen Dateien, die GitHub Pages direkt ausliefert. Du musst nichts installieren oder „bauen“.

### Dateistruktur

```
index.html, manifest.webmanifest, sw.js   App-Hülle, Installation, Offline-Cache
css/app.css                               Design (hell/dunkel, große Touch-Flächen)
js/app.js                                 Oberfläche: Woche, Einkauf, Rückblick, Einstellungen, Rezept, Kochmodus
js/planner.js                             Wochenplaner (Auswahl, Skalierung, Bewertung, Tauschen)
js/nutrition.js                           Nährwertberechnung, Plausibilitätscheck 4/4/9
js/shopping.js                            Einkaufsliste, Packungen, Reste
js/prices.js                              Richtpreise, Angebote, Laden-Auswahl
js/feedback.js                            Feedback → Rezeptgewichtung
js/timers.js                              Parallele Timer, Signalton, Wake Lock
js/ai.js                                  Optional: Rezept sofort aus einem Titel erfinden (eigener API-Schlüssel)
js/storage.js                             Lokale Speicherung, Export/Import
data/ingredients.json                     112 Zutaten: Nährwerte/100 g, Packung, Richtpreis Lidl/Edeka, Haltbarkeit
data/recipes.json                         51 Rezepte (36 Hauptgerichte, 6 Frühstücke, 9 Snacks)
data/offers.json                          Angebote (von der Action geschrieben)
scripts/                                  Angebote holen, neue Rezepte einfügen, Daten prüfen
tests/                                    Automatische Tests
.github/workflows/                        Die drei GitHub Actions
```

### So plant die App

1. **Auswahl** (gewichteter Zufall, 40 Varianten): Feedback, deine Regler (einfach, wenig Abwasch, Angebote, Vielfalt), Reste vom Vorrat und angebrochene Packungen (werden bevorzugt verbraucht), Saison, Abneigungen, Abwechslung zu den Vorwochen, Ballaststoff-Stufe.
2. **Meal-Prep:** Abendessen werden – je nach Regler „Wenig Abwasch“ – doppelt gekocht; der Rest ist das Mittagessen am nächsten Tag.
3. **Aufwendiges Gericht:** landet am Wochenende (Standard 1×).
4. **Skalierung:** Pro Tag werden Snacks gewählt und Portionen so skaliert, dass Kalorien ±5 % und Protein erreicht werden. Auswärtsessen zählen als Pauschale (Standard 1.000 kcal).
5. **Reste-Ausgleich:** Angebrochene, schnell verderbliche Packungen (Skyr, Feta, Spinat …) werden auf passende Mahlzeiten verteilt.
6. **Bewertung** in deiner Reihenfolge: Kalorien (25) → Protein & Verteilung (20) → Gemüse/Obst/Ballaststoffe (20) → Vielfalt über die Woche (15) → Geschmack & Alltag (10) → Fett-Balance (5) → Energie im Alltag (5), minus Budget-Überschreitung und verderbliche Reste. Der beste Plan gewinnt.
7. **Budget:** Passt der beste Plan nicht ins Budget, sucht ein Sparmodus günstigere Kombinationen. Klappt es trotzdem nicht, sagt die App klar, wie viel fehlt, und schlägt Alternativen vor.

Die Texte folgen „Ergänzen statt Verbieten“: Es gibt keine Verbote und keine Moralisierung – nur Vorschläge wie „ein Skyr-Snack gleicht das aus“.

---

## 2. Ehrliche Hinweise

- **Budget 60 €:** In der ersten Woche liegt der Kassenbon eher bei 75–80 €, weil Vorrat aufgebaut wird (1 kg Reis, Nudeln, Haferflocken, Nüsse …). Die App weist das als „Vorrat“ aus und schlägt die Reste am nächsten Montag vor. In Simulationen über 6 Wochen lag der Einkauf danach meist bei **51–64 €** (Ø ca. 59 €). Wenn du Reste am Montag gewissenhaft bestätigst, wird es günstiger.
- **Preise** sind Richtwerte (Stand Herbst 2026, Discounter-Niveau; Edeka ca. +15 %). Du kannst sie in `data/ingredients.json` anpassen.
- **Nährwerte** sind Richtwerte nach BLS bzw. typischen Open-Food-Facts-Einträgen pro 100 g. Die Tests prüfen, dass kcal und Makros zusammenpassen.
- **Angebote:** Weder Lidl noch Edeka haben eine offizielle öffentliche API.
  - *Edeka:* Die Marktseiten auf edeka.de laden ihre Angebote aus einem JSON-Endpunkt pro Markt. Der ist **inoffiziell**, kann jederzeit wegfallen und wird von uns nur 1× pro Woche abgerufen. Fällt er aus, nutzt die App still die Richtpreise und behält noch gültige alte Angebote.
  - *Lidl:* Kein stabiler, maschinenlesbarer Weg bekannt (der Prospekt ist ein Blätterkatalog). Scraping wäre fragil und rechtlich grau – daher gibt es dafür die **manuelle Angebotseingabe** in den Einstellungen (dauert pro Angebot 10 Sekunden).
  - Die App blockiert nie wegen Angeboten.
- **Timer** laufen zuverlässig nur, solange die App geöffnet ist (iOS pausiert Web-Apps im Hintergrund). Im Kochmodus bleibt der Bildschirm an (ab iOS 16.4; in älteren Versionen evtl. nicht).
- **Push** funktioniert auf dem iPhone nur, wenn die App über „Zum Home-Bildschirm“ installiert ist (ab iOS 16.4).
- **Daten** liegen nur auf deinem iPhone. Wenn du die App löschst, sind sie weg → ab und zu **Einstellungen → Exportieren** (z. B. in iCloud Drive).

---

## 3. Deployment – Schritt für Schritt (ohne Programmierkenntnisse)

### Schritt 1: Code in den Hauptzweig bringen
Der Code liegt im Branch `claude/michael-food-app-aw1voe`. GitHub Pages soll aus dem Hauptzweig `main` laufen:
1. Öffne dein Repository auf github.com.
2. Oben erscheint meist ein gelber Hinweis „claude/michael-food-app-aw1voe had recent pushes“ → **Compare & pull request** → **Create pull request** → **Merge pull request** → **Confirm merge**.
   (Kein Hinweis? Reiter **Pull requests** → **New pull request** → bei „compare“ den Branch auswählen.)

### Schritt 2: GitHub Pages einschalten
1. Im Repository: **Settings** (Zahnrad oben) → links **Pages**.
2. Bei „Source“: **Deploy from a branch**.
3. Branch: **main**, Ordner: **/ (root)** → **Save**.
4. Nach 1–2 Minuten steht oben: „Your site is live at `https://DEIN-NAME.github.io/Wochenk-che/`“. Diese Adresse brauchst du gleich.

> Hinweis: GitHub Pages ist für **öffentliche** Repositories kostenlos. Bei einem privaten Repo braucht Pages ein kostenpflichtiges GitHub-Konto. Im Repo stehen nur Rezepte und Code – deine persönlichen Daten bleiben auf dem iPhone.

### Schritt 3: Actions erlauben
1. **Settings → Actions → General**.
2. „Actions permissions“: **Allow all actions** (Standard).
3. Ganz unten „Workflow permissions“: **Read and write permissions** → **Save**. (Damit die Angebots-Action `offers.json` speichern darf.)
4. Reiter **Actions**: Falls GitHub fragt, „I understand my workflows, go ahead and enable them“ klicken.

Zum Ausprobieren: **Actions → Angebote holen → Run workflow**. Nach ca. 30 Sekunden ist ein grüner Haken da.

### Schritt 4 (optional): Edeka-Markt hinterlegen
1. **Actions → Angebote holen → Run workflow**, ins Feld „find_market“ `12163` (PLZ Schloßstraße) eintragen → **Run workflow**.
2. Den Lauf öffnen → Schritt „Angebote laden“: Dort steht eine Liste von Märkten mit ihrer ID. Suche den Edeka an der Schloßstraße.
3. **Settings → Secrets and variables → Actions → Reiter „Variables“ → New repository variable**: Name `EDEKA_MARKET_ID`, Wert = die ID → **Add variable**.
4. Ab jetzt holt die Action montags um 6:00 die Edeka-Angebote. Ob es klappt, siehst du in der App unter Einstellungen → Angebote („Edeka: ✓“).

Falls Edeka den Abruf blockiert, steht dort „nicht erreichbar“ – die App funktioniert trotzdem mit Richtpreisen.

### Schritt 5: Auf dem iPhone installieren
1. Öffne die Adresse aus Schritt 2 in **Safari** (nicht Chrome).
2. Tippe unten auf **Teilen** (Quadrat mit Pfeil nach oben).
3. Scrolle runter → **Zum Home-Bildschirm** → **Hinzufügen**.
4. Öffne die App ab jetzt immer über das Icon auf dem Home-Bildschirm. Sie funktioniert dann auch offline.

### Updates
Wenn sich Code ändert, lädt das iPhone die neue Version beim nächsten Öffnen im Hintergrund; spätestens beim zweiten Öffnen ist sie aktiv. Bei Änderungen an App-Dateien in `sw.js` die Zeile `const VERSION = 'mf-v1'` hochzählen.

---

## 4. Bedienung

| Wann | Was |
|---|---|
| **Montag ab 9:00** (oder per „Neu planen“) | App fragt „Was ist von letzter Woche übrig?“ – vorausgefüllt mit den berechneten Packungsresten. Korrigieren → **Wochenplan erstellen**. |
| **Einkaufen** | Tab **Einkauf**: nach Laden und Bereich sortiert, Häkchen bleiben gespeichert. |
| **Kochen** | In der Woche auf ein Gericht tippen → Zutaten (auf deine Portion skaliert), Schritte mit ⏱-Timern, **Kochmodus**. Mit ↻ lässt sich ein Gericht tauschen. |
| **Samstag/Sonntag** | Tab **Rückblick**: 👍/👎, „nochmal“, „zu aufwendig“, Notizen + Sättigung, Energie, Gewicht (optional). |
| **Ab und zu** | **Einstellungen → Exportieren** als Backup. |

---

## 5. Daten anpassen

- **Neues Rezept:** In `data/recipes.json` einen Eintrag kopieren und ändern. Mengen pro **1 Portion**, `dishes` = Anzahl Töpfe/Pfannen/Bleche, `effort` 1–3, `mealPrep` true/false, `cuisine` (italienisch, franzoesisch, spanisch, deutsch, skandinavisch, orientalisch, indisch, asiatisch, amerikanisch), `serves` = Portionen, für die das Rezept in der Übersicht gedacht ist, Timer in Sekunden.
- **Neue Zutat / Preis ändern:** `data/ingredients.json` (Nährwerte pro 100 g, `pack` in g, `price` in €).
- Auf github.com kannst du Dateien direkt im Browser bearbeiten (Stift-Symbol). Die Action **Tests** prüft danach automatisch, ob alles stimmt (grüner Haken).

Lokal testen (für Neugierige): `npm test` und `npm start`, dann http://localhost:8080 öffnen.

---

## 6. Festgelegte Entscheidungen

1. **Mittagessen:** Lunchbox mit dem Essen vom Vorabend (Meal-Prep).
2. **Ballaststoffe:** Start 28 g/Tag, +2 g pro Woche bis 40 g (in den Einstellungen änderbar).
3. **Auswärtsessen:** Vor jeder Planung fragt die App, wann du diese Woche auswärts isst (vorausgefüllt mit deiner Standardwoche). Danach kannst du in der Wochenansicht jede Mahlzeit mit 🍴 auf „auswärts“ oder mit 🏠 zurück auf „zu Hause“ setzen – Portionen und Einkaufsliste passen sich an.
4. **Edeka-Markt-ID:** wird über Schritt 4 ermittelt; ohne ID gelten Richtpreise.
5. **Proteinpulver:** als Ergänzung eingeplant (Shake, Protein-Porridge, Skyr-Creme), abschaltbar unter Einstellungen → Gerichte.

## 7. Neue Rezepte jede Woche (kostenlos)

Eine Claude-Routine läuft jeden Sonntagabend über dein Claude-Abo (keine API-Kosten), erfindet 5 neue Gerichte nach deinen Prinzipien und trägt sie mit `node scripts/add-recipes.mjs` geprüft in `data/recipes.json` ein. Neue Rezepte sind in der App mit „neu“ markiert und werden in den ersten zwei Wochen bevorzugt eingeplant. Dein Feedback (😍 👍 👎 🧽 ⏱️) entscheidet danach, wie oft sie wiederkommen.

Läden: Lidl, Aldi Nord, Edeka (Schloßstraße), dm und Rossmann sind auswählbar. Echte Wochenangebote gibt es automatisch nur von Edeka; für die anderen gelten Richtpreise.

## Rezepte für alle Geräte teilen

Neue Rezepte, die in der App entstehen (selbst geschrieben oder per KI), landen automatisch in der gemeinsamen Sammlung `data/recipes.json` und erscheinen nach ein paar Minuten auf allen Geräten:

1. Die App reicht das Rezept als GitHub-Issue „Rezept: …“ ein (mit dem Freigabe-Schlüssel aus den Einstellungen).
2. Der Ablauf `.github/workflows/recipe-share.yml` prüft es (`scripts/import-recipe-issue.mjs` → `scripts/add-recipes.mjs`), ergänzt eigene Zutaten in `data/ingredients.json`, speichert und schließt das Issue.

**Freigabe-Schlüssel einrichten (einmalig):** github.com → Profilbild → Settings → Developer settings → Personal access tokens → Fine-grained tokens → „Generate new token“. Repository access: „Only select repositories“ → `Wochenk-che`. Permissions → Repository permissions → **Issues: Read and write** (sonst nichts). Den Schlüssel in Mise unter Einstellungen → „Rezepte für alle Geräte“ eintragen. Weitere Geräte bekommen ihn über „Einladungslink für ein anderes Gerät“.
