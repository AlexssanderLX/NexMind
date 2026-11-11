"""STT local via faster-whisper. CPU + int8 para deixar a GPU com o Qwen.

Uso: python stt.py <wav> <modelo>
Imprime uma linha JSON: {"text": "...", "ms": 123, "model": "base"}
Não grava o áudio em disco além do arquivo temporário que o backend apaga.
"""
import json
import sys
import time


def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({"error": "uso: stt.py <wav> <modelo>"}))
        return 2
    wav, model = sys.argv[1], sys.argv[2]
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(json.dumps({
            "error": "faster-whisper não instalado. No ambiente Python: pip install -r backend/voice/requirements.txt"
        }))
        return 3

    t0 = time.perf_counter()
    whisper = WhisperModel(model, device="cpu", compute_type="int8")
    segments, _info = whisper.transcribe(
        wav,
        language="pt",
        vad_filter=True,
        beam_size=1,
        condition_on_previous_text=False,
    )
    text = " ".join(s.text.strip() for s in segments).strip()
    ms = int((time.perf_counter() - t0) * 1000)
    print(json.dumps({"text": text, "ms": ms, "model": model}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as ex:  # noqa: BLE001 — devolve erro legível ao backend
        print(json.dumps({"error": str(ex)}))
        raise SystemExit(1)
