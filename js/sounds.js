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

/** Rauschen mit wanderndem Filter – der „Swoosh“ */
function swoosh(at, dur, [f0, f1], vol = 0.16) {
  const t = ctx.currentTime + at;
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(f0, t);
  bp.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.85);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + dur * 0.45);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(gain).connect(ctx.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/** Funkeln: viele kurze, hohe Glöckchen in einer Tonleiter */
function sparkle(at, notes, step = 0.05, vol = 0.07) {
  notes.forEach((f, i) => {
    tone(f, at + i * step, 0.35, { type: 'sine', vol });
    tone(f * 2.01, at + i * step + 0.01, 0.2, { type: 'sine', vol: vol * 0.35 }); // leicht verstimmter Oberton = Glitzern
  });
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
  /** Kochmodus beginnt: zwei sanfte Löffel-Klopfer, dann der weiche Dreiklang */
  cookStart: () =>
    play(() => {
      [0, 0.11].forEach((t) => tone([720, 420], t, 0.08, { vol: 0.14 })); // weiches Holz-„Tok“
      [C5, E5, G5].forEach((f, i) => tone(f, 0.26 + i * 0.1, 0.32, { type: 'triangle', vol: 0.13 }));
    }),
  /** Gericht fertig: nur die Eieruhr – helles Rasseln, das langsam ausklingt */
  cookDone: () =>
    play(() => {
      for (let i = 0; i < 22; i++) {
        const fade = 1 - i / 26;
        tone(i % 2 ? 2349 : 2093, i * 0.038, 0.07, { type: 'triangle', vol: 0.11 * fade });
      }
    }),
  /** Aufwendiges Gericht: magischer Swoosh mit Glitzern statt Kochlöffel */
  magicStart: () =>
    play(() => {
      swoosh(0, 0.7, [350, 4200], 0.14);
      sparkle(0.28, [C6, 1174.7, E6, 1568, 1760, 2093], 0.055, 0.06);
      [C5, G5, E6].forEach((f, i) => tone(f, 0.55 + i * 0.02, 0.9, { type: 'triangle', vol: 0.07 }));
    }),
  /** Aufwendiges Gericht fertig: verzauberte Eieruhr – Rasseln, das in Glöckchen übergeht */
  magicDone: () =>
    play(() => {
      for (let i = 0; i < 16; i++) {
        const fade = 1 - i / 20;
        tone(i % 2 ? 2349 : 2093, i * 0.038, 0.07, { type: 'triangle', vol: 0.09 * fade });
      }
      swoosh(0.5, 0.6, [1800, 6000], 0.06);
      sparkle(0.62, [G6, E6, C6 * 2, G6 * 1.5, C6 * 2.5], 0.07, 0.06);
      tone([C6, C6 * 2], 0.95, 1.1, { type: 'sine', vol: 0.05 });
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
