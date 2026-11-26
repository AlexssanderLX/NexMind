"""One-shot `nex <texto>` from a local shell. No tools, no session row."""

from __future__ import annotations

import json
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from hermes_cli.runtime_provider import resolve_runtime_provider
from hermes_cli.web_deps import late

_require_token = late("_require_token")

router = APIRouter()
_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"


def _post_chat(url: str, key: str, payload: dict) -> str:
    headers = {"Content-Type": "application/json", "User-Agent": _UA}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    req = urlrequest.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    with urlrequest.urlopen(req, timeout=60) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    choices = body.get("choices") or []
    message = (choices[0].get("message") or {}) if choices else {}
    return str(message.get("content") or "").strip()


def _venice() -> dict | None:
    import os
    from pathlib import Path

    key = os.environ.get("VENICE_API_KEY", "")
    base = os.environ.get("VENICE_BASE_URL", "https://api.venice.ai/api/v1")
    model = os.environ.get("VENICE_MODEL", "abliteration-abliterated-model-large-flash")
    env_file = Path(os.environ.get("HERMES_HOME", r"C:\Users\Alexssander\Tools\nex-re\hermes\home")) / ".env"
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("VENICE_API_KEY=") and not key:
                key = line.split("=", 1)[1].strip()
            elif line.startswith("VENICE_BASE_URL=") and line.split("=", 1)[1].strip():
                base = line.split("=", 1)[1].strip()
    if not key:
        return None
    root = base.rstrip("/")
    url = root if root.endswith("/chat/completions") else f"{root}/chat/completions"
    return {"url": url, "key": key, "model": model}


def _active_model() -> tuple[str, str, str]:
    from hermes_cli.config import load_config

    cfg = load_config() or {}
    model_cfg = cfg.get("model") or {}
    provider = str(model_cfg.get("provider") or "groq")
    model = str(model_cfg.get("default") or "")
    runtime = resolve_runtime_provider(requested=provider, target_model=model or None)
    base = str(runtime.get("base_url") or model_cfg.get("base_url") or "").rstrip("/")
    key = str(runtime.get("api_key") or "")
    if not model:
        model = str(runtime.get("model") or "")
    return model, base, key


def ask_model(text: str) -> str:
    model, base, key = _active_model()
    if not base or not model:
        raise RuntimeError("modelo ativo sem endpoint")
    url = base if base.endswith("/chat/completions") else f"{base}/chat/completions"
    payload_obj = {
        "model": model,
        "messages": [{"role": "user", "content": text}],
        "temperature": 0.2,
    }
    if "groq" in base.lower() or "groq" in model.lower():
        payload_obj["max_tokens"] = 800
    try:
        return _post_chat(url, key, payload_obj)
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        if exc.code in (429, 403):
            venice = _venice()
            if venice:
                try:
                    return _post_chat(venice["url"], venice["key"], {
                        "model": venice["model"],
                        "messages": payload_obj["messages"],
                        "temperature": 0.2,
                        "max_tokens": 800,
                    })
                except HTTPError as ven_exc:
                    ven_detail = ven_exc.read().decode("utf-8", errors="replace")[:300]
                    raise RuntimeError(f"modelo indisponível ({ven_exc.code}): {ven_detail}") from ven_exc
        raise RuntimeError(f"modelo indisponível ({exc.code}): {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"modelo indisponível: {exc.reason}") from exc


@router.post("/api/chat")
async def nex_chat(request: Request) -> JSONResponse:
    _require_token(request)
    raw = await request.body()
    try:
        data = json.loads(raw.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        data = {}
    text = str(data.get("message") or data.get("text") or "").strip()
    if not text:
        return JSONResponse({"error": "mensagem vazia"}, status_code=400)
    try:
        answer = ask_model(text)
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)
    return JSONResponse({"response": answer})
