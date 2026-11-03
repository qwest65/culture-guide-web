#!/usr/bin/env python3
"""Озвучка рассказов и фраз навигатора голосом Яндекс SpeechKit (API v3).

Перенесено из «Маленького каравана» (tools/generate_audio.py, режим --yandex-narrator):
тот же голос рассказчика (ermil), те же приёмы — текст режется по предложениям,
тишина по краям обрезается, звук нормализуется, MP3 моно 64 кбит/с (Safari на iPhone
не везде играет Ogg).

Что озвучивается:
- рассказ у объекта: «Название. Рассказ…» → public/audio/<город>/<id объекта>.mp3;
- фразы навигатора из content/voice.json → public/audio/common/<ключ>.mp3.

Перед синтезом текст проходит словарь города (content/cities/<город>/lexicon.json:
инициалы, сокращения, ударения) и общие правила (content/voice.json: века и т. п.).
На экране текст остаётся как есть.

Что уже озвучено, записано в manifest.json рядом с файлами: хэш текста. Если текст
поменяли, сборка (npm run content) предупредит, а этот скрипт по умолчанию
переозвучит только новое и изменённое.

    pip install numpy requests lameenc
    YANDEX_SPEECHKIT_KEY=… python3 tools/generate_audio.py              # новое и изменённое, все города
    YANDEX_SPEECHKIT_KEY=… python3 tools/generate_audio.py --all troitsk  # всё заново
    YANDEX_SPEECHKIT_KEY=… python3 tools/generate_audio.py --samples samples/  # образцы голосов

Запускается в GitHub Actions (.github/workflows/voice.yml). Ключ — API-ключ сервисного
аккаунта Яндекс Облака с ролью ai.speechkit-tts.user (тот же, что у «Маленького каравана»).
"""
import argparse
import base64
import hashlib
import json
import os
import pathlib
import re

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTENT = ROOT / "content"
AUDIO = ROOT / "public/audio"
RATE = 48000
MP3_KBPS = 64
PAUSE = 0.6
DEFAULT_VOICE = "ermil"
DEFAULT_ROLE = "neutral"
SAMPLE_VOICES = [("ermil", "neutral"), ("ermil", "good"), ("alexander", "neutral"), ("kirill", "neutral"),
                 ("anton", "neutral"), ("filipp", None), ("alena", "neutral"), ("jane", "neutral")]


# --- Тексты -------------------------------------------------------------------------------

def place_speech(place):
    """Как placeSpeech в tools/content.ts: «Название. Рассказ»."""
    return f"{place['name']}. {' '.join(place['story'])}"


