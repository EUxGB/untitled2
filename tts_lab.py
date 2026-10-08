# Образцы турецкого синтеза для сравнения на слух (не часть приложения).
import sys, os, subprocess, numpy as np, soundfile as sf
eng, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
texts = [t.strip() for t in open("texts.txt", encoding="utf-8") if t.strip()]
REF, REF_TEXT = "ref/ref.wav", "Faturamı ödemek istiyorum."

def save(name, clips, sr):
    cd = os.path.join(out, "clips", name); os.makedirs(cd, exist_ok=True)
    for i, c in enumerate(clips): sf.write(os.path.join(cd, f"{i}.wav"), np.asarray(c, dtype=np.float32).reshape(-1), sr)
    gap = np.zeros(int(sr * 0.8), dtype=np.float32); parts = []
    for c in clips: parts += [np.asarray(c, dtype=np.float32).reshape(-1), gap]
    wav = os.path.join(out, name + ".wav"); sf.write(wav, np.concatenate(parts), sr)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-ac", "1", "-b:a", "64k", os.path.join(out, name + ".mp3")], check=True); os.remove(wav)
    print("ok", name)

import traceback
def log(t):
    print(t); open(os.path.join(out, f"errors-{eng}.txt"), "a").write(t + "\n")
def run():
  if eng == "piper":
      from huggingface_hub import hf_hub_download, list_repo_files
      voices = [f for f in list_repo_files("rhasspy/piper-voices") if f.startswith("tr/") and f.endswith(".onnx")]
      print("voices", voices)
      for base in voices:
          v = base.split("/")[-1][:-5]
          try:
              m = hf_hub_download("rhasspy/piper-voices", base); hf_hub_download("rhasspy/piper-voices", base + ".json")
              clips, sr = [], None
              for i, t in enumerate(texts):
                  f = f"/tmp/p{i}.wav"
                  r = subprocess.run(["piper", "--model", m, "--output_file", f], input=t.encode(), capture_output=True)
                  if r.returncode != 0: subprocess.run([sys.executable, "-m", "piper", "-m", m, "-f", f, "--", t], check=True)
                  d, sr = sf.read(f, dtype="float32"); clips.append(d)
              save("piper_" + v, clips, sr)
          except Exception: log(traceback.format_exc())
  elif eng == "mms":
      import torch
      from transformers import VitsModel, AutoTokenizer
      m = VitsModel.from_pretrained("facebook/mms-tts-tur"); tok = AutoTokenizer.from_pretrained("facebook/mms-tts-tur"); clips = []
      for t in texts:
          with torch.no_grad(): clips.append(m(**tok(t, return_tensors="pt")).waveform[0].numpy())
      save("mms", clips, m.config.sampling_rate)
  elif eng == "xtts":
      from TTS.api import TTS
      tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2"); sr = tts.synthesizer.output_sample_rate
      for name, kw in [("xtts_builtin", dict(speaker="Ana Florence")), ("xtts_cv_voice", dict(speaker_wav=REF))]:
          try: save(name, [tts.tts(text=t, language="tr", **kw) for t in texts], sr)
          except Exception: log(traceback.format_exc())
  elif eng == "f5":
      from huggingface_hub import hf_hub_download
      from f5_tts.api import F5TTS
      ck = hf_hub_download("Karayakar/F5-TTS-Turkish", "f5_tts_turkish_800000.safetensors"); vo = hf_hub_download("Karayakar/F5-TTS-Turkish", "vocab.txt")
      last = None
      for model in ["F5TTS_Base", "F5TTS_v1_Base"]:
          try:
              f5 = F5TTS(model=model, ckpt_file=ck, vocab_file=vo, device="cpu"); clips = []
              for t in texts:
                  wav, sr, _ = f5.infer(ref_file=REF, ref_text=REF_TEXT, gen_text=t, remove_silence=True)
                  clips.append(wav)
              save("f5_turkish", clips, sr); break
          except Exception: log(model + "\n" + traceback.format_exc())

try: run()
except Exception: log(traceback.format_exc())
