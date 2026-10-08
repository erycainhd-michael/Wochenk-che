# Übernimmt Rezeptbilder: images/recipes/neu/<id>.(png|jpg|jpeg|webp) → images/recipes/<id>.webp (1200 × 800)
# und setzt im Rezept das Feld "img". python3 scripts/recipe-images.py
import json, pathlib
from PIL import Image

root = pathlib.Path(__file__).resolve().parent.parent
inbox = root / 'images/recipes/neu'
data_file = root / 'data/recipes.json'
data = json.loads(data_file.read_text())
by_id = {r['id']: r for r in data['recipes']}
done = 0
for f in sorted(inbox.glob('*')) if inbox.exists() else []:
    if f.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp') or f.stem not in by_id:
        print('übersprungen:', f.name)
        continue
    im = Image.open(f).convert('RGB')
    # auf 3:2 zuschneiden (mittig), dann 1200 × 800
    w, h = im.size
    if w / h > 1.5:
        nw = round(h * 1.5); im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = round(w / 1.5); im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    im = im.resize((1200, 800), Image.LANCZOS)
    out = root / f'images/recipes/{f.stem}.webp'
    im.save(out, quality=80, method=6)
    by_id[f.stem]['img'] = f'images/recipes/{f.stem}.webp'
    f.unlink()
    done += 1
    print('✓', f.stem)
# gleiches Format wie scripts/add-recipes.mjs: ein Rezept pro Zeile
compact = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':'))
data_file.write_text('{\n  "_info": ' + compact(data['_info']) + ',\n  "recipes": [\n' + ',\n'.join('    ' + compact(r) for r in data['recipes']) + '\n  ]\n}\n')
print(done, 'Bilder übernommen')