def text_hash(text):
    """Как textHash в tools/content.ts."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def load_json(path, default=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def speakable(text, lexicon, voice):
    """Текст для синтеза: словарь города, общие правила, ударения."""
    replacements = (lexicon or {}).get("entries", []) + voice.get("spoken", [])
    for e in sorted(replacements, key=lambda e: -len(e["text"])):
        text = text.replace(e["text"], e["say"])
    for s in (lexicon or {}).get("stress", []):
        pattern = re.compile(rf"\b{s['word']}\b", re.IGNORECASE)

        def keep_case(match, say=s["say"], pattern=pattern):
            out = pattern.sub(say, match.group(0).lower())
            first = out.lstrip("+")[:1]
            if match.group(0)[0].isupper() and first:
                i = out.index(first)
                out = out[:i] + first.upper() + out[i + 1:]
            return out

        text = pattern.sub(keep_case, text)
    return text.replace("…", ".")


def chunks(text, limit=240):
    """Длинный текст режем по предложениям: так надёжнее для API v3."""
    parts, cur = [], ""
    for sentence in re.split(r"(?<=[.!?…])\s+", text):
        if cur and len(cur) + 1 + len(sentence) > limit:
            parts.append(cur)
            cur = sentence
        else:
            cur = f"{cur} {sentence}".strip()
    if cur:
        parts.append(cur)
    return parts


# --- Яндекс SpeechKit ---------------------------------------------------------------------

def yandex_say(text, voice, role=None, speed=1.0):
    """API v3: ответ — поток JSON-строк с кусками звука в base64."""
    import requests

    hints = [{"voice": voice}, {"speed": speed}]
    if role:
        hints.append({"role": role})
    body = {"text": text, "hints": hints, "loudnessNormalizationType": "LUFS",
            "outputAudioSpec": {"rawAudio": {"audioEncoding": "LINEAR16_PCM", "sampleRateHertz": RATE}}}
    r = requests.post("https://tts.api.cloud.yandex.net/tts/v3/utteranceSynthesis", json=body, timeout=120,
                      headers={"Authorization": f"Api-Key {os.environ['YANDEX_SPEECHKIT_KEY'].strip()}"})
    if r.status_code != 200:
        if r.status_code in (401, 403):
            raise SystemExit(f"Ключ SpeechKit не принят: HTTP {r.status_code} {r.text[:200]}")
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
    pcm = b"".join(base64.b64decode(json.loads(line)["result"]["audioChunk"]["data"])
                   for line in r.text.splitlines() if line.strip())
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768


def narrate(text, voice, role):
    pieces = []
    for chunk in chunks(text):
        pieces += [yandex_say(chunk, voice, role), np.zeros(int(RATE * 0.25), dtype=np.float32)]
    return np.concatenate(pieces[:-1])


# --- Звук ---------------------------------------------------------------------------------

def tighten(samples, keep=0.25, frame=0.02, threshold_db=-40):
    """Обрезает тишину по краям и укорачивает длинные паузы внутри до keep секунд."""
    step = int(RATE * frame)
    frames = len(samples) // step
    if frames == 0:
        return samples
    energy = np.sqrt(np.mean(samples[: frames * step].reshape(frames, step) ** 2, axis=1))
    loud = energy > max(float(energy.max()), 1e-6) * 10 ** (threshold_db / 20)
    if not loud.any():
        return samples
    first, last = int(np.argmax(loud)), frames - int(np.argmax(loud[::-1]))
    keep_frames = int(keep / frame)
    parts, quiet = [], 0
    for i in range(first, last):
        quiet = 0 if loud[i] else quiet + 1
        if quiet <= keep_frames:
            parts.append(samples[i * step:(i + 1) * step])
    return np.concatenate(parts)


def write_mp3(path, samples, tail=PAUSE):
    import lameenc

    samples = tighten(samples)
    peak = max(float(np.abs(samples).max()), 1e-6)
    data = np.concatenate([np.zeros(int(RATE * 0.05), dtype=np.float32), samples / peak * 0.9,
                           np.zeros(int(RATE * tail), dtype=np.float32)])
    enc = lameenc.Encoder()
    enc.set_bit_rate(MP3_KBPS)
    enc.set_in_sample_rate(RATE)
    enc.set_channels(1)
    enc.set_quality(2)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(enc.encode((np.clip(data, -1, 1) * 32767).astype(np.int16).tobytes()) + enc.flush())
    print(f"{path.relative_to(ROOT)}  {len(data) / RATE:.1f} с")


# --- Озвучка ------------------------------------------------------------------------------

def voice_batch(folder, jobs, lexicon, voice_cfg, args):
    """jobs: [(ключ, текст на экране)]. Озвучивает новое и изменённое (или всё с --all)."""
    manifest_path = folder / "manifest.json"
    manifest = load_json(manifest_path, {"files": {}})
    manifest["voice"] = args.voice
    done = 0
    for key, text in jobs:
        h = text_hash(text)
        rec = manifest["files"].get(key)
        if not args.all and rec and rec.get("text_hash") == h and (folder / f"{key}.mp3").exists():
            continue
        write_mp3(folder / f"{key}.mp3", narrate(speakable(text, lexicon, voice_cfg), args.voice, args.role))
        manifest["files"][key] = {"text_hash": h, "voice": args.voice}
        done += 1
        # Сохраняем после каждого файла: если ключ кончится на середине, сделанное не пропадёт.
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return done


def generate(args):
    voice_cfg = load_json(CONTENT / "voice.json")
    cities = load_json(CONTENT / "cities.json")["cities"]
    if args.city:
        if args.city not in cities:
            raise SystemExit(f"Нет города «{args.city}» в content/cities.json")
        cities = [args.city]
    total = voice_batch(AUDIO / "common", list(voice_cfg["phrases"].items()), None, voice_cfg, args)
    for city in cities:
        folder = CONTENT / "cities" / city
        places = [p for p in load_json(folder / "places.json")["places"] if p["status"] != "draft"]
        total += voice_batch(AUDIO / city, [(p["id"], place_speech(p)) for p in places],
                             load_json(folder / "lexicon.json"), voice_cfg, args)
    print(f"Озвучено файлов: {total}")


def samples(out):
    """Один и тот же фрагмент разными голосами — чтобы выбрать на слух."""
    places = load_json(CONTENT / "cities/troitsk/places.json")["places"]
    text = speakable(place_speech(places[3])[:400], load_json(CONTENT / "cities/troitsk/lexicon.json"),
                     load_json(CONTENT / "voice.json"))
    for voice, role in SAMPLE_VOICES:
        try:
            write_mp3(out / f"{voice}-{role or 'default'}.mp3", narrate(text, voice, role))
        except RuntimeError as error:
            print(f"  {voice} {role}: {error}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("city", nargs="?", help="город (по умолчанию — все из content/cities.json)")
    parser.add_argument("--all", action="store_true", help="переозвучить всё, а не только новое и изменённое")
    parser.add_argument("--voice", default=DEFAULT_VOICE, help="голос Яндекса, по умолчанию ermil")
    parser.add_argument("--role", default=DEFAULT_ROLE, help="амплуа голоса, по умолчанию neutral")
    parser.add_argument("--samples", type=pathlib.Path, help="вместо озвучки — образцы голосов в эту папку")
    parser.add_argument("--print", dest="show", action="store_true", help="только показать текст для синтеза")
    args = parser.parse_args()
    if args.show:
        voice_cfg = load_json(CONTENT / "voice.json")
        city = args.city or "troitsk"
        lex = load_json(CONTENT / "cities" / city / "lexicon.json")
        for p in load_json(CONTENT / "cities" / city / "places.json")["places"]:
            print(f"--- {p['id']} ({text_hash(place_speech(p))})\n{speakable(place_speech(p), lex, voice_cfg)}\n")
        return
    if not os.environ.get("YANDEX_SPEECHKIT_KEY", "").strip():
        raise SystemExit("Нет ключа: задайте YANDEX_SPEECHKIT_KEY (в GitHub — секрет репозитория).")
    if args.samples:
        samples(args.samples)
    else:
        generate(args)


if __name__ == "__main__":
    main()
