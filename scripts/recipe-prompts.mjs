// Schreibt images/recipes/PROMPTS.md: je Rezept ein Bild-Prompt im Stil des App-Icons.
// node scripts/recipe-prompts.mjs
import fs from 'node:fs';

const ing = JSON.parse(fs.readFileSync('data/ingredients.json', 'utf8'));
const rec = JSON.parse(fs.readFileSync('data/recipes.json', 'utf8')).recipes;
const name = Object.fromEntries(ing.items.map((i) => [i.id, i.name]));

export const STYLE =
  'Photorealistic overhead food photo, square-friendly 3:2 landscape (main subject centered so a square center crop works), ' +
  'served on a rich deep-green matte surface (#0e5a34, soft radial light from the upper left, dark vignette at the edges), ' +
  'warm natural studio light, soft shadow to the lower right, vivid fresh colors, glossy appetizing textures, ' +
  'a few scattered fresh herbs and spices as garnish, clean minimal composition, no text, no hands, no logos, high detail, ' +
  'same visual style as a premium iOS app icon of a meal-prep lunchbox.';

const lines = rec.map((r) => {
  const main = r.ingredients
    .filter((l) => l.id !== 'gewuerze' && !/oel|salz|pfeffer/.test(l.id))
    .sort((a, b) => b.g - a.g)
    .slice(0, 6)
    .map((l) => name[l.id] || l.id);
  const vessel = r.type === 'extra' ? 'as an appetizer on a small plate or board' : r.type === 'breakfast' ? 'in a ceramic bowl or on a plate' : r.type === 'snack' || r.type === 'addon' ? 'in a small bowl, glass or on a small plate' : 'on a ceramic plate or in a shallow bowl';
  return `## ${r.name}\nDatei: \`images/recipes/${r.id}.webp\`\n\n> ${STYLE} Dish: „${r.name}“ – ${main.join(', ')}, ${vessel}.\n`;
});
fs.writeFileSync(
  'images/recipes/PROMPTS.md',
  `# Rezeptbilder – Prompts\n\nJe Rezept ein Bild im Querformat 3:2 (z. B. 1536 × 1024). Fertige Bilder als \`<id>.png/.jpg/.webp\` in \`images/recipes/neu/\` legen und \`python3 scripts/recipe-images.py\` ausführen – das Skript verkleinert, wandelt in WebP um und trägt das Bild beim Rezept ein.\n\n${lines.join('\n')}`
);
console.log(`${rec.length} Prompts geschrieben`);
