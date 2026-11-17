# Datenprüfung – stimmen Nährwerte, Preise und Rezepte?

Drei Stichproben, jeweils mit einfachen Mitteln. Ergebnisse in die Tabellen eintragen.

## 1. Nährwerte gegen den Bundeslebensmittelschlüssel (20 Rezepte, ca. 2 Stunden)
Mise rechnet mit Werten pro 100 g je Zutat (`data/ingredients.json`). Prüfe, ob die Summe pro Rezept stimmt.
1. Wähle 20 Rezepte: 10 häufige Hauptgerichte, 5 Frühstücke, 3 Fertiggerichte, 2 Kuchen.
2. Für jede Zutat den Wert in der BLS-Suche nachschlagen (blsdb.de, kostenlos) oder – bei Markenprodukten – auf der Packung / Open Food Facts.
3. Pro Rezept: kcal und Protein selbst summieren (Menge in g × Wert/100) und mit der Anzeige in Mise vergleichen.

| Rezept | Mise kcal | eigene kcal | Abw. | Mise Protein | eigenes Protein | Abw. |
|---|---|---|---|---|---|---|
| | | | | | | |

**Abnahme:** 18 von 20 Rezepten innerhalb **±10 %**. Abweichende Zutaten in `ingredients.json` korrigieren (dann `node scripts/validate-data.mjs`).

## 2. Preise gegen echte Kassenbons (4 Einkäufe)
1. Vor dem Einkauf in Mise die Summe der Einkaufsliste notieren.
2. Nur kaufen, was auf der Liste steht. Kassenbon fotografieren.
3. Vergleich je Laden:

| Datum | Laden | Mise-Summe | Kassenbon | Abw. | Größte Ausreißer (Artikel) |
|---|---|---|---|---|---|
| | | | | | |

**Abnahme:** Abweichung je Einkauf **≤ ±15 %**. Ausreißer-Artikel: Preis in `ingredients.json` aktualisieren. Hinweis: Die Angebote gelten nur für die eingestellten Berliner Märkte – andere Regionen zahlen andere Preise.

## 3. Nachkochen (10 Rezepte über 2 Wochen)
| Rezept | Zeit laut Mise | echte Zeit | Abwasch laut Mise | echt | Geschmack 1–5 | Satt? | Fehler im Rezepttext |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

**Abnahme:** Echte Zeit höchstens **+30 %** über der Angabe (Rezensionen anderer Apps nennen genau das als Ärgernis: „dauert 5–15 Minuten länger als angegeben“), Geschmack im Mittel ≥ 4, kein Rezept mit fehlender Zutat oder fehlendem Schritt.
