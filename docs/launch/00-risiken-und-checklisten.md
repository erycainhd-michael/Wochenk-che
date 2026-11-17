# Launch-Bereitschaft – Pre-Mortem, Risiken, Checklisten

Stand: November 2026. Drei Stufen: **(a)** geschlossene Beta mit 10–20 Bekannten · **(b)** öffentlicher Link · **(c)** App Store.

## Pre-Mortem: „Ein Jahr später ist Mise gescheitert – warum?“
1. Ein Bekannter teilt den Einladungslink weiter. Darin steckt der GitHub-Zugang des Betreibers. Fremde legen damit Issues an, die der Workflow automatisch als öffentliche Rezepte übernimmt (Spam, Missbrauch, im schlimmsten Fall Schreibzugriff aufs Repo).
2. Eine Testerin verliert nach 3 Wochen alle Daten, weil iOS den Website-Speicher geräumt hat. Sie kommt nicht zurück.
3. Eine Abmahnung trifft ein: kein Impressum, Gesundheitsdaten ohne Datenschutzhinweis.
4. Ein Nutzer mit Essstörung nutzt das Kaloriendefizit und den Gewichtsverlauf auf schädliche Weise.
5. Nutzer außerhalb Berlins sehen Angebote von Märkten, die es bei ihnen nicht gibt, und Preise, die nicht stimmen. „Die App lügt.“
6. Nach der Neugier der ersten Woche öffnet kaum jemand die App wieder, weil das Einrichten zu lange dauert und der Nutzen erst spät spürbar wird.
7. Auf einem älteren iPhone ist ein Knopf nicht erreichbar. Niemand hat es auf echten Geräten getestet.

## Risikoliste
Schaden (S) und Wahrscheinlichkeit (W) jeweils 1–5. „Sperrt“ = muss vor dieser Stufe gelöst sein.

| # | Risiko | S | W | Sperrt | Stand / Maßnahme |
|---|---|---|---|---|---|
| R1 | **GitHub-Token beim Teilen**: Der Token des Betreibers liegt auf Geräten und steckt in Einladungslinks. Issues landen automatisch als öffentliche Rezepte. | 5 | 4 | b, c | Offen. Für (a) nur Token mit minimalem Recht (nur Issues, nur dieses Repo, Ablauf 30 Tage). Vor (b): Teilen über einen eigenen kleinen Server/Function ohne Token im Gerät oder Teilen ganz abschalten. |
| R2 | **Datenverlust auf iOS** (Speicher wird nach Wochen ohne Nutzung geräumt, Handywechsel) | 4 | 3 | b | Teilweise: Sicherung als Datei vorhanden. Offen: regelmäßige Erinnerung zum Sichern, Test „8 Tage nicht geöffnet“ auf echtem iPhone. |
| R3 | **Impressum fehlt** (§ 5 DDG bei öffentlichem Angebot) | 4 | 4 | b, c | Seite „Datenschutz & Rechtliches“ gebaut. Name/Anschrift/E-Mail fehlen noch → `data/legal.json` ausfüllen. |
| R4 | **Gesundheitsdaten** (Art. 9 DSGVO: Gewicht, Allergien, Schwangerschaft) | 4 | 3 | b, c | Daten bleiben auf dem Gerät, nichts wird gesendet (geprüft: keine externen Anfragen). Datenschutzhinweis gebaut. Vor (c): Prüfung durch Datenschutz-Fachperson. |
| R5 | **Medizinprodukt (MDR Regel 11)** durch Krankheitsbezug | 4 | 2 | c | Krankheitsformulierungen (Diabetes, Niere) neutralisiert, Hinweis „ersetzt keine ärztliche Beratung“. Vor (c): kurze Rechtsberatung. |
| R6 | **Essstörungen** | 5 | 2 | b | Mindestkalorien, kein Defizit bei Untergewicht/Schwangerschaft/unter 18, „Zahlen ausblenden“, keine Streaks. Wochen-Check wird in diesen Fällen nicht gezeigt. Offen: Hilfehinweis (BZgA) in den Einstellungen. |
| R7 | **Persönliche Daten fest im Code** (Name, Ziele in der KI-Anweisung) | 3 | 5 | a | **Behoben**: KI nutzt jetzt das Profil der jeweiligen Person. |
| R8 | **Google Fonts von Google-Servern** (LG München 2022) | 3 | 3 | b | **Behoben**: Schriften liegen jetzt in der App. |
| R9 | **Berliner Angebote/Preise** für alle | 3 | 5 | b | Offen: Märkte frei wählbar machen oder Angebote nur zeigen, wenn Postleitzahl passt; Preise als „Richtwert Berlin“ kennzeichnen. |
| R10 | **Veraltete Preise/Angebote** | 2 | 4 | b | Angebote werden wöchentlich gezogen; Preise in `ingredients.json` nicht. Datenprüfung (03) alle 3 Monate. |
| R11 | **KI-Schlüssel im Browser** | 3 | 2 | b | Nur eigener Schlüssel der Person, nur auf ihrem Gerät. Für (b) KI-Funktion standardmäßig aus lassen. |
| R12 | **Alte Version `klassisch/` öffentlich** | 2 | 3 | b | Vor (b) entfernen oder auf neue Version umleiten. |
| R13 | **Nie auf echten Geräten getestet** | 3 | 4 | a | Gerätetest (04) mit mind. 2 iPhones vor (a). |
| R14 | **Abbruch nach Woche 1** (Branchen-Median ~70 % Abbruch in 100 Tagen) | 4 | 4 | b | Schnellstart ohne Angaben, „Rest später“, Wochen-Check gebaut. Messen in der Beta. |
| R15 | **Keine Fehlermeldungen von Nutzern** | 2 | 4 | a | **Behoben**: Fehlerprotokoll und Nutzungszähler lokal, landen in der Sicherung. Auswertung per Skript. |
| R16 | **App Store lehnt reine Web-Hülle ab** (Apple Richtlinie 4.2) | 3 | 4 | c | Für (c) native Funktionen nötig (Erinnerungen, Widgets, Kurzbefehle) oder bei PWA bleiben. |

