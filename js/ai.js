// Optionales KI-Modul: erfindet Rezepte mit Claude. Kostet pro Rezept ein paar Cent auf deinem
// eigenen Anthropic-Konto. Der API-Schlüssel bleibt nur auf diesem Gerät (localStorage).
// Das SDK wird erst geladen, wenn das Modul genutzt wird – die App bleibt sonst komplett offline-fähig.

const SDK_URL = 'https://esm.sh/@anthropic-ai/sdk';
const MODEL = 'claude-opus-5-5';

const PRINCIPLES = `Du entwickelst Rezepte für Michael (Muskelaufbau, ca. 2.800 kcal und 140 g Protein pro Tag).
Prinzipien: schnell und alltagstauglich, wenig Abwasch, jede Mahlzeit mit klarer Proteinquelle,
Gemüse/Obst und Ballaststoffe ausgewogen, gern Olivenöl, Nüsse, Fisch, Vollkorn. Genuss gehört dazu:
Pasta, Reis, Pizza, italienische Küche, Käse sind ausdrücklich erlaubt – ergänzen statt verbieten.
Er mag keine gekochten Möhren, gekochten Kohlrabi, Sellerie und klassische gekochte Bohnen.`;

function schema(ids) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'time', 'dishes', 'effort', 'mealPrep', 'protein', 'tags', 'ingredients', 'steps', 'tip'],
    properties: {
      name: { type: 'string' },
      time: { type: 'integer', description: 'Gesamtzeit in Minuten' },
      dishes: { type: 'integer', description: 'Teile Abwasch: Anzahl aller Teile aus steps[].tools' },
      effort: { type: 'integer', enum: [1, 2, 3] },
      mealPrep: { type: 'boolean', description: 'Schmeckt aufgewärmt am Folgetag (Lunchbox)' },
      protein: { type: 'string', description: 'Hauptproteinquelle, kurz' },
      tags: { type: 'array', items: { type: 'string' } },
      ingredients: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'g', 'note'],
          properties: {
            id: { type: 'string', enum: ids },
            g: { type: 'number', description: 'Gramm für EINE Portion' },
            note: { type: 'string', description: 'kurzer Hinweis oder leer' },
          },
        },
      },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['t', 'timer', 'label', 'tools'],
          properties: {
            t: { type: 'string' },
            tools: { type: 'array', items: { type: 'string' }, description: 'Küchengeschirr, das in diesem Schritt NEU gebraucht wird, z. B. „großer Topf“, „Pfanne“, „kleine Schüssel“, „Sieb“, „Backblech“ – sonst leer' },
            timer: { type: 'integer', description: 'Timer in Sekunden, 0 = kein Timer' },
            label: { type: 'string', description: 'kurzer Timer-Name oder leer' },
          },
        },
      },
      tip: { type: 'string', description: 'Ein Satz: warum das gut passt (ergänzen statt verbieten)' },
    },
  };
}

/**
 * Erfindet ein Rezept.
 * @param apiKey      Anthropic-API-Schlüssel
 * @param title       gewünschter Titel (leer = Claude wählt selbst ein neues Gericht)
 * @param type        'main' | 'breakfast'
 * @param ingredients Zutaten-Datenbank (nur diese Zutaten dürfen verwendet werden)
 * @param avoid       Namen bestehender Rezepte (für „etwas Neues“)
 * @param dislikes    Abneigungen
 */
export async function inventRecipe({ apiKey, title = '', type = 'main', ingredients, avoid = [], dislikes = [] }) {
  if (!apiKey) throw new Error('Für KI-Rezepte fehlt der API-Schlüssel (Einstellungen → KI-Rezepte).');
  const { default: Anthropic } = await import(SDK_URL);
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const usable = ingredients.filter((i) => !i.season || i.season.includes(new Date().getMonth() + 1));
  const list = usable.map((i) => `${i.id}: ${i.name}`).join('\n');
  const kind = type === 'breakfast' ? 'ein Frühstück (ca. 550 kcal, mind. 30 g Protein)' : 'ein Hauptgericht (ca. 800 kcal, mind. 40 g Protein, max. 30 Minuten)';
  const task = title
    ? `Erfinde ${kind} mit dem Titel „${title}“. Bleib nah am Titel.`
    : `Erfinde ${kind}, das NICHT in dieser Liste vorkommt und trotzdem gut zu Michael passt:\n${avoid.join('\n')}`;

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: schema(usable.map((i) => i.id)) } },
    system: `${PRINCIPLES}\nWeitere Abneigungen: ${dislikes.join(', ') || 'keine'}.\nAntworte auf Deutsch. Verwende ausschließlich Zutaten-IDs aus dieser Liste (Mengen für 1 Portion in Gramm):\n${list}`,
    messages: [{ role: 'user', content: task }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Die KI hat dieses Rezept abgelehnt. Versuch einen anderen Titel.');
  if (response.stop_reason === 'max_tokens') throw new Error('Die Antwort der KI war unvollständig. Bitte nochmal versuchen.');
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Keine Antwort von der KI erhalten.');
  return cleanRecipe(JSON.parse(text), type, ingredients);
}

/** Prüft und vereinheitlicht ein (KI- oder Nutzer-)Rezept. */
export function cleanRecipe(r, type, ingredients) {
  const ids = new Set(ingredients.map((i) => i.id));
  const clampInt = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Math.round(Number(v) || d)));
  // Abwasch = Anzahl der Teile, wenn das Geschirr je Schritt angegeben ist
  const toolCount = (r.steps || []).reduce((a, s) => a + (Array.isArray(s.tools) ? s.tools.filter((x) => String(x).trim()).length : 0), 0);
  if (toolCount) r = { ...r, dishes: toolCount };
  return {
    id: r.id || `u_${Date.now().toString(36)}`,
    name: String(r.name || 'Neues Rezept').trim(),
    type,
    time: clampInt(r.time, 1, 240, 20),
    dishes: clampInt(r.dishes, 0, 8, 1),
    effort: clampInt(r.effort, 1, 3, 1),
    mealPrep: !!r.mealPrep,
    tags: Array.isArray(r.tags) ? r.tags.slice(0, 6).map(String) : [],
    protein: String(r.protein || ''),
    ingredients: (r.ingredients || [])
      .filter((l) => ids.has(l.id) && Number(l.g) > 0)
      .map((l) => ({ id: l.id, g: Math.round(Number(l.g)), ...(l.note ? { note: String(l.note) } : {}) })),
    steps: (r.steps || [])
      .filter((s) => String(s.t || '').trim())
      .map((s) => ({
        t: String(s.t).trim(),
        ...(Number(s.timer) > 0 ? { timer: Math.round(Number(s.timer)), label: String(s.label || '').trim() || 'Timer' } : {}),
        ...(Array.isArray(s.tools) && s.tools.some((x) => String(x).trim()) ? { tools: s.tools.map((x) => String(x).trim()).filter(Boolean).slice(0, 6) } : {}),
      })),
    ...(r.tip ? { tip: String(r.tip) } : {}),
    source: r.source || 'eigen',
  };
}
