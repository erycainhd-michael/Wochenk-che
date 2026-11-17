# Gerätetest – echte Geräte, nicht der Entwicklungsbrowser

Bisher lief jeder Test in einem Linux-Chromium. iPhones verhalten sich anders (siehe der iOS‑26‑Weichzeichner). Jede Zeile einmal durchgehen, Ergebnis eintragen.

## Gerätematrix
| Gerät | System | Browser / Modus | Wer hat eins? | Ergebnis |
|---|---|---|---|---|
| iPhone SE (2./3. Gen., kleiner Bildschirm) | iOS 17 oder 18 | Home-Bildschirm-App | | |
| aktuelles iPhone (Dynamic Island) | iOS 26 | Home-Bildschirm-App | du | |
| aktuelles iPhone | iOS 26 | Safari (nicht installiert) | | |
| iPad | iPadOS 18/26 | Home-Bildschirm-App | | |
| Android-Mittelklasse | Android 14/15 | Chrome, „Zum Startbildschirm“ | | |
Fehlt ein Gerät: BrowserStack (kostenlose Testphase) bietet echte iPhones im Browser.

## Checkliste je Gerät
- [ ] Erster Start: Startbildschirm, Einführung, erster Plan ohne Fehler
- [ ] Oben nichts verschwommen, nichts unter Statusleiste/Dynamic Island versteckt
- [ ] Tab-Leiste unten vollständig sichtbar, nichts vom Home-Balken verdeckt
- [ ] Querformat: nichts abgeschnitten
- [ ] **Große Schrift:** Einstellungen → Anzeige & Helligkeit → Textgröße ganz groß (und Bedienungshilfen → Größerer Text): alle Bildschirme bedienbar
- [ ] **VoiceOver** (dreimal Seitentaste, wenn eingerichtet): Plan erstellen, Rezept öffnen, Einkauf abhaken – alles ansagbar, keine „Taste“ ohne Namen
- [ ] **Dunkelmodus**: alles lesbar
- [ ] **Flugmodus:** App öffnen, Plan, Rezept, Einkaufsliste funktionieren offline
- [ ] **Timer:** Kochmodus-Timer starten, Handy sperren, Alarm kommt
- [ ] **Datenverlust-Test:** Sichern → App vom Home-Bildschirm löschen → neu hinzufügen → „Ich habe schon ein Profil“ → Sicherung laden → alles wieder da
- [ ] **Speicher-Test:** App 8 Tage nicht öffnen, dann öffnen → Daten noch da (prüft, ob iOS den Speicher räumt)
- [ ] Teilen der Einkaufsliste / Einladungslink (falls genutzt)

## Barrierefreiheit zusätzlich am Mac (optional)
- Safari → Entwickler → Mit iPhone verbinden, dann Xcode → Open Developer Tool → **Accessibility Inspector**: fehlende Beschriftungen und Kontraste.
- Chrome → Lighthouse → „Accessibility“: Ziel ≥ 95.
