// GitHub-Cron läuft in UTC. Damit etwas „montags 9:00 Berliner Zeit“ passiert, gibt es zwei
// Cron-Einträge (Sommer- und Winterzeit). Diese Funktion entscheidet, welcher davon zuständig ist.
//
// Wichtig: Wir vergleichen den UTC-Offset von Berlin am heutigen Tag – nicht die aktuelle Uhrzeit.
// GitHub startet geplante Läufe oft mit Verspätung; der Offset-Vergleich ist davon unabhängig.

export function berlinOffsetHours(date = new Date()) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', timeZoneName: 'shortOffset' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName').value; // z. B. "GMT+2"
  const m = name.match(/GMT([+-]\d+)?/);
  return m && m[1] ? Number(m[1]) : 0;
}

/**
 * @param schedule z. B. "0 7 * * 1" (aus github.event.schedule)
 * @param targetHour Berliner Zielstunde (Standard 9)
 * Ohne schedule (manueller Start) → true.
 */
export function shouldRunNow(schedule, date = new Date(), targetHour = Number(process.env.TARGET_HOUR || 9)) {
  if (!schedule) return true;
  const utcHour = Number(schedule.trim().split(/\s+/)[1]);
  if (Number.isNaN(utcHour)) return true;
  return (utcHour + berlinOffsetHours(date)) % 24 === targetHour;
}
