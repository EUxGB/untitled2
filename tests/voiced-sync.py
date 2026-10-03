# Переносит выверенный список фраз (tests/voiced-phrases.json) в index.html: блоки VOICED и RARE.
# Править фразы и переводы — в JSON, потом: python3 tests/voiced-sync.py (тест «фразы из жизни» проверяет совпадение).
import json, re
vp = json.load(open('tests/voiced-phrases.json', encoding='utf-8'))
src = open('index.html', encoding='utf-8').read()
order = ['greet', 'hotel', 'food', 'transport', 'shop', 'health', 'talk', 'sos', 'basic']
def ent(p):
    a = [p['tr'], p['ru']] + ([p['tat'], p['author']] if p.get('tat') else [])
    return json.dumps(a, ensure_ascii=False, separators=(',', ','))
block = "const VOICED = {\n" + "".join(f"  {k}:[{','.join(ent(p) for p in vp[k])}],\n" for k in order) + "};\n"
m = re.search(r"const VOICED = \{\n.*?\n\};\n", src, re.S)
src = src[:m.start()] + block + src[m.end():]
rare = [p['tr'] for k in order for p in vp[k] if p.get('rare')]
m = re.search(r"const RARE = new Set\(\[.*?\]\);\n", src, re.S)
src = src[:m.start()] + "const RARE = new Set(" + json.dumps(rare, ensure_ascii=False) + ");\n" + src[m.end():]
open('index.html', 'w', encoding='utf-8').write(src)
print(sum(len(v) for v in vp.values()), 'фраз,', len(rare), 'редких')
