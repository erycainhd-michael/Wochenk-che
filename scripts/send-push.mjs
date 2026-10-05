// Schickt „Dein Wochenplan ist da“ an dein iPhone. Läuft in der GitHub Action montags 9:00 (Berlin).
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_SUBSCRIPTION (alle drei erzeugt die App unter Einstellungen).
import webpush from 'web-push';
import { shouldRunNow } from './berlin-time.mjs';

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_SUBSCRIPTION, VAPID_SUBJECT, CRON_SCHEDULE, FORCE } = process.env;

if (!FORCE && !shouldRunNow(CRON_SCHEDULE)) {
  console.log('Nicht 9:00 Uhr in Berlin für diesen Cron-Eintrag – übersprungen.');
  process.exit(0);
}
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !PUSH_SUBSCRIPTION) {
  console.log('Push ist nicht eingerichtet (Secrets fehlen) – nichts zu tun.');
  process.exit(0);
}

// Apple verlangt ein gültiges Subject (mailto: oder https:). Standard: die Repo-Adresse.
const subject = VAPID_SUBJECT || `https://github.com/${process.env.GITHUB_REPOSITORY || 'michael-food'}`;
webpush.setVapidDetails(subject, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

let subs = JSON.parse(PUSH_SUBSCRIPTION);
if (!Array.isArray(subs)) subs = [subs];

const payload = JSON.stringify({
  title: 'Dein Wochenplan ist da 🍽️',
  body: 'Öffne Michael Food: Reste eintragen, Plan erstellen, einkaufen.',
  url: './#/planen',
});

let failed = 0;
for (const sub of subs) {
  try {
    await webpush.sendNotification(sub, payload, { TTL: 6 * 3600 });
    console.log('Push gesendet.');
  } catch (e) {
    failed++;
    console.error(`Push fehlgeschlagen (${e.statusCode || ''}): ${e.body || e.message}`);
    if (e.statusCode === 404 || e.statusCode === 410) console.error('Das Abo ist abgelaufen – in der App unter Einstellungen neu erzeugen und Secret PUSH_SUBSCRIPTION ersetzen.');
  }
}
process.exit(failed === subs.length ? 1 : 0);
