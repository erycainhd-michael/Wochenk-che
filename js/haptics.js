// Haptisches Feedback (kurzes Tippen im iPhone).
// Safari kennt navigator.vibrate nicht – ab iOS 18 löst aber das Umschalten eines Schalters
// (<input type="checkbox" switch>) ein leichtes Tippen aus. Das nutzen wir unsichtbar.
// Funktioniert nur als Reaktion auf eine Berührung; sonst passiert einfach nichts.

let label = null;
let enabled = true;

export function setHapticsEnabled(on) {
  enabled = on !== false;
}

function ensure() {
  if (label?.isConnected) return label;
  label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  return label;
}

/** Ein kurzes Tippen. pattern: Anzahl/Abstände für Geräte mit navigator.vibrate (Android) */
export function haptic(pattern = 12) {
  if (!enabled) return;
  try {
    if (navigator.vibrate) {
      navigator.vibrate(pattern);
      return;
    }
    ensure().click();
  } catch {
    /* nicht unterstützt */
  }
}

/** Mehrere Tipper hintereinander (z. B. beim Erreichen des Zielgewichts) */
export function hapticBurst(times = 3, gap = 110) {
  if (!enabled) return;
  if (navigator.vibrate) return haptic(Array.from({ length: times * 2 - 1 }, (_, i) => (i % 2 ? gap : 18)));
  for (let i = 0; i < times; i++) setTimeout(() => haptic(), i * gap);
}
