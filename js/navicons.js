// Menü-Symbole als Vektorgrafik (nachgezeichnet nach der Vorlage) – scharf in jeder Größe,
// ohne Hintergrund, funktionieren im hellen und dunklen Modus.
const CREAM = '#fbf7ea';
const CREAM_2 = '#efe9d6';
export const NAV_ICONS = {
  woche: `<svg viewBox="0 0 48 48" aria-hidden="true">
    <defs><linearGradient id="ni-w" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#2f8a57"/><stop offset="1" stop-color="#17603c"/></linearGradient></defs>
    <rect x="4.5" y="7" width="27" height="34" rx="6" transform="rotate(-9 18 24)" fill="url(#ni-w)"/>
    <rect x="11" y="8.5" width="32" height="34.5" rx="7" fill="${CREAM}"/>
    <circle cx="18.6" cy="17.6" r="2.9" fill="#1f6b45"/><rect x="24.2" y="15.4" width="13.6" height="4.4" rx="2.2" fill="#e5ebd5"/>
    <circle cx="18.6" cy="25.8" r="2.9" fill="#a8cd8b"/><rect x="24.2" y="23.6" width="13.6" height="4.4" rx="2.2" fill="#e5ebd5"/>
    <circle cx="18.6" cy="34" r="2.9" fill="#a8cd8b"/><rect x="24.2" y="31.8" width="13.6" height="4.4" rx="2.2" fill="#e5ebd5"/>
  </svg>`,
  rezepte: `<svg viewBox="0 0 48 48" aria-hidden="true">
    <defs>
      <linearGradient id="ni-k1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f8a57"/><stop offset="1" stop-color="#17603c"/></linearGradient>
      <linearGradient id="ni-k2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8cc06a"/><stop offset="1" stop-color="#4f9a45"/></linearGradient>
    </defs>
    <rect x="21" y="3.5" width="5" height="6" rx="1" fill="#e2d3ad"/><rect x="28" y="4.5" width="5" height="5" rx="1" fill="#8cc06a"/>
    <rect x="15" y="7" width="28.5" height="34" rx="4.5" fill="${CREAM_2}"/>
    <rect x="41" y="17" width="3.6" height="6" rx="1.2" fill="#d9663f"/><rect x="41" y="27" width="3.6" height="5.5" rx="1.2" fill="#5c9d6b"/>
    <rect x="6" y="8" width="13" height="35" rx="4.5" fill="url(#ni-k1)"/>
    <rect x="12.5" y="8" width="1.3" height="35" fill="#4a9a68" opacity="0.7"/>
    <rect x="15.5" y="8.5" width="25" height="33.5" rx="4" fill="${CREAM}"/>
    <path d="M14 41.5l.6 5.5 1.4-1.4 1.4 1.4.6-5.5z" fill="#1f6b45"/>
    <path d="M25 18.5c-1.6-1.6 1.6-2.6 0-4.4M28.5 18c-1.4-1.4 1.4-2.3 0-3.9" stroke="#9cbf9a" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    <circle cx="27" cy="21.4" r="1.4" fill="#1f6b45"/>
    <path d="M20.2 25.8c0-2.8 3-4.4 6.8-4.4s6.8 1.6 6.8 4.4z" fill="#1f6b45"/>
    <path d="M19.6 26.8h14.8v4.6a4.4 4.4 0 0 1-4.4 4.4h-6a4.4 4.4 0 0 1-4.4-4.4z" fill="#1f6b45"/>
    <rect x="17.6" y="27.4" width="3" height="2.2" rx="1.1" fill="#1f6b45"/><rect x="33.4" y="27.4" width="3" height="2.2" rx="1.1" fill="#1f6b45"/>
    <path d="M31 39.5c-.3-3 1.8-5.2 5.8-5.6.2 3.4-2 5.4-5.8 5.6z" fill="url(#ni-k2)"/>
    <path d="M28.6 39.6c-2.2-.2-3.6-1.7-3.6-3.9 2.5.1 3.8 1.6 3.6 3.9z" fill="#8cc06a"/>
  </svg>`,
  einkauf: `<svg viewBox="0 0 48 48" aria-hidden="true">
    <defs>
      <linearGradient id="ni-e1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2e7d4f"/><stop offset="1" stop-color="#1b5e3a"/></linearGradient>
      <linearGradient id="ni-e2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8cc06a"/><stop offset="1" stop-color="#4f9a45"/></linearGradient>
      <radialGradient id="ni-e3" cx="0.38" cy="0.35" r="0.7"><stop offset="0" stop-color="#ef7a4f"/><stop offset="1" stop-color="#c8361c"/></radialGradient>
    </defs>
    <path d="M7 22c-1-6 3-11 9-11 2 4 0 9-3 12z" fill="url(#ni-e1)"/>
    <path d="M15 23c-2-8 2-15 8-17 3 5 3 12-1 17z" fill="url(#ni-e2)"/>
    <path d="M17.5 22.5c1.5-4 3-8 4.5-13" stroke="#e8f1dc" stroke-width="1" fill="none" stroke-linecap="round"/>
    <circle cx="31" cy="20" r="8.2" fill="url(#ni-e3)"/>
    <path d="M31 11.2l1.6 2.6 2.9-.9-1.2 2.7 2.4 1.7-3 .2-.7 2.9-2-2.2-2 2.2-.7-2.9-3-.2 2.4-1.7-1.2-2.7 2.9.9z" fill="#2f7d47"/>
    <rect x="5" y="21.5" width="38" height="5.5" rx="2.75" fill="${CREAM}"/>
    <path d="M7.5 26.5h33l-3 13.2a3.5 3.5 0 0 1-3.4 2.8H13.9a3.5 3.5 0 0 1-3.4-2.8z" fill="${CREAM}"/>
    <path d="M7.5 26.5h33l-.5 2.2h-32z" fill="${CREAM_2}"/>
    <rect x="15" y="30" width="2.6" height="8" rx="1.3" fill="#d8d1bd"/><rect x="20.7" y="30" width="2.6" height="8" rx="1.3" fill="#d8d1bd"/>
    <rect x="26.4" y="30" width="2.6" height="8" rx="1.3" fill="#d8d1bd"/><rect x="32.1" y="30" width="2.6" height="8" rx="1.3" fill="#d8d1bd"/>
  </svg>`,
  rueckblick: `<svg viewBox="0 0 48 48" aria-hidden="true">
    <defs>
      <linearGradient id="ni-r1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f8a57"/><stop offset="1" stop-color="#17603c"/></linearGradient>
      <linearGradient id="ni-r2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8cc06a"/><stop offset="1" stop-color="#4f9a45"/></linearGradient>
    </defs>
    <path d="M30 6.5c7.5 0 13.5 5.6 13.5 12.6 0 4.2-2.2 7.9-5.6 10.2l1.6 6.2-6.6-4.1c-1 .2-1.9.3-2.9.3-7.5 0-13.5-5.6-13.5-12.6S22.5 6.5 30 6.5z" fill="url(#ni-r1)"/>
    <path d="M19.5 12.5c8.3 0 15 6 15 13.4s-6.7 13.4-15 13.4c-1.6 0-3.2-.2-4.6-.7L7.2 42l2.2-7c-3.1-2.4-5-5.8-5-9.6 0-7.4 6.8-12.9 15.1-12.9z" fill="${CREAM}"/>
    <path d="M19.5 33.2l-6.3-5.9c-1.8-1.7-1.9-4.5-.2-6.2 1.6-1.6 4.1-1.6 5.6 0l.9.9.9-.9c1.5-1.6 4-1.6 5.6 0 1.7 1.7 1.6 4.5-.2 6.2z" fill="url(#ni-r2)"/>
  </svg>`,
  einstellungen: `<svg viewBox="0 0 48 48" aria-hidden="true">
    <defs><linearGradient id="ni-s1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8cc06a"/><stop offset="1" stop-color="#2e7d4f"/></linearGradient></defs>
    <circle cx="21" cy="21" r="17" fill="${CREAM}"/>
    <rect x="9.5" y="15.2" width="23" height="3" rx="1.5" fill="#e3dfcf"/><rect x="9.5" y="15.2" width="13" height="3" rx="1.5" fill="#5c9d6b"/>
    <circle cx="23" cy="16.7" r="4" fill="#1f6b45"/>
    <rect x="9.5" y="24.8" width="23" height="3" rx="1.5" fill="#e3dfcf"/><rect x="9.5" y="24.8" width="7" height="3" rx="1.5" fill="#a8cd8b"/>
    <circle cx="16.5" cy="26.3" r="4" fill="#a8cd8b"/>
    <path d="M26 44c-1.5-9.5 4.5-17.5 18-20.5 1.2 11-5.3 19.3-18 20.5z" fill="url(#ni-s1)"/>
    <path d="M28.5 41.5c3-6 7-10.5 12-14" stroke="#eef5e4" stroke-width="1.3" fill="none" stroke-linecap="round"/>
  </svg>`,
};
