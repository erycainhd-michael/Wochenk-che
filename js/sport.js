// Sport: zusätzlicher Kalorienverbrauch nach MET-Werten.
// Quelle: Compendium of Physical Activities (Ainsworth et al. 2011 / Adult Compendium 2024).
// MET je Intensität [leicht, mittel, intensiv].

export const SPORTS = [
  { id: 'laufen', name: 'Laufen / Joggen', icon: '🏃', met: [7.0, 9.8, 11.5], hint: ['ca. 8 km/h', 'ca. 10 km/h', 'ab ca. 11 km/h'] },
  { id: 'rad', name: 'Radfahren', icon: '🚴', met: [5.8, 8.0, 10.0], hint: ['gemütlich bis 16 km/h', '19–22 km/h', '22–25 km/h'] },
  { id: 'kraft', name: 'Krafttraining', icon: '🏋️', met: [3.5, 5.0, 6.0], hint: ['leichte Gewichte', 'normales Training', 'schwer, kurze Pausen'] },
  { id: 'schwimmen', name: 'Schwimmen', icon: '🏊', met: [6.0, 8.3, 10.0], hint: ['locker', 'Kraul, zügig', 'Kraul, schnell'] },
  { id: 'hiit', name: 'HIIT / Zirkeltraining', icon: '🔥', met: [4.3, 8.0, 9.0], hint: ['moderat', 'intensiv', 'sehr intensiv'] },
  { id: 'fussball', name: 'Fußball', icon: '⚽', met: [7.0, 8.0, 10.0], hint: ['locker kicken', 'Training', 'Spiel'] },
  { id: 'tennis', name: 'Tennis / Padel', icon: '🎾', met: [5.0, 7.3, 8.0], hint: ['Doppel', 'allgemein', 'Einzel'] },
  { id: 'basketball', name: 'Basketball', icon: '🏀', met: [6.0, 6.5, 8.0], hint: ['Körbe werfen', 'allgemein', 'Spiel'] },
  { id: 'wandern', name: 'Wandern', icon: '🥾', met: [5.3, 6.0, 7.8], hint: ['flach', 'hügelig', 'bergauf mit Rucksack'] },
  { id: 'gehen', name: 'Zügiges Gehen', icon: '🚶', met: [3.5, 4.3, 5.0], hint: ['ca. 5 km/h', 'ca. 6 km/h', 'ca. 7 km/h'] },
  { id: 'rudern', name: 'Rudern (Ergometer)', icon: '🚣', met: [4.8, 7.0, 8.5], hint: ['leicht', 'mittel', 'kräftig'] },
  { id: 'klettern', name: 'Klettern / Bouldern', icon: '🧗', met: [5.8, 7.3, 8.0], hint: ['leicht', 'mittel', 'schwer'] },
  { id: 'kampfsport', name: 'Kampfsport / Boxen', icon: '🥊', met: [5.3, 7.8, 10.3], hint: ['Technik', 'Training', 'Sparring'] },
  { id: 'tanzen', name: 'Tanzen', icon: '💃', met: [4.5, 5.5, 7.8], hint: ['langsam', 'allgemein', 'Aerobic / schnell'] },
  { id: 'yoga', name: 'Yoga / Pilates', icon: '🧘', met: [2.5, 3.0, 4.0], hint: ['Hatha', 'Pilates', 'Power-Yoga'] },
];
export const LEVELS = ['leicht', 'mittel', 'intensiv'];
export const sportById = (id) => SPORTS.find((s) => s.id === id) || SPORTS[0];

/**
 * Zusätzlich verbrannte kcal: (MET − 1) × kg × Stunden.
 * Der Ruheumsatz (1 MET) steckt schon im normalen Tagesziel, deshalb wird er abgezogen.
 */
export function sportKcal(sportId, level, minutes, kg) {
  const met = sportById(sportId).met[Math.max(0, Math.min(2, level))];
  return Math.round(((met - 1) * kg * Math.max(0, minutes)) / 60 / 5) * 5;
}

/** Summe der Sport-kcal eines Tages (structure.sport = { Tag: [Einträge] }) */
export const daySportKcal = (structure, d) => (structure?.sport?.[d] || []).reduce((a, x) => a + (x.kcal || 0), 0);
