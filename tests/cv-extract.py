# Вырезать из Common Voice 17 (турецкий, CC0) записи носителей для фраз тренажёра, которые там есть целиком.
# Результат: audio/cv/<n>.mp3 и audio/cv/index.json {фраза: [{file, votes}]} — лучшие по голосам, до 2 на фразу.
import json, re, sys, os
from huggingface_hub import HfFileSystem
import pyarrow.parquet as pq

OUT = sys.argv[1] if len(sys.argv) > 1 else 'audio/cv'
DS = 'datasets/ysdede/commonvoice_17_tr_fixed'
src = open('index.html', encoding='utf-8').read()
phrases = re.findall(r'\{ tr:"([^"]+)", tl:', src)
# фразы с озвучкой (подобраны из Common Voice и Tatoeba) — tests/voiced-phrases.json
if os.path.exists('tests/voiced-phrases.json'):
    vp = json.load(open('tests/voiced-phrases.json', encoding='utf-8'))
    phrases += [x['tr'] for lst in vp.values() for x in lst if x.get('cv')]
def norm(t):
    t = t.replace('I', 'ı').replace('İ', 'i').lower()
    return re.sub(r'\s+', ' ', re.sub(r"[^\w\s]", ' ', t)).strip()
want = {norm(p): p for p in phrases}
fs = HfFileSystem()
cands = {}
for f in sorted(fs.glob(DS + '/**/*.parquet')):
    pf = pq.ParquetFile(fs.open(f))
    names = pf.schema_arrow.names
    for rg in range(pf.num_row_groups):
        meta = pf.read_row_group(rg, columns=[c for c in ['transcription', 'up_votes', 'down_votes'] if c in names]).to_pydict()
        hits = [i for i, t in enumerate(meta['transcription']) if norm(t or '') in want]
        if not hits: continue
        audio = pf.read_row_group(rg, columns=['audio']).column('audio').to_pylist()
        for i in hits:
            ph = want[norm(meta['transcription'][i])]
            a = audio[i] or {}
            b = a.get('bytes')
            if not b: continue
            votes = (meta.get('up_votes') or [0] * len(hits))[i] - (meta.get('down_votes') or [0] * len(hits))[i]
            key = (ph, len(b))
            cands.setdefault(ph, {})[key] = (votes, b)
os.makedirs(OUT, exist_ok=True)
index, n = {}, 0
for ph, d in cands.items():
    best = sorted(d.values(), key=lambda x: -x[0])[:2]
    for votes, b in best:
        n += 1; name = f'{n:03d}.mp3'
        open(os.path.join(OUT, name), 'wb').write(b)
        index.setdefault(ph, []).append({'file': name, 'votes': votes})
json.dump({'source': 'Mozilla Common Voice 17 (tr), CC0 — зеркало huggingface.co/datasets/ysdede/commonvoice_17_tr_fixed', 'phrases': index}, open(os.path.join(OUT, 'index.json'), 'w'), ensure_ascii=False, indent=1)
print(len(index), 'фраз,', n, 'файлов')
