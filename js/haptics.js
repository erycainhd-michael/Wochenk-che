// Haptisches Feedback (kurzes Tippen im iPhone).
// Safari kennt navigator.vibrate nicht – ab iOS 18 löst aber das Umschalten eines Schalters
// (<input type="checkbox" switch>) ein spürbares Tippen aus. Dafür wird bei jedem Aufruf ein
// unsichtbarer Schalter angelegt, über sein Label umgeschaltet und wieder entfernt
// (so wie die Bibliothek „ios-haptics“). Wirkt nur direkt als Reaktion auf eine Berührung und
// nur, wenn in den iPhone-Einstellungen „System-Haptik“ eingeschaltet ist.

/** Ein kurzes Tippen. pattern: Dauer/Muster für Geräte mit navigator.vibrate (Android) */
export function haptic(pattern = 12) {
  try {
    if (typeof navigator.vibrate === 'function' && !/iPhone|iPad/.test(navigator.userAgent)) {
      navigator.vibrate(pattern);
      return;
    }
    const label = document.createElement('label');
    label.ariaHidden = 'true';
    label.style.display = 'none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.appendChild(input);
    document.head.appendChild(label);
    label.click();
    document.head.removeChild(label);
  } catch {
    /* nicht unterstützt */
  }
}

/** Mehrere Tipper hintereinander (z. B. beim Erreichen des Zielgewichts) */
export function hapticBurst(times = 3, gap = 110) {
  if (typeof navigator.vibrate === 'function' && !/iPhone|iPad/.test(navigator.userAgent)) return haptic(Array.from({ length: times * 2 - 1 }, (_, i) => (i % 2 ? gap : 18)));
  haptic();
  for (let i = 1; i < times; i++) setTimeout(() => haptic(), i * gap);
}
