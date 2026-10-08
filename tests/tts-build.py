#!/usr/bin/env python3
# Озвучка Piper для сайта (спек docs/superpowers/specs/2026-10-08-piper-tts-design.md).
# Запуск (в CI): python3 tests/tts-build.py tests/tts-texts.json <папка ветки tts-audio>
#   — озвучивает только недостающее (не больше TTS_MAX за запуск), удаляет файлы текстов, которых больше нет,
#   — проверяет новые клипы распознаванием Whisper: small для всех, large-v3 для сомнительных;
#     совсем неразборчивые (доля верных букв < 0,5 и у large-v3) в манифест не попадают — на сайте для них голос телефона;
#   — пишет manifest.json {voice, items:{ключ: файл}} и tts-report.json (сомнительные и выброшенные — для просмотра человеком).
import sys, os, json, hashlib, re, subprocess, unicodedata, wave, time

VOICE = "tr_TR-dfki-medium"
VOICE_TAG = VOICE + "@1"          # сменили голос или настройки — поменять тег: всё переозвучится
texts_path, out = sys.argv[1], sys.argv[2]
MAX = int(os.environ.get("TTS_MAX", "100000"))
os.makedirs(out, exist_ok=True)
items = json.load(open(texts_path, encoding="utf-8"))
man_path = os.path.join(out, "manifest.json")
man = json.load(open(man_path, encoding="utf-8")) if os.path.exists(man_path) else {"voice": VOICE_TAG, "items": {}}
if man.get("voice") != VOICE_TAG: man = {"voice": VOICE_TAG, "items": {}}
rep_path = os.path.join(out, "tts-report.json")
report = json.load(open(rep_path, encoding="utf-8")) if os.path.exists(rep_path) else {"bad": {}, "doubt": {}}
report.setdefault("bad", {}); report.setdefault("doubt", {})

def fname(key): return hashlib.sha1((VOICE_TAG + "\n" + key).encode("utf-8")).hexdigest()[:16] + ".mp3"

keys = {it["key"]: it["text"] for it in items}
# 1) убрать то, чего больше нет на сайте
for k in list(man["items"]):
    if k not in keys: man["items"].pop(k, None)
for k in list(report["bad"]):
    if k not in keys: report["bad"].pop(k, None)
for k in list(report["doubt"]):
    if k not in keys: report["doubt"].pop(k, None)
keep = set(man["items"].values())
for f in os.listdir(out):
    if f.endswith(".mp3") and f not in keep: os.remove(os.path.join(out, f))
# 2) что озвучить (выброшенные Whisper'ом не повторяем, пока не сменится голос)
todo = [k for k in keys if k not in man["items"] and k not in report["bad"]][:MAX]
print(f"текстов {len(keys)}, в манифесте {len(man['items'])}, озвучить сейчас {len(todo)}", flush=True)
if not todo:
    json.dump(man, open(man_path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    sys.exit(0)

from huggingface_hub import hf_hub_download
base = f"tr/tr_TR/dfki/medium/{VOICE}.onnx"
model = hf_hub_download("rhasspy/piper-voices", base); hf_hub_download("rhasspy/piper-voices", base + ".json")
try:
    from piper.voice import PiperVoice
    pv = PiperVoice.load(model)
    def synth(text, wav):
        with wave.open(wav, "wb") as wf: pv.synthesize(text, wf)
except Exception as e:
    print("python API Piper недоступен, CLI:", e)
    def synth(text, wav):
        r = subprocess.run(["piper", "--model", model, "--output_file", wav], input=text.encode(), capture_output=True)
        if r.returncode: subprocess.run([sys.executable, "-m", "piper", "-m", model, "-f", wav, "--", text], check=True)

tmp = "/tmp/tts-wav"; os.makedirs(tmp, exist_ok=True)
t0 = time.time(); made = []
for i, k in enumerate(todo):
    wav = os.path.join(tmp, f"{i}.wav"); mp3 = os.path.join(out, fname(k))
    synth(keys[k], wav)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-ac", "1", "-b:a", "48k", mp3], check=True)
    made.append((k, wav))
print(f"озвучено {len(made)} за {time.time() - t0:.0f} с", flush=True)

# 3) проверка распознаванием
def norm(s):
    s = s.replace("I", "ı").replace("İ", "i").lower(); s = unicodedata.normalize("NFC", s)
    s = re.sub(r"[^\w\s]", "", s); return re.sub(r"\s+", " ", s).strip()
def lev(a, b):
    d = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        p, d[0] = d[0], i
        for j, cb in enumerate(b, 1): p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (ca != cb))
    return d[len(b)]
def acc(ref, hyp):
    r, h = norm(ref), norm(hyp); return max(0.0, 1 - lev(r, h) / max(1, len(r)))
from faster_whisper import WhisperModel
def hear(m, wav):
    segs, _ = m.transcribe(wav, language="tr", beam_size=5, condition_on_previous_text=False)
    return " ".join(s.text for s in segs).strip()
t0 = time.time(); small = WhisperModel("small", device="cpu", compute_type="int8"); doubt = []
for k, wav in made:
    h = hear(small, wav); a = acc(keys[k], h)
    if a >= 0.8: man["items"][k] = fname(k); report["doubt"].pop(k, None)
    else: doubt.append((k, wav, h, a))
print(f"Whisper small: {len(made) - len(doubt)} разборчиво, сомнительных {len(doubt)} ({time.time() - t0:.0f} с)", flush=True)
if doubt:
    big = WhisperModel("large-v3", device="cpu", compute_type="int8")
    for k, wav, h1, a1 in doubt:
        h = hear(big, wav); a = acc(keys[k], h)
        if a >= 0.5:
            man["items"][k] = fname(k)
            if a < 0.8: report["doubt"][k] = {"text": keys[k], "heard": h, "acc": round(a, 2)}
            else: report["doubt"].pop(k, None)
        else:
            report["bad"][k] = {"text": keys[k], "heard": h, "acc": round(a, 2)}
            p = os.path.join(out, fname(k))
            if os.path.exists(p): os.remove(p)
json.dump(man, open(man_path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
json.dump(report, open(rep_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
left = len([k for k in keys if k not in man["items"] and k not in report["bad"]])
print(f"в манифесте {len(man['items'])} из {len(keys)}; сомнительных {len(report['doubt'])}, выброшено {len(report['bad'])}, осталось озвучить {left}")
