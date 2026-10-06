// Kurze, synthetische Soundeffekte (Web Audio, keine Dateien).
// iOS: Mit audioSession „ambient“ respektieren die Töne den Lautlos-Schalter und
// unterbrechen keine laufende Musik – mit Kopfhörern sind sie zu hören.

let ctx = null;
let enabled = true;

export function setSoundsEnabled(on) {
  enabled = on !== false;
}

/** Muss einmal durch eine Nutzer-Geste aufgerufen werden (iOS-Audio-Sperre). */
export function unlockAudio() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'ambient';
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    // stiller Puffer entsperrt die Wiedergabe auf iOS
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    /* kein Audio verfügbar */
  }
}

/** Einzelner weicher Ton: f = Frequenz (Hz) oder [von, bis] für ein kurzes Gleiten */
function tone(f, at, dur, { type = 'sine', vol = 0.18 } = {}) {
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  const [f0, f1] = Array.isArray(f) ? f : [f, f];
  osc.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function play(fn, force = false) {
  if (!enabled && !force) return;
  try {
    if (!ctx) unlockAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    fn();
  } catch {
    /* ignorieren */
  }
}

// Noten (Hz)
const C5 = 523.25, E5 = 659.25, G5 = 783.99, A5 = 880, C6 = 1046.5, E6 = 1318.5, G6 = 1568;

export const sound = {
  /** Abhaken auf der Einkaufsliste: kurzes „Plopp“ */
  check: () => play(() => tone([620, 980], 0, 0.09, { vol: 0.14 })),
  /** Häkchen wieder entfernen: leiser, abwärts */
  uncheck: () => play(() => tone([700, 480], 0, 0.08, { vol: 0.08 })),
  /** Timer gestartet: zwei helle Töne aufwärts */
  timerStart: () => play(() => [C6, G6].forEach((f, i) => tone(f, i * 0.09, 0.14, { vol: 0.12 }))),
  /** Kochmodus beginnt: Kochlöffel klopft dreimal an den Topf, dann ein kleines „Los geht's“ */
  cookStart: () =>
    play(() => {
      [0, 0.12, 0.24].forEach((t, i) => {
        tone([1100 - i * 60, 380], t, 0.07, { type: 'triangle', vol: 0.32 }); // Holz-„Tok“
        tone([2600, 2400], t, 0.03, { type: 'square', vol: 0.025 }); // kurzer Anschlag
      });
      tone([1318, 1325], 0.27, 0.35, { vol: 0.05 }); // leises Nachklingen vom Topf
      [C6, E6, G6].forEach((f, i) => tone(f, 0.46 + i * 0.07, 0.11, { type: 'square', vol: 0.045 }));
    }),
  /** Gericht fertig: Eieruhr rasselt kurz, dann ein Mikrowellen-„Ding!“ */
  cookDone: () =>
    play(() => {
      for (let i = 0; i < 12; i++) tone(i % 2 ? 2349 : 2093, i * 0.042, 0.05, { type: 'square', vol: 0.05 });
      tone(1760, 0.62, 1.4, { vol: 0.24 }); // Ding
      tone(4430, 0.62, 0.5, { vol: 0.035 }); // heller Glockenanteil
      tone(2637, 0.66, 0.9, { type: 'triangle', vol: 0.05 });
    }),
  /** Start-Jingle zur Blatt-Animation: kurzes, helles Arpeggio */
  jingle: () =>
    play(() => {
      [G5, C6, E6, G6].forEach((f, i) => tone(f, 0.05 + i * 0.075, 0.22, { type: 'triangle', vol: 0.11 }));
      tone(C6 * 2, 0.4, 0.5, { vol: 0.04 });
    }),
  /** Zielgewicht erreicht: kleine Fanfare */
  goal: () =>
    play(() => {
      [C5, E5, G5, C6, E6].forEach((f, i) => tone(f, i * 0.1, 0.45, { type: 'triangle', vol: 0.15 }));
      [G6, C6 * 2].forEach((f, i) => tone(f, 0.55 + i * 0.08, 0.3, { vol: 0.05 }));
    }),
  /** Timer abgelaufen (klingelt, bis er bestätigt wird) */
  alarm: (times = 3) =>
    play(() => {
      for (let i = 0; i < times; i++) for (const [o, f] of [[0, A5], [0.18, 1175]]) tone(f, i * 0.7 + o, 0.16, { vol: 0.5 });
    }, true),
};
