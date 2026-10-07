// Küchengeschirr je Schritt: Was wird an welcher Stelle gebraucht (Topf, Pfanne, Schüssel …)?
// Eingebaute Rezepte haben die Angabe in steps[].tools. Für eigene/KI-Rezepte ohne Angabe
// wird sie aus dem Text abgeleitet. Jedes Teil steht nur bei dem Schritt, in dem es zuerst gebraucht wird.

// Reihenfolge = Priorität: Spezielles vor Allgemeinem
const RULES = [
  ['Wok', /\bwok\b/i],
  ['Auflaufform', /auflaufform|ofenform/i],
  ['Backform', /backform|springform|kastenform|\bin eine (kleine )?form\b/i],
  ['Backblech', /\bblech/i],
  ['großer Topf', /großen topf|nudelwasser|salzwasser|spaghetti (ins|in|kochen)|nudeln (ins|in reichlich|kochen)|reichlich wasser/i],
  ['kleiner Topf', /kleinen topf|reis (auf|garen|kochen|mit)|bulgur|quinoa|couscous|porridge|haferflocken mit milch|eier? .*kochen|milch .*(erwärm|aufkoch)/i],
  ['Topf', /\btopf\b|köcheln|aufkochen/i],
  ['Pfanne', /pfanne|braten|anbraten|andünsten|dünsten|anschwitzen|rösten|ausbacken/i],
  ['Schüssel', /schüssel|verrühren|verquirlen|vermengen|vermischen|marinieren|anmachen|zerdrücken|glatt rühren/i],
  ['Glas', /\bglas\b/i],
  ['Sieb', /abgießen|\bsieb\b/i],
  ['Stabmixer', /stabmixer|pürieren|mixer/i],
  ['Reibe', /\breiben|gerieben|raspeln|geraspelt|abrieb/i],
  ['Shaker', /shaker/i],
];

/** Teile, die im Text eines Schritts erwähnt/benötigt werden */
export function detectStepTools(text) {
  const out = [];
  for (const [name, re] of RULES) {
    if (!re.test(text)) continue;
    // „Topf“ nicht doppelt, wenn schon ein großer/kleiner Topf erkannt wurde
    if (name === 'Topf' && out.some((t) => /topf/i.test(t))) continue;
    out.push(name);
  }
  return out;
}

/** Je Schritt die neu benötigten Teile, z. B. [['großer Topf'], [], ['Pfanne'] …] */
export function stepTools(recipe) {
  const steps = recipe?.steps || [];
  if (steps.some((s) => Array.isArray(s.tools))) return steps.map((s) => s.tools || []);
  const seen = new Set();
  return steps.map((s) => {
    const t = detectStepTools(s.t || '').filter((x) => {
      // ein „Topf“ ist derselbe wie ein vorher erkannter großer/kleiner Topf
      const key = /topf/i.test(x) && [...seen].some((y) => /topf/i.test(y)) && x === 'Topf' ? 'Topf*' : x;
      if (seen.has(x) || key === 'Topf*') return false;
      seen.add(x);
      return true;
    });
    return t;
  });
}

/** Alle Teile eines Rezepts in der Reihenfolge, in der sie gebraucht werden */
export const allTools = (recipe) => stepTools(recipe).flat();