## Checklisten mit Abnahme-Kriterien

### (a) Geschlossene Beta – 10–20 Bekannte
- [x] Keine fremden persönlichen Daten im Code (R7)
- [x] Keine Verbindung zu Google beim Laden (R8)
- [x] Datenschutz-Seite in der App (R4)
- [x] Fehlerprotokoll + Nutzungszähler für die Auswertung (R15)
- [x] Schnellstart in unter 1 Minute (gemessen: 4 Tipps, ca. 3 s)
- [ ] Teilen-Token eingeschränkt: nur Issues, nur dieses Repo, 30 Tage gültig (R1) – **Michael**
- [ ] Gerätetest auf mind. 2 echten iPhones, inkl. Datenverlust-Test (R13) – **Michael**
- [ ] 5 Nutzertests: 5/5 schaffen Plan + Rezept + Einkauf ohne Hilfe, SUS ≥ 75 – **Michael mit Testpersonen**
- [ ] Teilnehmende wissen: „Bitte sonntags sichern“

### (b) Öffentlicher Link
Alles aus (a), plus:
- [ ] Tagebuchstudie bestanden: ≥ 60 % aktiv in Woche 2, Lästigkeit ≤ 3/7, ≥ 3 Abendessen/Woche aus dem Plan
- [ ] Kassenbon-Abweichung ≤ ±15 %, Nährwerte 18/20 Rezepte ≤ ±10 %
- [ ] Teilen ohne Token im Gerät oder abgeschaltet (R1)
- [ ] Impressum ausgefüllt (R3)
- [ ] Märkte/Region wählbar oder Angebote ausgeblendet außerhalb Berlins (R9)
- [ ] Sicherungs-Erinnerung (R2), Hilfehinweis Essstörungen (R6)
- [ ] `klassisch/` entfernt (R12)
- [ ] VoiceOver-Durchlauf ohne unbenannte Knöpfe, Lighthouse Accessibility ≥ 95
- [ ] Null Datenverlust bei allen Beta-Teilnehmenden

### (c) App Store
Alles aus (b), plus:
- [ ] Datenschutz-Fachperson hat Datenschutzerklärung + Art.-9-Einwilligung geprüft
- [ ] Rechtsberatung: kein Medizinprodukt (R5)
- [ ] Mehrwert gegenüber Website für Apple-Prüfung (R16)
- [ ] Apple-Entwicklerkonto (99 $/Jahr), Datenschutz-Angaben („Nutrition Label“), Altersfreigabe
- [ ] 3 Monate öffentlicher Betrieb mit stabilen Werten
