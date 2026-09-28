# Common Voice 17 (турецкий, CC0, зеркало ysdede/commonvoice_17_tr_fixed без входа): сколько фраз тренажёра
# и сколько коротких фраз по темам записаны носителями. Читается только колонка текста (без звука) — быстро.
import json, re, sys, time
from huggingface_hub import HfFileSystem
import pyarrow.parquet as pq

OUT = sys.argv[1] if len(sys.argv) > 1 else 'shots'
DS = 'datasets/ysdede/commonvoice_17_tr_fixed'
src = open('index.html', encoding='utf-8').read()
phrases = re.findall(r'\{ tr:"([^"]+)", tl:', src)

def norm(t):
    t = t.replace('I', 'ı').replace('İ', 'i').lower()
    t = re.sub(r"[^\w\s]", ' ', t)
    return re.sub(r'\s+', ' ', t).strip()

KW = {'hotel': ['otel', 'oda', 'odada', 'anahtar', 'rezervasyon', 'kahvaltı', 'havlu'],
      'food': ['yemek', 'hesap', 'çay', 'kahve', 'su', 'ekmek', 'restoran', 'menü', 'lokanta'],
      'transport': ['otobüs', 'tren', 'bilet', 'taksi', 'istasyon', 'uçak', 'yol', 'durak'],
      'shop': ['fiyat', 'para', 'ucuz', 'pahalı', 'kaç', 'lira', 'pazar'],
      'health': ['ilaç', 'doktor', 'hasta', 'ağrı', 'hastane', 'eczane', 'ateş'],
      'greet': ['merhaba', 'günaydın', 'teşekkür', 'teşekkürler', 'lütfen', 'nasılsın', 'görüşürüz', 'hoş']}
want = {norm(p): p for p in phrases}
t0 = time.time()
fs = HfFileSystem()
files = sorted(fs.glob(DS + '/**/*.parquet'))
seen, total, exact, topics = set(), 0, {}, {k: {'n': 0, 'sample': []} for k in KW}
for f in files:
    pf = pq.ParquetFile(fs.open(f))
    cols = [c for c in ['transcription', 'up_votes', 'down_votes'] if c in pf.schema_arrow.names]
    for rg in range(pf.num_row_groups):
        tb = pf.read_row_group(rg, columns=cols).to_pydict()
        for i, t in enumerate(tb['transcription']):
            n = norm(t or '')
            if not n or n in seen: continue
            seen.add(n); total += 1
            if n in want: exact[want[n]] = t
            ws = n.split(' ')
            if len(ws) <= 8:
                for k, kws in KW.items():
                    if any(w in ws for w in kws):
                        topics[k]['n'] += 1
                        if len(topics[k]['sample']) < 12: topics[k]['sample'].append(t)
res = {'files': [f.split('/')[-1] for f in files], 'uniqueSentences': total, 'ourPhrases': len(phrases),
       'exact': len(exact), 'exactList': list(exact.keys()), 'topics': topics, 'seconds': round(time.time() - t0)}
import os; os.makedirs(OUT, exist_ok=True)
json.dump(res, open(f'{OUT}/cv.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps(res, ensure_ascii=False)[:3000])
