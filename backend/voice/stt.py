"""STT local via faster-whisper. CPU + int8 para deixar a GPU com o Qwen.

Um processo residente (--serve) carrega o modelo uma vez e transcreve vários arquivos.
Sem --serve, transcreve um wav e encerra (útil para teste).

Não grava o áudio. O backend apaga o wav temporário.
"""
import json
import sys
import time


def load(model: str):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(json.dumps({
            "error": "faster-whisper não instalado. No ambiente Python: pip install -r backend/voice/requirements.txt"
        }), flush=True)
        raise SystemExit(3)
    return WhisperModel(model, device="cpu", compute_type="int8")


def transcribe(whisper, wav: str) -> dict:
    t0 = time.perf_counter()
    segments, _info = whisper.transcribe(
        wav,
        language="pt",
        vad_filter=True,
        beam_size=1,
        condition_on_previous_text=False,
    )
    text = " ".join(s.text.strip() for s in segments).strip()
    return {"text": text, "ms": int((time.perf_counter() - t0) * 1000)}


def serve(model: str) -> int:
    whisper = load(model)
    print(json.dumps({"ready": True, "model": model}), flush=True)
    for line in sys.stdin:
        wav = line.strip().strip('"')
        if not wav:
            continue
        try:
            print(json.dumps(transcribe(whisper, wav), ensure_ascii=False), flush=True)
        except Exception as ex:  # noqa: BLE001
            print(json.dumps({"error": str(ex)}), flush=True)
    return 0


def main() -> int:
    args = sys.argv[1:]
    if args and args[0] == "--serve":
        if len(args) < 2:
            print(json.dumps({"error": "uso: stt.py --serve <modelo>"}))
            return 2
        return serve(args[1])
    if len(args) < 2:
        print(json.dumps({"error": "uso: stt.py <wav> <modelo>"}))
        return 2
    whisper = load(args[1])
    print(json.dumps({**transcribe(whisper, args[0]), "model": args[1]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as ex:  # noqa: BLE001
        print(json.dumps({"error": str(ex)}), flush=True)
        raise SystemExit(1)
