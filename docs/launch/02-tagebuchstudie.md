# Tagebuchstudie – 2 Wochen im echten Alltag (10–20 Personen)

**Ziel:** Bleiben Menschen dabei, wenn niemand zuschaut? Und wie lästig fühlt sich Mise im Alltag an? Laut Studien hören viele schon in den ersten zwei Wochen auf (z. B. nur 3 % von 190.000 Downloads nutzten ein Ernährungstagebuch länger als eine Woche – Cordeiro et al.). Genau diese Phase wird hier beobachtet.

## Ablauf
- **Start an einem Sonntag**, damit der erste Plan am Montag beginnt.
- Eine WhatsApp-Gruppe (oder Einzelchats, wenn Teilnehmende sich nicht kennen sollen). Teilnehmende sehen in der Gruppe die Antworten der anderen – für ehrliche Antworten lieber Einzelchats oder ein kurzes Formular.
- Du schickst **täglich um 20 Uhr** die Tagesfragen, **sonntags** die Wochenfragen.
- Ende: Teilnehmende schicken ihre **Mise-Sicherung** (Einstellungen → Datensicherung → Sichern → Datei teilen). Du wertest sie aus mit:
  `node scripts/analyze-export.mjs ordner-mit-sicherungen/`

## Tägliche Fragen (unter 1 Minute)
1. Hast du heute Mise geöffnet? (ja / nein)
2. Hast du heute etwas aus dem Plan gekocht oder gegessen? (ja / teilweise / nein)
3. **Wie lästig war Mise heute?** 1 = gar nicht … 7 = sehr lästig
4. Optional: Was war heute gut oder schlecht? (ein Satz oder Sprachnachricht)

## Wochenfragen (sonntags)
1. Wie viele Abendessen dieser Woche kamen aus dem Plan? (0–7)
2. Hast du nach Liste eingekauft? Was hast du ungefähr ausgegeben? (Kassenbon fotografieren!)
3. Was hat dich diese Woche am meisten gestört?
4. Würdest du nächste Woche weitermachen? (ja / vielleicht / nein)
5. Für Teilnehmende mit Gewichtsziel: Wie fühlst du dich mit deinem Fortschritt? (1–7)

## Messgrößen und Abnahme-Kriterien
| Messgröße | Woher | Ziel für den öffentlichen Start |
|---|---|---|
| Noch aktiv in Woche 2 (mind. 3 Tage geöffnet) | Tagesfrage 1 + Nutzungszähler | ≥ 60 % |
| Abendessen aus dem Plan pro Woche | Wochenfrage 1 | ≥ 3 im Mittel |
| Lästigkeit | Tagesfrage 3 | Mittel ≤ 3, nicht steigend |
| Abweichung Kassenbon ↔ App-Kosten | Wochenfrage 2 vs. App | ≤ ±15 % |
| Weitermachen | Wochenfrage 4 | ≥ 60 % „ja“ |
| Fehler im Protokoll | Sicherungen | 0 unbehandelte Fehler |

## Achtsamkeit
- Niemand muss Gewicht angeben. Fragen zu Gewicht nur an Personen, die selbst ein Gewichtsziel gewählt haben.
- Wer im Verlauf Anzeichen von Essstörungen zeigt (starkes Hungern, Schuldgefühle beim Essen): Studie für diese Person beenden, freundlich auf die BZgA-Beratung hinweisen (0221 892031).
- Sicherungen enthalten Gesundheitsangaben: nur lokal auswerten, danach löschen.
