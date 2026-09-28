# Кандидаты в фразы тренажёра, у которых ЕСТЬ запись носителя:
#  1) Common Voice 17 (tr, CC0): короткие разговорные фразы (2–7 слов), без цифр и имён собственных;
#  2) Tatoeba: все турецкие фразы с записью под лицензией + русский перевод.
# Результат — candidates.json: из него фразы отбираются вручную по темам и переводятся.
import json, re, sys, os, time, urllib.request, urllib.parse
from huggingface_hub import HfFileSystem
import pyarrow.parquet as pq
OUT = sys.argv[1] if len(sys.argv) > 1 else 'cand'
os.makedirs(OUT, exist_ok=True)
def norm(t):
    t = t.replace('I', 'ı').replace('İ', 'i').lower()
    return re.sub(r'\s+', ' ', re.sub(r"[^\w\s]", ' ', t)).strip()
TALK = re.compile(r"\b(ben|sen|siz|biz|bana|sana|size|beni|seni|sizi|lütfen|teşekkür\w*|merhaba|günaydın|nerede|nereye|nasıl|ne kadar|kaç|var mı|yok|istiyorum|ister misin\w*|misiniz|musunuz|mısınız|müsünüz|miyim|mıyım|muyum|müyüm|bilmiyorum|anlamadım|evet|hayır|tamam|affedersiniz|pardon|hoş|görüşürüz|iyi|çok)\b")
fs = HfFileSystem(); seen = {}; t0 = time.time()
for f in sorted(fs.glob('datasets/ysdede/commonvoice_17_tr_fixed/**/*.parquet')):
    pf = pq.ParquetFile(fs.open(f)); names = pf.schema_arrow.names
    for rg in range(pf.num_row_groups):
        d = pf.read_row_group(rg, columns=[c for c in ['transcription', 'up_votes', 'down_votes'] if c in names]).to_pydict()
        for i, t in enumerate(d['transcription']):
            t = (t or '').strip(); n = norm(t); w = n.split(' ')
            if not (2 <= len(w) <= 7) or re.search(r'\d', t): continue
            if any(x[:1].isupper() for x in t.split(' ')[1:]): continue          # имена собственные в середине — новости
            if not (t.endswith('?') or t.endswith('!') or TALK.search(n)): continue
            v = (d.get('up_votes') or [0])[i] - (d.get('down_votes') or [0])[i]
            if n not in seen or seen[n]['votes'] < v: seen[n] = {'text': t, 'votes': v}
cv = sorted(seen.values(), key=lambda x: (len(x['text']), x['text']))
# Tatoeba: все турецкие фразы с записью, у которых есть лицензия
tat, after, pages = [], '', 0
while True:
    u = 'https://api.tatoeba.org/unstable/sentences?lang=tur&has_audio=yes&include=audios&showtrans:lang=rus&sort=created&limit=100' + after
    d = json.load(urllib.request.urlopen(u, timeout=30))
    for x in d.get('data', []):
        lic = [a for a in x.get('audios', []) if a.get('license')]
        if not lic: continue
        ru = ''
        def walk(v):
            global ru
            if ru: return
            if isinstance(v, list): [walk(y) for y in v]
            elif isinstance(v, dict):
                if v.get('lang') == 'rus' and v.get('text'): ru = v['text']
                else: [walk(y) for y in v.values()]
        walk(x.get('translations'))
        tat.append({'text': x['text'], 'ru': ru, 'audio': lic[0]['id'], 'author': lic[0].get('author'), 'license': lic[0].get('license')})
    nx = d.get('paging', {}).get('next')
    if not d.get('paging', {}).get('has_next') or not nx: break
    after = '&after=' + urllib.parse.quote(urllib.parse.parse_qs(urllib.parse.urlparse(nx).query)['after'][0]); pages += 1
    if pages > 30: break
json.dump({'cv': cv, 'tatoeba': tat, 'seconds': round(time.time() - t0)}, open(f'{OUT}/candidates.json', 'w'), ensure_ascii=False, indent=0)
print(len(cv), 'CV;', len(tat), 'Tatoeba')
