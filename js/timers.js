// Mehrere parallele Koch-Timer mit Signalton. Endzeitpunkte werden gespeichert, damit Timer
// ein Neuladen der App überstehen.
// Gesperrtes iPhone: iOS hält Web-Apps im Hintergrund an. Deshalb wird beim Sperren eine
// Audiodatei abgespielt, die bis zum Timer-Ende still ist und dann klingelt – Audio läuft
// (wie Musik) auch bei gesperrtem Bildschirm weiter.
import { store } from './storage.js';
import { setAudioSession, sound, unlockAudio } from './sounds.js';

export { unlockAudio };

export function beep(times = 3) {
  sound.alarm(times);
  try {
    navigator.vibrate?.([300, 150, 300, 150, 300]);
  } catch {
    /* ignorieren */
  }
}

export class TimerManager {
  constructor(onChange) {
    this.onChange = onChange;
    this.timers = store.get('timers', []);
    this.interval = null;
    this.alarmInterval = null;
    this.ensureTicking();
  }
  save() {
    store.set('timers', this.timers);
  }
  start(label, seconds, context = '', theme = '') {
    unlockAudio();
    unlockBackgroundAudio();
    const t = { id: Math.random().toString(36).slice(2, 9), label, context, theme, duration: seconds, end: Date.now() + seconds * 1000, paused: null, done: false };
    this.timers.push(t);
    this.save();
    this.ensureTicking();
    this.onChange?.();
    return t;
  }
  remaining(t) {
    if (t.done) return 0;
    if (t.paused != null) return t.paused;
    return Math.max(0, Math.round((t.end - Date.now()) / 1000));
  }
  toggle(id) {
    const t = this.timers.find((x) => x.id === id);
    if (!t || t.done) return;
    if (t.paused != null) {
      t.end = Date.now() + t.paused * 1000;
      t.paused = null;
    } else {
      t.paused = this.remaining(t);
    }
    this.save();
    this.onChange?.();
  }
  add(id, seconds) {
    const t = this.timers.find((x) => x.id === id);
    if (!t) return;
    if (t.done) {
      t.done = false;
      t.end = Date.now() + seconds * 1000;
    } else if (t.paused != null) t.paused += seconds;
    else t.end += seconds * 1000;
    this.save();
    this.ensureTicking();
    this.onChange?.();
  }
  remove(id) {
    this.timers = this.timers.filter((x) => x.id !== id);
    this.save();
    this.updateAlarm();
    this.onChange?.();
  }
  ensureTicking() {
    if (this.interval) return;
    this.interval = setInterval(() => this.tick(), 500);
  }
  tick() {
    let changed = false;
    for (const t of this.timers) {
      if (!t.done && t.paused == null && t.end <= Date.now()) {
        t.done = true;
        changed = true;
        this.notify(t);
      }
    }
    if (changed) {
      this.save();
      this.updateAlarm();
    }
    this.onChange?.(true);
    if (!this.timers.length) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
  updateAlarm() {
    const ringing = this.timers.some((t) => t.done);
    if (ringing && !this.alarmInterval) {
      beep();
      this.alarmInterval = setInterval(() => beep(), 4000);
    } else if (!ringing && this.alarmInterval) {
      clearInterval(this.alarmInterval);
      this.alarmInterval = null;
    }
  }
  async notify(t) {
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        const reg = await navigator.serviceWorker?.getRegistration();
        reg?.showNotification('⏰ Timer fertig', { body: `${t.label}${t.context ? ' – ' + t.context : ''}`, tag: 'timer-' + t.id });
      }
    } catch {
      /* ignorieren */
    }
  }
}

// --- Klingeln bei gesperrtem Bildschirm -----------------------------------------

const RATE = 4000; // 4 kHz, 8 Bit mono: klein genug für lange Timer, reicht für Pieptöne
const ALARM_SEC = 40;
let bgAudio = null;
let bgUrl = null;

function audioEl() {
  if (!bgAudio) {
    bgAudio = new Audio();
    bgAudio.preload = 'auto';
    bgAudio.setAttribute('playsinline', '');
  }
  return bgAudio;
}

/** Einmal durch einen Tipp abspielen, damit iOS das spätere Abspielen im Hintergrund erlaubt */
function unlockBackgroundAudio() {
  try {
    const a = audioEl();
    if (a.dataset.unlocked) return;
    a.src = URL.createObjectURL(wav(new Uint8Array(RATE / 10).fill(128)));
    a.play().then(() => {
      a.pause();
      a.dataset.unlocked = '1';
    }, () => {});
  } catch {
    /* egal */
  }
}

function wav(samples) {
  const buf = new ArrayBuffer(44 + samples.length);
  const v = new DataView(buf);
  const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, 'data');
  v.setUint32(40, samples.length, true);
  new Uint8Array(buf, 44).set(samples);
  return new Blob([buf], { type: 'audio/wav' });
}

/** Stille bis zu jedem Timer-Ende, dort jeweils lautes Klingeln */
function alarmTrack(ends) {
  const total = Math.min(90 * 60, Math.max(...ends) + ALARM_SEC);
  const s = new Uint8Array(Math.ceil(total * RATE)).fill(128);
  for (const end of ends) {
    for (let t = end; t < Math.min(total, end + ALARM_SEC); t += 0.75) {
      for (const [off, f] of [[0, 880], [0.2, 1175]]) {
        const a = Math.floor((t + off) * RATE);
        const n = Math.floor(0.17 * RATE);
        for (let i = 0; i < n && a + i < s.length; i++) s[a + i] = Math.floor((i * f * 2) / RATE) % 2 ? 250 : 6; // Rechteck, volle Lautstärke
      }
    }
  }
  return wav(s);
}

/** Beim Sperren/Verlassen: Klingel-Spur für laufende Timer starten; beim Zurückkommen stoppen */
export function watchBackground(manager) {
  document.addEventListener('visibilitychange', () => {
    const a = audioEl();
    if (document.visibilityState === 'hidden') {
      const ends = manager.timers.filter((t) => !t.done && t.paused == null).map((t) => Math.max(0, (t.end - Date.now()) / 1000));
      if (!ends.length) return;
      try {
        if (bgUrl) URL.revokeObjectURL(bgUrl);
        bgUrl = URL.createObjectURL(alarmTrack(ends));
        setAudioSession('playback');
        a.src = bgUrl;
        if ('mediaSession' in navigator && window.MediaMetadata) {
          const next = manager.timers.find((t) => !t.done && t.paused == null);
          navigator.mediaSession.metadata = new MediaMetadata({ title: `⏱️ ${next?.label || 'Timer'}`, artist: 'Mise – Timer läuft' });
        }
        a.play().catch(() => {});
      } catch {
        /* nicht möglich */
      }
    } else if (!a.paused || bgUrl) {
      a.pause();
      if (bgUrl) URL.revokeObjectURL(bgUrl);
      bgUrl = null;
      setAudioSession('ambient');
    }
  });
}

export function fmtTime(sec, padMinutes = false) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h || padMinutes ? String(m).padStart(2, '0') : m;
  return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
}

// --- Bildschirm anlassen (Kochmodus) -----------------------------------------

let wakeLock = null;
let wantWake = false;

export async function keepAwake(on) {
  wantWake = on;
  try {
    if (on && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener?.('release', () => (wakeLock = null));
      return true;
    }
    if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    return false;
  }
  return 'wakeLock' in navigator;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wantWake && !wakeLock) keepAwake(true);
  });
}
