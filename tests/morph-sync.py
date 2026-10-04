#!/usr/bin/env python3
"""Переносит tests/morph.json (разбор слов по частям: окончания SUF, корни ROOT_GLOSS, слова MORPH) в блок index.html
между <MORPH-DATA> и </MORPH-DATA>. Руками блок в index.html не править — править tests/morph.json и запускать этот скрипт."""
import json, re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
d = json.loads((root / 'tests' / 'morph.json').read_text(encoding='utf-8'))
j = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':'))
lines = ['// <MORPH-DATA> создан скриптом tests/morph-sync.py из tests/morph.json — руками не править',
         'const SUF = {', ',\n'.join(f'  {k}:{j(v)}' for k, v in d['suf'].items()), '};',
         'const ROOT_GLOSS = {', ',\n'.join(f'  {j(k)}:{j(v)}' for k, v in d['roots'].items()), '};',
         'const MORPH = {', ',\n'.join(f'  {j(k)}:{j(v)}' for k, v in d['morph'].items()), '};',
         '// </MORPH-DATA>']
block = '\n'.join(lines)
p = root / 'index.html'; s = p.read_text(encoding='utf-8')
pat = re.compile(r'// <MORPH-DATA>.*?// </MORPH-DATA>', re.S)
if pat.search(s): s = pat.sub(lambda m: block, s)
else:
    marker = 'function wordGloss(raw){'
    assert marker in s, 'нет места вставки'
    s = s.replace(marker, block + '\n' + marker, 1)
p.write_text(s, encoding='utf-8'); print('MORPH-DATA:', len(d['morph']), 'слов,', len(d['suf']), 'окончаний,', len(d['roots']), 'корней')
