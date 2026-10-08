# Объективная проверка разборчивости: Whisper распознаёт каждый клип, считаем долю верных букв (1 − CER).
import os, sys, json, glob, unicodedata, re
from faster_whisper import WhisperModel
texts = [t.strip() for t in open("texts.txt", encoding="utf-8") if t.strip()]
def norm(s):
    s = s.replace("I", "ı").replace("İ", "i").lower()
    s = unicodedata.normalize("NFC", s); s = re.sub(r"[^\w\s]", "", s); return re.sub(r"\s+", " ", s).strip()
def lev(a, b):
    d = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        p, d[0] = d[0], i
        for j, cb in enumerate(b, 1): p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (ca != cb))
    return d[len(b)]
m = WhisperModel("large-v3", device="cpu", compute_type="int8")
def hear(path):
    segs, _ = m.transcribe(path, language="tr", beam_size=5, vad_filter=False, condition_on_previous_text=False)
    return " ".join(s.text for s in segs).strip()
res = {}
for vdir in sorted(glob.glob("arts/clips/*")):
    v = os.path.basename(vdir); rows = []
    for i, t in enumerate(texts):
        f = os.path.join(vdir, f"{i}.wav")
        if not os.path.exists(f): continue
        h = hear(f); ref, hyp = norm(t), norm(h)
        rows.append(dict(text=t, heard=h, acc=round(max(0, 1 - lev(ref, hyp) / max(1, len(ref))), 3), exact=ref == hyp)); print(v, t, "→", h, flush=True)
    res[v] = rows
nat = {"native_hesap.mp3": "Hesap lütfen.", "native_kahvalti_hazir.mp3": "Kahvaltı hazır!"}
res["native"] = []
for f, t in nat.items():
    h = hear("ref/" + f); res["native"].append(dict(text=t, heard=h, acc=round(max(0, 1 - lev(norm(t), norm(h)) / len(norm(t))), 3), exact=norm(t) == norm(h)))
json.dump(res, open("pub/asr.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
lines = ["| голос | точность букв | слов/фраз без ошибки |", "|---|---|---|"]
for v, rows in sorted(res.items(), key=lambda kv: -sum(r["acc"] for r in kv[1]) / max(1, len(kv[1]))):
    if rows: lines.append(f"| {v} | {100*sum(r['acc'] for r in rows)/len(rows):.0f}% | {sum(r['exact'] for r in rows)} из {len(rows)} |")
open("pub/asr.md", "w", encoding="utf-8").write("\n".join(lines) + "\n"); print("\n".join(lines))
