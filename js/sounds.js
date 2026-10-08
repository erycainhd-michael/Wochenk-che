// Kurze, synthetische Soundeffekte (keine Dateien).
// • Kleine Töne (Abhaken, Start …) laufen über Web Audio.
// • Wichtige Töne (Timer-Alarm, „Fertig“ im Kochmodus) werden einmal als kleine WAV-Datei berechnet
//   und über ein <audio>-Element abgespielt: So spielt iOS sie zuverlässig, laut und auch über Kopfhörer.
// iOS gibt Audio erst nach einer Berührung frei und hält es im Hintergrund an. Deshalb wird bei
// jeder Berührung geprüft, ob Audio läuft, und es wird bei Bedarf wieder eingeschaltet.

let ctx = null;
let enabled = true;
let media = null;
let mediaReady = false;

export function setSoundsEnabled(on) {
  enabled = on !== false;
}

/** Bei jeder Berührung aufrufen: Audio anlegen bzw. nach Pause/Hintergrund wieder einschalten. */
export function unlockAudio() {
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      // stiller Puffer entsperrt die Wiedergabe auf iOS
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    }
    if (ctx.state !== 'running') ctx.resume();
  } catch {
    /* kein Audio verfügbar */
  }
  // <audio>-Element einmal durch die Berührung freischalten (kurze Stille abspielen)
  if (!mediaReady) {
    try {
      media ||= new Audio();
      media.setAttribute('playsinline', '');
      media.src = wavUrl('silence', () => ({ dur: 0.05, events: [] }));
      const p = media.play();
      if (p?.then) p.then(() => ((mediaReady = true), media.pause()), () => {});
      else mediaReady = true;
    } catch {
      /* egal */
    }
  }
}

// --- Töne als WAV berechnen (für die lauten, wichtigen Töne) --------------------

const RATE = 22050;
const wavCache = new Map();

/** events: [{ f | [f0, f1], at, dur, type, vol }] → Float32-Samples, auf volle Lautstärke normiert */
function renderEvents(events, dur) {
  const n = Math.ceil(dur * RATE);
  const out = new Float32Array(n);
  for (const ev of events) {
    const [f0, f1] = Array.isArray(ev.f) ? ev.f : [ev.f, ev.f];
    const start = Math.floor(ev.at * RATE);
    const len = Math.floor(ev.dur * RATE);
    let phase = 0;
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / RATE;
      const g = Math.min(1, t / (ev.dur * 0.6));
      const f = f0 * Math.pow(f1 / f0, g);
      phase += f / RATE;
      const x = phase % 1;
      const w = ev.type === 'square' ? (x < 0.5 ? 1 : -1) * 0.6 : ev.type === 'triangle' ? 1 - 4 * Math.abs(x - 0.5) : Math.sin(2 * Math.PI * x);
      const env = Math.min(1, t / 0.008) * Math.exp((-6.9 * t) / ev.dur);
      out[start + i] += w * env * (ev.vol ?? 1);
    }
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < n; i++) out[i] = (out[i] / peak) * 0.95;
  return out;
}

function wavUrl(name, build) {
  if (wavCache.has(name)) return wavCache.get(name);
  const { dur, events } = build();
  const samples = renderEvents(events, dur);
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  wavCache.set(name, url);
  return url;
}

/** Wichtigen Ton laut über das <audio>-Element abspielen; ohne Freigabe über Web Audio */
function playLoud(name, build, fallback) {
  try {
    if (media && mediaReady) {
      media.src = wavUrl(name, build);
      media.currentTime = 0;
      const p = media.play();
      if (p?.catch) p.catch(() => play(fallback, true));
      return;
    }
  } catch {
    /* weiter mit Web Audio */
  }
  play(fallback, true);
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
    if (ctx.state !== 'running') ctx.resume();
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
  /** Gericht fertig: nur die Eieruhr – helles Rasseln, das ausklingt */
  cookDone: () => playLoud('cookDone', eggTimer, () => eggTimer().events.forEach((x) => tone(x.f, x.at, x.dur, { type: x.type, vol: x.vol * 0.5 }))),
  /** Aufwendiges Gericht: magischer Swoosh mit Glitzern statt Kochlöffel */
  magicStart: () =>
    play(() => {
      swoosh(0, 0.7, [350, 4200], 0.14);
      sparkle(0.28, [C6, 1174.7, E6, 1568, 1760, 2093], 0.055, 0.06);
      [C5, G5, E6].forEach((f, i) => tone(f, 0.55 + i * 0.02, 0.9, { type: 'triangle', vol: 0.07 }));
    }),
  /** Besonderes Gericht fertig: Eieruhr, deren Rasseln aufsteigt und in einen kurzen Zauberklang übergeht */
  magicDone: () => playLoud('magicDone', magicTimer, () => magicTimer().events.forEach((x) => tone(x.f, x.at, x.dur, { type: x.type, vol: x.vol * 0.4 }))),
  /** Gewicht in Richtung Ziel: zwei weiche Töne aufwärts */
  progress: () => play(() => [E5, A5].forEach((f, i) => tone(f, i * 0.12, 0.3, { type: 'triangle', vol: 0.12 }))),
  /** Einkauf komplett: kurzer, heller Akkord mit Funkeln */
  allDone: () =>
    play(() => {
      [C5, E5, G5, C6].forEach((f, i) => tone(f, i * 0.06, 0.4, { type: 'triangle', vol: 0.11 }));
      sparkle(0.3, [E6, G6, C6 * 2], 0.06, 0.05);
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
  alarm: () => playLoud('alarm', alarmBeeps, () => alarmBeeps().events.forEach((x) => tone(x.f, x.at, x.dur, { type: x.type, vol: 0.5 }))),
};

// --- Die wichtigen Töne als Ereignislisten ----------------------------------------

/** Eieruhr: 18 schnelle Klicker, abwechselnd zwei helle Töne, leiser werdend */
function eggTimer() {
  const events = [];
  for (let i = 0; i < 18; i++) events.push({ f: i % 2 ? 2349 : 2093, at: i * 0.038, dur: 0.07, type: 'triangle', vol: 1 - i / 22 });
  return { dur: 0.85, events };
}

/** Zauber-Eieruhr: kurzes Rasseln, das ansteigt und in einen hellen Glockenklang gleitet (ca. 1 s) */
function magicTimer() {
  const events = [];
  for (let i = 0; i < 10; i++) events.push({ f: (i % 2 ? 2349 : 2093) * (1 + i * 0.03), at: i * 0.036, dur: 0.07, type: 'triangle', vol: 0.9 });
  events.push({ f: [2093, 3136], at: 0.36, dur: 0.6, type: 'sine', vol: 0.7 });
  [2637, 3136, 4186].forEach((f, i) => events.push({ f, at: 0.46 + i * 0.07, dur: 0.35, type: 'sine', vol: 0.35 }));
  return { dur: 1.1, events };
}

/** Timer-Alarm: drei Doppelpieper */
function alarmBeeps() {
  const events = [];
  for (let i = 0; i < 3; i++) for (const [o, f] of [[0, 880], [0.18, 1175]]) events.push({ f, at: i * 0.7 + o, dur: 0.16, type: 'square', vol: 1 });
  return { dur: 2.2, events };
}
