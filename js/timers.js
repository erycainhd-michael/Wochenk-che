// Mehrere parallele Koch-Timer mit Signalton. Endzeitpunkte werden gespeichert, damit Timer
// ein Neuladen der App überstehen.
// Hinweis: iOS pausiert Web-Apps im Hintergrund – der Ton kommt, solange die App geöffnet ist.
import { store } from './storage.js';
import { sound, unlockAudio } from './sounds.js';

export { unlockAudio };

export function beep() {
  sound.alarm();
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
